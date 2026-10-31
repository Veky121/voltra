import {saveSettingChanges} from './saveSettingChanges';
import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {Button} from '../lib';
import './startupSettings.css';

type Change = {blocked: boolean; save: () => Promise<void>; discard: () => void};
const PendingContext = createContext<((key: string, change?: Change) => void) | null>(null);
export function usePendingSetting(key: string, dirty: boolean, change: Change) {
  const register = useContext(PendingContext);
  const latest = useRef(change); latest.current = change;
  useEffect(() => {
    register?.(key, dirty ? {blocked: change.blocked, save: () => latest.current.save(), discard: () => latest.current.discard()} : undefined);
    return () => register?.(key);
  }, [register, key, dirty, change.blocked]);
}
export function PendingSettings({children}: {children: ReactNode}) {
  const parent = useContext(PendingContext);
  return parent ? <>{children}</> : <PendingSettingsOwner>{children}</PendingSettingsOwner>;
}
function PendingSettingsOwner({children}: {children: ReactNode}) {
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false);
  const register = useCallback((key: string, change?: Change) => setChanges(current => {
    if (!change && !current[key]) return current;
    const next = {...current}; if (change) next[key] = change; else delete next[key]; return next;
  }), []);
  const pending = Object.values(changes);
  useEffect(() => {
    if (!pending.length) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [pending.length]);
  return <PendingContext.Provider value={register}>{children}{pending.length > 0 && <div className="settings-pending-bar" role="region" aria-label="Unsaved settings">
    <span>{error || 'Unsaved changes'}</span>
    <Button disabled={busy || pending.some(change => change.blocked)} onClick={async () => {
      if (locked.current) return; locked.current = true; setBusy(true); setError('');
      try {await saveSettingChanges(pending);}
      catch {setError('Some changes could not be saved. Check the highlighted settings.');}
      finally {locked.current = false; setBusy(false);}
    }}>{busy ? 'Saving...' : 'Save'}</Button>
    <Button variant="secondary" disabled={busy} onClick={() => {for (const change of pending) change.discard(); setError('');}}>Discard</Button>
  </div>}</PendingContext.Provider>;
}
