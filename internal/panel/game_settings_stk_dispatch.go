package panel

import (
	"context"
	"regexp"
)

var stkSettingsFilename = regexp.MustCompile(`^[A-Za-z0-9_.-]+\.xml$`)

func nativeSettingsIsSTK(egg M) bool {
	return nativeSettingsIsRecipe(egg, "SuperTuxKart/egg-super-tux-kart.json")
}

func stkSettingsPath(name string) (string, error) {
	if len(name) > 100 || !stkSettingsFilename.MatchString(name) || name == ".xml" {
		return "", bad("Choose a safe root XML filename in CONFIG_NAME before editing settings.")
	}
	return "/" + name, nil
}

func (a *App) prepareSTKSettingsEgg(ctx context.Context, server, egg M) error {
	if !nativeSettingsIsSTK(egg) {
		return nil
	}
	rows, err := a.query(ctx, "SELECT COALESCE(sv.variable_value,ev.default_value) AS value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 AND ev.env_variable='CONFIG_NAME'", server["id"], server["egg_id"])
	if err != nil {
		return err
	}
	if len(rows) > 1 {
		return bad("Ambiguous STK configuration filename.")
	}
	name := "config.xml"
	if len(rows) == 1 {
		name = str(rows[0]["value"])
	}
	file, err := stkSettingsPath(name)
	if err != nil {
		return err
	}
	egg["_stk_settings_path"] = file
	return nil
}
