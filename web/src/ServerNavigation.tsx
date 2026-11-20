import type {ServerIdentityArtwork} from './features/servers/serverArtwork';
import {ActionButton as MiraAction} from './ui/ActionButton';
import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {api, rows} from './lib';
import type {ResourceList} from './types/api';
import {Icon} from './Icons';
import {Button as MiraButton} from './components/ui/button';
import {observeLiveNavigation, liveHintsHealthy} from './hooks/liveEvents';
import {onFocusRevalidate, answeredRecently} from './hooks/focusRevalidation';
import {snapshotOwner} from './accountSnapshots';
import {savedNavigation, saveNavigation} from './navigationSnapshot';

export type NavigationServer = {
  uuid: string;
  identifier: string;
  name: string;
  egg_name?: string;
  artwork?: ServerIdentityArtwork;
  status: string | null;
  favorite: boolean;
  last_visited_at: string | null;
};
type NavigationState = {
  servers: NavigationServer[];
  loading: boolean;
  error: string;
  pending: Set<string>;
  reload: () => void;
  visit: (id: string) => void;
  favorite: (id: string, value: boolean) => Promise<void>;
};
const Context = createContext<NavigationState>({
  servers: [],
  loading: true,
  error: '',
  pending: new Set(),
  reload: () => {},
  visit: () => {},
  favorite: async () => {},
});
export const useServerNavigation = () => useContext(Context);

// The sidebar draws the last known list at once; the panel's answer replaces it.
export function ServerNavigationProvider({children}: {children: ReactNode}) {
  const [saved] = useState(savedNavigation);
  const [servers, setServers] = useState<NavigationServer[]>(saved ?? []),
    [loading, setLoading] = useState(!saved),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState(new Set<string>());
  const busy = useRef(new Set<string>());
  const writeVersion = useRef(0);
  const answeredAt = useRef(0);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => observeLiveNavigation(reload), [reload]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      // The answer is saved only for the account that asked for it.
      const version = writeVersion.current,
        owner = snapshotOwner();
      try {
        const data = await api<ResourceList<NavigationServer>>('/api/client/account/server-navigation', {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          if (version !== writeVersion.current) {
            reload();
            return;
          }
          const next = rows(data);
          answeredAt.current = Date.now();
          setServers(next);
          saveNavigation(next, owner);
          setError('');
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, 60000);
        }
      }
    }
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  // Navigation events arrive whether or not the page is visible, while the socket is healthy.
  useEffect(
    () => onFocusRevalidate(() => liveHintsHealthy() || answeredRecently(answeredAt.current), reload),
    [reload]
  );
  const favorite = useCallback(async (id: string, value: boolean) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setPending(new Set(busy.current));
    setError('');
    try {
      await api(`/api/client/servers/${encodeURIComponent(id)}/navigation`, {
        method: 'PUT',
        body: JSON.stringify({favorite: value}),
      });
      writeVersion.current++;
      setServers(old => old.map(s => (s.uuid === id || s.identifier === id ? {...s, favorite: value} : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current.delete(id);
      setPending(new Set(busy.current));
    }
  }, []);
  const visit = useCallback(
    (id: string) => {
      void api(`/api/client/servers/${encodeURIComponent(id)}/navigation`, {method: 'POST'})
        .then(() => {
          writeVersion.current++;
          setServers(old =>
            old.map(s => (s.uuid === id || s.identifier === id ? {...s, last_visited_at: new Date().toISOString()} : s))
          );
          reload();
        })
        .catch(e => setError(e instanceof Error ? e.message : String(e)));
    },
    [reload]
  );
  return (
    <Context.Provider value={{servers, loading, error, pending, reload, visit, favorite}}>{children}</Context.Provider>
  );
}

export function FavoriteButton({
  id,
  name,
  variant = 'button',
}: {
  id: string;
  name: string;
  variant?: 'button' | 'star';
}) {
  const nav = useServerNavigation(),
    server = nav.servers.find(s => s.uuid === id || s.identifier === id);
  const label = `${server?.favorite ? 'Remove' : 'Add'} ${name} ${server?.favorite ? 'from' : 'to'} favorites`;
  // The star sits beside a server title; its state is the pressed state.
  if (variant === 'star')
    return (
      <MiraButton
        type="button"
        variant="ghost"
        size="icon-sm"
        className={`server-favorite-star${server?.favorite ? ' is-favorite' : ''}`}
        aria-label={label}
        title={server?.favorite ? 'Remove favorite' : 'Add to favorites'}
        aria-pressed={!!server?.favorite}
        disabled={!server || nav.pending.has(id)}
        onClick={() => void nav.favorite(id, !server?.favorite)}
      >
        <Icon name="star" />
      </MiraButton>
    );
  return (
    <MiraAction
      type="button"
      className={`button secondary server-favorite${server?.favorite ? ' is-favorite' : ''}`}
      aria-label={label}
      title={server?.favorite ? 'Remove favorite' : 'Add to favorites'}
      aria-pressed={!!server?.favorite}
      disabled={!server || nav.pending.has(id)}
      onClick={() => void nav.favorite(id, !server?.favorite)}
    >
      <Icon name="star" />
      <span>{server?.favorite ? 'Favorited' : 'Favorite'}</span>
    </MiraAction>
  );
}
