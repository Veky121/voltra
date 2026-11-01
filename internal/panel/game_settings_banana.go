package panel

import (
	"context"
	"regexp"
	"strings"
)

const bananaSettingsRecipe = "banana_shooter/egg-banana-shooter.json"

var bananaSettingsFolder = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

// The runtime selects a server folder, not an arbitrary filename or template.
// Keep this grammar identical to light-games-next-runtime.py config_path.
func bananaSettingsPath(name string) (string, error) {
	if !bananaSettingsFolder.MatchString(name) {
		return "", bad("Choose a safe Banana server folder in SERVER before editing settings.")
	}
	return "/Servers/" + name + "/Config.json", nil
}

// A narrow discovery getter, not permission to scan all server folders. Recheck
// even request-local context so a stale/foreign value cannot widen discovery.
func bananaSelectedSettingsDocument(egg M) string {
	if !nativeSettingsIsRecipe(egg, bananaSettingsRecipe) {
		return ""
	}
	file := str(egg["_banana_settings_path"])
	if !strings.HasPrefix(file, "/Servers/") || !strings.HasSuffix(file, "/Config.json") {
		return ""
	}
	name := strings.TrimSuffix(strings.TrimPrefix(file, "/Servers/"), "/Config.json")
	validated, err := bananaSettingsPath(name)
	if err != nil || validated != file {
		return ""
	}
	return file
}

// This is request-local context only. Discovery must still test the exact
// recipe and only consider this selected document when its regular file exists.
func (a *App) prepareBananaSettingsEgg(ctx context.Context, server, egg M) error {
	delete(egg, "_banana_settings_path")
	if !nativeSettingsIsRecipe(egg, bananaSettingsRecipe) {
		return nil
	}
	if num(server["id"]) <= 0 || num(server["egg_id"]) <= 0 {
		return bad("Valid Banana server context is required before resolving settings.")
	}
	rows, err := a.query(ctx, `SELECT COALESCE(sv.variable_value,ev.default_value) AS value
FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1
WHERE ev.egg_id=$2 AND ev.env_variable='SERVER'`, server["id"], server["egg_id"])
	if err != nil {
		return err
	}
	if len(rows) > 1 {
		return bad("Ambiguous Banana SERVER variable; inspect Runtime before editing settings.")
	}
	name := "PterodactylServer"
	if len(rows) == 1 {
		name = str(rows[0]["value"])
	}
	file, err := bananaSettingsPath(name)
	if err != nil {
		return err
	}
	egg["_banana_settings_path"] = file
	return nil
}
