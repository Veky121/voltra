# Minecraft pack updates

Both the guided installer and the original pack adapter use the same content
publication transaction. Stop the server before reinstalling or updating a pack.

- `mods/`, `kubejs/`, and `scripts/` are replaced with the selected pack contents.
  Files absent from the new pack are removed, including manually added mods.
- `config/` and `defaultconfigs/` start with the selected pack defaults. Unchanged
  configs update; detected edits are copied to `.voltra/overrides/` and reapplied.
- On the first update without a baseline, existing configs are conservatively
  treated as user files. Review these overrides for compatibility with new mods.
- Worlds, configured level-name worlds, server properties, EULA, player lists,
  usercache, local data and JVM arguments remain user-owned.
- Libraries and launch files follow their installer-specific upgrade rules.
  This is not a universal policy for arbitrary pack-specific save folders.

## User configs

Mirror the config path below the server-root `.voltra/overrides/` folder:

```text
.voltra/overrides/
  config/example.toml
  defaultconfigs/example-server.toml
```

Existing `VOLTRA_OVERRIDE/` files migrate into `.voltra/overrides/` after a
successful reinstall/update. The old directory is then removed. Files from both
locations are merged; different contents at the same path stop the installation
before pack content changes. Resolve those conflicts manually and retry. A caught
publication failure restores both original locations.

Edit the override copy after it has been created. It wins over pack defaults on
subsequent installations. Publisher archives cannot write this folder. Only
`config/` and `defaultconfigs/` are allowed inside it; mods cannot be overlaid.
These are whole-file overrides, not a merge of individual settings. A config
may need manual migration when its mod changes format. Defaultconfigs affect
new worlds; existing world/serverconfig files are preserved with the world.

The pack baseline and applied override paths are recorded in
`.voltra/minecraft-pack-content.json`. Config values are not printed to logs.
Directory changes roll back on a caught publication error. This does not provide
crash/power-loss recovery or replace the normal saved-data backup.

Source changes must be included in a new panel build and the relevant installed
installer script refreshed before an existing server can use this behavior.

## Imported CurseForge Generic eggs

The original imported CurseForge Generic shell installer is also served through
clean staging and the shared directory publication transaction. Its exact script
identity is checked at the remote installer endpoint; custom administrator scripts
are not rewritten. This preserves its native loader installation and startup
layout while clearing obsolete mod filenames. An incomplete staged mod folder
fails before changing the active mod set. The final mod filenames and SHA-256
hashes must match staging before success is reported.

The installed set is recorded in `.voltra/curseforge-pack-install.json`.
