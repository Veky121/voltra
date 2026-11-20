import {useEffect, useSyncExternalStore, type ReactNode} from 'react';
import {api} from '../../lib';
import {onFocusRevalidate} from '../../hooks/focusRevalidation';
import {artworkSnapshot, setArtworkMapping, subscribeArtwork} from './artworkLibrary';
export function useArtworkLibrary() {
  return useSyncExternalStore(subscribeArtwork, artworkSnapshot, artworkSnapshot);
}
export function ArtworkProvider({children}: {children: ReactNode}) {
  useEffect(() => {
    let active = true,
      pending = false,
      lastAttempt = 0;
    setArtworkMapping(null);
    const refresh = () => {
      if (pending || Date.now() - lastAttempt < 30000) return;
      pending = true;
      lastAttempt = Date.now();
      api('/api/client/artwork/catalog')
        .then(value => {
          if (active) setArtworkMapping(value);
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 60000);
    // refresh() keeps its own 30 s limit.
    const stopFocus = onFocusRevalidate(() => false, refresh);
    return () => {
      active = false;
      clearInterval(interval);
      stopFocus();
      setArtworkMapping(null);
    };
  }, []);
  return children;
}
