package panel

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"strconv"
	"strings"
)

func satisfactoryPlayersDocument(egg M, file string) bool {
	return steamGameID(egg) == "satisfactory" && file == "/FactoryGame/Saved/Config/LinuxServer/Game.ini"
}

// Bind admission to durable authority, including helper ownership and controls.
// Recheck after the lock and immediately before publishing native bytes.
func (a *App) satisfactoryPlayersAuthority(ctx context.Context, server, egg M, file string) (string, error) {
	if !satisfactoryPlayersDocument(egg, file) {
		return "", nil
	}
	row, err := a.one(ctx, `SELECT row_to_json(s)::text AS server, row_to_json(st)::text AS steam,
 (SELECT json_agg(v ORDER BY v.id)::text FROM server_variables v WHERE v.server_id=s.id) AS variables,
 (SELECT json_agg(j ORDER BY j.id)::text FROM steam_jobs j WHERE j.server_id=s.id AND j.status IN ('queued','running')) AS active
 FROM servers s JOIN steam_servers st ON st.server_id=s.id WHERE s.id=$1`, server["id"])
	if err != nil {
		return "", err
	}
	if str(row["active"]) != "" {
		return "", APIError{409, "SteamMaintenanceActive", "Wait for Steam maintenance before changing settings."}
	}
	b, err := json.Marshal(row)
	return string(b), err
}
func (a *App) checkSatisfactoryPlayersAuthority(ctx context.Context, server, egg M, file, before string) error {
	if before == "" {
		return nil
	}
	current, err := a.satisfactoryPlayersAuthority(ctx, server, egg, file)
	if err != nil {
		return err
	}
	if current != before {
		return APIError{409, "GameSettingsAuthorityChanged", "Managed settings changed. Reload before saving."}
	}
	return nil
}
func (a *App) persistSatisfactoryPlayers(ctx context.Context, tx pgx.Tx, server, egg M, file string, patch map[string]string) error {
	if !satisfactoryPlayersDocument(egg, file) {
		return nil
	}
	for key, value := range patch {
		if !strings.EqualFold(key, "/Script/Engine.GameSession/MaxPlayers") {
			continue
		}
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 1 || n > 2147483647 {
			return bad("Invalid Maximum players.")
		}
		startup, err := steamCatalogPlayersStartup(str(server["startup"]), n)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE servers SET startup=$2,updated_at=now() WHERE id=$1`, server["id"], startup); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,$3 FROM egg_variables WHERE egg_id=$2 AND env_variable='MAX_PLAYERS' ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=EXCLUDED.variable_value,updated_at=now()`, server["id"], server["egg_id"], strconv.FormatInt(n, 10))
		return err
	}
	return nil
}
