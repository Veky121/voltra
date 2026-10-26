package panel

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
)

type fs25DLCLicence struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

func fs25Egg(egg M) bool {
	for _, feature := range asSlice(egg["features"]) {
		if str(feature) == "voltra_fs25" {
			return true
		}
	}
	return false
}

func fs25LicenceKeys(env M) (map[string]bool, error) {
	keys := map[string]bool{}
	add := func(value string) {
		value = strings.Map(func(r rune) rune {
			if r == '-' || unicode.IsSpace(r) {
				return -1
			}
			return unicode.ToUpper(r)
		}, value)
		if value != "" {
			keys[value] = true
		}
	}
	add(str(env["GAME_SERIAL"]))
	raw := strings.TrimSpace(str(env["DLC_PRODUCT_KEY"]))
	if strings.HasPrefix(raw, "[") {
		var entries []fs25DLCLicence
		if json.Unmarshal([]byte(raw), &entries) != nil {
			return nil, bad("Admin DLC licence configuration is invalid.")
		}
		for _, entry := range entries {
			add(entry.Key)
		}
	} else {
		add(raw)
	}
	return keys, nil
}

type fs25LicenceQuery interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (a *App) fs25LicenceConflict(ctx context.Context, q fs25LicenceQuery, serverID int64, env M) (bool, error) {
	keys, err := fs25LicenceKeys(env)
	if err != nil {
		return false, err
	}
	if len(keys) == 0 {
		return false, nil
	}
	rows, err := q.Query(ctx, `SELECT ev.env_variable,sis.value FROM server_integration_secrets sis JOIN servers s ON s.id=sis.server_id JOIN egg_variables ev ON ev.id=sis.variable_id JOIN eggs e ON e.id=s.egg_id WHERE s.id<>$1 AND e.features @> '["voltra_fs25"]'::jsonb AND ev.env_variable IN ('GAME_SERIAL','DLC_PRODUCT_KEY')`, serverID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, sealed string
		if err = rows.Scan(&name, &sealed); err != nil {
			return false, err
		}
		plain, e := a.unseal(sealed)
		if e != nil {
			return false, e
		}
		existing, e := fs25LicenceKeys(M{name: plain})
		if e != nil {
			return false, e
		}
		for key := range existing {
			if keys[key] {
				return true, nil
			}
		}
	}
	return false, rows.Err()
}

func (a *App) fs25ReserveLicences(ctx context.Context, tx pgx.Tx, serverID int64, env M) error {
	keys, err := fs25LicenceKeys(env)
	if err != nil {
		return err
	}
	ordered := []string{}
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	for _, key := range ordered {
		hash := sha256.Sum256([]byte(key))
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(binary.BigEndian.Uint64(hash[:8]))); err != nil {
			return err
		}
	}
	conflict, err := a.fs25LicenceConflict(ctx, tx, serverID, env)
	if err != nil {
		return err
	}
	if conflict {
		return bad("A GIANTS licence is already assigned to another server. Ask an administrator for an unused game or DLC licence.")
	}
	return nil
}

// Admin-only assignment. Ordinary startup APIs never receive key contents.
// Saved values use the existing encrypted per-server integration snapshots.
func (a *App) fs25Licences(w http.ResponseWriter, r *http.Request) {
	actor, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	server, err := a.lifecycleAdminServer(r)
	if err != nil {
		fail(w, err)
		return
	}
	egg, err := a.effectiveEgg(r.Context(), num(server["egg_id"]))
	if err != nil {
		fail(w, err)
		return
	}
	if !fs25Egg(egg) {
		fail(w, notFound())
		return
	}
	env, sources, err := a.integrationEnvironment(r.Context(), num(server["egg_id"]))
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == "PUT" {
		vars, e := a.eggVariables(r.Context(), num(server["egg_id"]))
		if e != nil {
			fail(w, e)
			return
		}
		tx, e := a.DB.Begin(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		if e = a.fs25ReserveLicences(r.Context(), tx, num(server["id"]), env); e != nil {
			fail(w, e)
			return
		}
		for _, v := range vars {
			name := str(v["env_variable"])
			if name == "DOWNLOAD_DLC" && str(env["DLC_PRODUCT_KEY"]) != "" {
				_, e = tx.Exec(r.Context(), `INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,'true') ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value='true'`, server["id"], v["id"])
				if e != nil {
					fail(w, e)
					return
				}
				continue
			}
			if name != "GAME_SERIAL" && name != "DLC_PRODUCT_KEY" {
				continue
			}
			text := str(env[name])
			if text == "" {
				continue
			} // Missing defaults preserve the server's current licence.
			sealed, e := a.seal(text)
			if e != nil {
				fail(w, e)
				return
			}
			_, e = tx.Exec(r.Context(), `INSERT INTO server_integration_secrets(server_id,variable_id,value,source) VALUES($1,$2,$3,'global') ON CONFLICT(server_id,variable_id) DO UPDATE SET value=excluded.value,source=excluded.source`, server["id"], v["id"], sealed)
			if e == nil {
				_, e = tx.Exec(r.Context(), `INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3) ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=excluded.variable_value`, server["id"], v["id"], integrationPlaceholder)
			}
			if e != nil {
				fail(w, e)
				return
			}
		}
		if e = tx.Commit(r.Context()); e != nil {
			fail(w, e)
			return
		}
		_ = a.audit(r.Context(), num(actor["id"]), num(server["id"]), "admin:fs25.licences.apply", M{})
	}
	current := M{}
	if err = a.resolveServerIntegrationSecrets(r.Context(), num(server["id"]), current); err != nil {
		fail(w, err)
		return
	}
	dlcs := []M{}
	var entries []fs25DLCLicence
	if json.Unmarshal([]byte(str(current["DLC_PRODUCT_KEY"])), &entries) == nil {
		for _, entry := range entries {
			dlcs = append(dlcs, M{"id": entry.ID, "name": entry.Name})
		}
	}
	writeJSON(w, 200, item("fs25_licences", M{"egg_id": server["egg_id"], "game_configured": str(current["GAME_SERIAL"]) != "", "dlcs": dlcs, "legacy_dlc_configured": len(entries) == 0 && str(current["DLC_PRODUCT_KEY"]) != "", "available": sources, "applies": "next_start"}))
}
