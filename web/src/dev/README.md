# Development demo

Open `http://localhost:5180/admin?demo=1` or use **Try demo data** in the Vite development server. The choice lasts for the current browser tab. **Exit demo** reloads the normal panel.

The demo contains two nodes and five servers, with static capacity, usage, console history, files, backups and schedules. Other pages explicitly report when no fixture exists. Favorites and recents are temporary; server operations and configuration saves are rejected. Appearance remains a local browser preference under a separate demo account.

Minecraft Survival and Creative Sandbox also include `server.properties`, Java runtimes and heap settings, startup variables, resource limits, and sample mount/process configuration. Open `/server/demo-survival/settings?demo=1` or `/server/demo-survival/runtime?demo=1`. Survival is running, so native settings retain their stop requirement; Creative Sandbox is stopped and allows local drafts. Saves are rejected in both cases. Samples describe no actual installation, filesystem or connected node.

The demo replaces API fetches before the app mounts and blocks live sockets, event streams, uploads and beacons. It creates no backend records and needs no backend. Keep unknown API requests blocked instead of forwarding them to a real panel.

`main.tsx` loads this directory only behind `import.meta.env.DEV`, excluding desktop mode. Vite production builds remove the import, fixtures and demo controls. The backend's `DEV_MODE` does not enable this preview. Do not import these files from normal application components or copy them to `public`.

Check fixtures with `node --experimental-strip-types --test web/tests/devDemo.test.mjs` from the repository root. When changing the bootstrap, verify the production output contains no demo module or fixture strings.
