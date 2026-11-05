# Browser fixtures

These fixtures exercise UI behavior. Read each fixture's guide before running it; intercepted requests and controlled responses do not prove native game or production behavior.

Use [local development](../../../docs/LOCAL_DEVELOPMENT.md) for the ordinary app at port 5181. Some fixtures below use dedicated test servers or configurations. Their ports are fixture instructions, not replacements for `dev.ps1`.

- [Minimal settings](minimal-settings-ui.md): tab history, draft protection, shared saves and Connections.
- [File manager](file-manager-ui.md): selection, explorer/editor layout and drafts.
- [Console history](console-history-ui.md): scrolling, selection and buffered output.
- [Game families](game-families-ui.md): catalog grouping and navigation.
- [Overlays](overlays-ui.md): dialogs, menus, focus and clipping.
- [Steam UI](steam-ui.md): managed-game controls and status.

Run `npm run check --prefix web` and `npm run test:editor --prefix web` from the repository root for type checking and the frontend test suite. Describe browser fixture results separately from real backend, transfer and game acceptance.
