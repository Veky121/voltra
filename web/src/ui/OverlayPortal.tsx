import {createContext, useContext} from 'react';

// Native dialogs are in the browser's top layer. Popup portals must remain
// inside their owning dialog to stay visible and interactive.
export const OverlayPortalContext = createContext<HTMLElement | null>(null);
export function useOverlayPortalContainer() {
  // Base UI treats null as an unresolved container and mounts no popup.
  // Without an owning dialog, undefined selects its default body portal.
  return useContext(OverlayPortalContext) ?? undefined;
}
