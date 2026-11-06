// Firefox's browser namespace supplies Promises. Chromium uses chrome.
export const extension = globalThis.browser || globalThis.chrome;

export function openSidebar(windowId) {
  // Firefox does not propagate a webpage click as a privileged user gesture.
  // Queue the mod; the toolbar opens the sidebar, or an already-open sidebar updates.
  if (extension.sidebarAction) return Promise.resolve();
  return extension.sidePanel.open({windowId});
}

export function configureSidebar() {
  if (extension.sidebarAction) {
    extension.action.onClicked.addListener(() => {
      // Must run synchronously within the browser's toolbar click gesture.
      extension.sidebarAction.open().catch(() => {});
      extension.action.setBadgeText({text:''}).catch(() => {});
    });
  } else {
    extension.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
      .catch(() => console.error('Could not configure the Voltra side panel toolbar action.'));
  }
}
