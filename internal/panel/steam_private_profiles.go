package panel

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"voltra/internal/steamapi"
)

// Only exact imported recipe identities can select a private catalog policy.
// User-editable app IDs, names and environment values grant no policy.
func privateContentProfile(ctx context.Context, q steamHistoryQuerier, server M) (steamapi.PrivateAppProfile, string, error) {
	state, err := queryRowMap(q.QueryRow(ctx, "SELECT row_to_json(st) FROM steam_servers st WHERE server_id=$1", server["id"]))
	if err == nil {
		if profile, ok := steamapi.PrivateProfile(uint32(num(state["app_id"]))); ok {
			return profile, str(state["branch"]), nil
		}
		return steamapi.PrivateAppProfile{}, "", pgx.ErrNoRows
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return steamapi.PrivateAppProfile{}, "", err
	}
	egg, err := queryRowMap(q.QueryRow(ctx, "SELECT row_to_json(e) FROM eggs e WHERE id=$1", server["egg_id"]))
	if err != nil {
		return steamapi.PrivateAppProfile{}, "", err
	}
	for _, entry := range gameTemplates().Entries {
		if privateTemplateApp(entry) == 0 || str(server["startup"]) != str(entry.Egg["startup"]) {
			continue
		}
		identity := str(egg["uuid"]) == gameTemplateEggUUID(entry)
		identity = identity || str(egg["uuid"]) == gameTemplateEggUUID(privatePreparationIdentity(entry))
		if !identity {
			continue
		}
		for _, image := range asMap(entry.Egg["docker_images"]) {
			if str(server["image"]) == str(image) {
				profile, ok := privateTemplatePolicy(entry)
				if !ok {
					continue
				}
				branch := "public"
				for _, field := range asSlice(templateSteamControls(entry)["branch"]) {
					name := str(asMap(field)["environment"])
					row, e := queryRowMap(q.QueryRow(ctx, "SELECT row_to_json(v) FROM (SELECT sv.variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable=$2 ORDER BY ev.id LIMIT 1) v", server["id"], name))
					if e != nil && !errors.Is(e, pgx.ErrNoRows) {
						return steamapi.PrivateAppProfile{}, "", e
					}
					if value := str(row["variable_value"]); value != "" {
						branch = value
						break
					}
				}
				return profile, branch, nil
			}
		}
	}
	return steamapi.PrivateAppProfile{}, "", pgx.ErrNoRows
}
