package panel

import "context"

type gameFolderShortcut struct{ label, path string }

// These are navigation hints, never instructions to create directories. Probe
// actual Wings entries so missing folders and symlink parents stay protected.
func gameFolderShortcuts(egg M) []gameFolderShortcut {
	folders := []gameFolderShortcut{{"Game files", "/"}, {"Configuration", "/config"}, {"Saves", "/saves"}, {"Worlds", "/worlds"}, {"Logs", "/logs"}, {"Mods", "/mods"}, {"Plugins", "/plugins"}}
	profile, _ := gameSettingsProfile(egg)
	switch profile.Path {
	case "mindustry/egg-mindustry.json":
		folders = append(folders, gameFolderShortcut{"Saved games", "/config/saves"}, gameFolderShortcut{"Maps", "/config/maps"}, gameFolderShortcut{"Mods", "/config/mods"}, gameFolderShortcut{"Logs", "/config/logs"}, gameFolderShortcut{"Settings backups", "/config/settings_backups"})
	case "terraria/vanilla/egg-terraria-vanilla.json":
		folders = append(folders, gameFolderShortcut{"Saved worlds", "/saves/Worlds"})
	case soldatClassicRecipe:
		for _, name := range []string{"maps", "scripts", "textures", "scenery-gfx", "bots"} {
			folders = append(folders, gameFolderShortcut{name, "/" + name})
		}
	case soldat2Recipe:
		for _, name := range []string{"Levels", "Rules", "Modifiers", "Cycles", "Scripts"} {
			folders = append(folders, gameFolderShortcut{name, "/" + name})
		}
	case "beamng/kissmp/egg-kissmp.json":
		folders = append(folders, gameFolderShortcut{"Addons", "/addons"})
	}
	return folders
}

func (a *App) appendGameFolderShortcuts(ctx context.Context, server, egg M, folders []M) ([]M, error) {
	seen := map[string]bool{}
	for _, folder := range folders {
		seen[str(folder["path"])] = true
	}
	for _, folder := range gameFolderShortcuts(egg) {
		if seen[folder.path] {
			continue
		}
		exists, err := a.quickSetupFolderExists(ctx, server, folder.path)
		if err != nil {
			return nil, err
		}
		if exists {
			folders = append(folders, M{"label": folder.label, "path": folder.path})
			seen[folder.path] = true
		}
	}
	return folders, nil
}
