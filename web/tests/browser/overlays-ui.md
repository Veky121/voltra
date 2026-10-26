Run the Vite development server and open `/tests/browser/overlays-ui.html`.
This fixture uses the actual shared components without panel or node requests.

The clipped card deliberately combines overflow, transform, and filter to catch
the containing-block regression. Check that its modal fills the viewport, keeps
keyboard focus inside, restores the trigger after closing, and closes on its
backdrop. Open its select, menu, submenu, and tooltip to check that each remains
above the dialog. Escape must dismiss an open popup before its parent dialog.
The nested dialog must close without closing its parent.

Also check the standalone clipped dropdown, Minecraft dialog, and sheet menu.
At 390px, the modal content must fit within the viewport and remain scrollable.

The local Playwright run and app-screen audit are stored under
`.local/overlay-audit/`. The app audit intercepts reconnect and other non-GET
requests so opening dialogs does not change credentials or live server state.
