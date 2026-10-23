Run from `ptero-go/web`:

```powershell
npm run check
node --experimental-strip-types --test tests/fileManager.test.mjs
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort
```

Open `http://127.0.0.1:5198/tests/browser/file-manager-ui.html` and click **Run interaction suite**. The page reports 26 checks covering full-width browsing with no second list, contraction beside the editor, selection, padded checkbox hit targets, modifier clicks, menu actions/focus, single-click folders/files, Unicode paths, read-only permissions, and all 1,205 entries in a large directory. It also covers preserved tree identity/filter/expansion/scroll, the far-right close X, equal desktop pane heights, bounded long-file scrolling, inert closing documents, rapid close/reopen cleanup and the mounted transfer queue.

Manual browser checks: type an unsaved draft, then try a tree folder, Back to files and the close X. All must preserve the draft and leave the document open. Discard changes must restore normal navigation. At 390px the explorer remains available above the editor, with no horizontal page overflow. Editor Find and the save/discard bar must remain inside the bounded pane. Respect the operating system's reduced-motion setting when checking transitions. Hidden previews can pause animation frames; complete their CSS animations explicitly for functional checks, and use a visible browser for motion QA.

All API calls are intercepted in memory. Unexpected requests throw; mutations return 405. The fixture never contacts a real panel, node or filesystem. This validates browser integration, not file mutation or upload acceptance.

The blue `FileExplorer` is the main browser. Its checkboxes and menus use full container paths, so nested files with the same name stay distinct. Folder selection sets the upload/new-file directory shown above the explorer. Keep these checks when changing the tree or its selection controls. File writes and transfers still use the existing server APIs.
