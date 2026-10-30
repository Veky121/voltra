package panel

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func startupSecretName(name string) bool {
	name = strings.ToUpper(name)
	if name == "GAME_SERIAL" || name == "DLC_PRODUCT_KEY" {
		return true
	}
	for _, part := range []string{"PASSWORD", "PASSWD", "PASSPHRASE", "TOKEN", "SECRET", "API_KEY", "APIKEY", "PRIVATE_KEY", "ACCESS_KEY", "LICENSE_KEY", "LICENCE_KEY", "CREDENTIAL"} {
		if strings.Contains(name, part) {
			return true
		}
	}
	return strings.HasSuffix(name, "_PASS") || strings.HasSuffix(name, "_PWD") || strings.HasSuffix(name, "BETAPASS") || name == "ADMINPWD" || name == "SERVERPWD" || name == "STEAM_AUTH"
}

var startupSecretArgument = regexp.MustCompile(`(?i)((?:--?[a-z0-9_.-]*(?:password|passwd|token|secret|api[_-]?key)[a-z0-9_.-]*|[a-z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY))\s*(?:=|\s)\s*)(?:"[^"]*"|'[^']*'|[^\s]+)`)

func maskStartupArguments(command string) string {
	return startupSecretArgument.ReplaceAllString(command, "${1}[hidden]")
}

// Public startup metadata never returns saved secret contents or secret defaults.
func (a *App) annotateStartupFields(ctx context.Context, server M, variables []M) error {
	secrets, err := a.serverIntegrationSecrets(ctx, num(server["id"]))
	if err != nil {
		return err
	}
	configured := map[string]bool{}
	for _, secret := range secrets {
		plain, e := a.unseal(str(secret["value"]))
		if e != nil {
			return e
		}
		configured[str(secret["env_variable"])] = plain != ""
	}
	for _, v := range variables {
		key := str(v["env_variable"])
		_, encrypted := configured[key]
		v["is_overridden"] = boolean(v["is_overridden"]) || encrypted
		v["can_reset"] = boolean(v["user_editable"]) && boolean(v["is_overridden"]) && !boolean(v["secret"])
		if startupSecretName(key) || str(v["field_type"]) == "password" || boolean(v["secret"]) || encrypted {
			present := str(v["server_value"]) != "" && str(v["server_value"]) != integrationPlaceholder
			if encrypted {
				present = configured[key]
			} else if boolean(v["secret"]) {
				present = boolean(v["configured"]) || present
			}
			v["secret"], v["secret_configured"], v["configured"] = true, present, present
			v["default_value"], v["server_value"] = "", ""
			v["can_reset"] = boolean(v["user_editable"]) && boolean(v["is_overridden"])
		}
	}
	return nil
}

// Secret writes and resets retain ordinary startup permissions. This helper
// saves values for the next start and never issues a power or reinstall call.
func (a *App) saveStartupField(w http.ResponseWriter, r *http.Request, server, changed, input M, rawValue any) {
	ctx := r.Context()
	reset := boolean(input["reset"])
	original, err := a.one(ctx, `SELECT ev.*,sv.id IS NOT NULL AS is_overridden,COALESCE(sv.variable_value,ev.default_value) AS server_value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.id=$2 AND ev.egg_id=$3`, server["id"], changed["id"], server["egg_id"])
	if err != nil {
		fail(w, err)
		return
	}
	next := rawValue
	if reset {
		next = original["default_value"]
	}
	if boolean(changed["secret"]) {
		if _, ok := next.(string); !ok {
			fail(w, bad("Enter a string value for this secret."))
			return
		}
	}
	validationData := M{}
	for key, value := range input {
		validationData[key] = value
	}
	validationData["value"] = next
	validation := M{"__egg_validation_data": validationData, "__egg_variable": "value"}
	if err = a.validateEggValue(ctx, next, true, str(original["rules"]), validation); err != nil {
		fail(w, err)
		return
	}
	value := eggEnvironmentString(next)
	handled, err := a.steamCatalogUpdateVariable(ctx, server, changed, value)
	if err != nil {
		fail(w, err)
		return
	}
	if handled {
		if err = a.annotateStartupFields(ctx, server, []M{changed}); err != nil {
			fail(w, err)
			return
		}
		a.opAudit(r, server, "server:startup.edit", M{"variable": input["key"], "configured": value != ""})
		writeJSON(w, 200, item("egg_variable", opVariable(changed)))
		return
	}
	lockTx, err := a.DB.Begin(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	defer lockTx.Rollback(context.Background())
	if _, err = lockTx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", server["id"]); err != nil {
		fail(w, err)
		return
	}
	lock := "voltra:server-mutation:" + str(server["uuid"])
	if _, err = lockTx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", lock); err != nil {
		fail(w, err)
		return
	}
	fresh, err := a.server(r, "startup.update")
	if err != nil {
		fail(w, err)
		return
	}
	server = fresh
	old, oldErr := a.one(ctx, "SELECT variable_value FROM server_variables WHERE server_id=$1 AND variable_id=$2", server["id"], changed["id"])
	if oldErr != nil && !errors.Is(oldErr, pgx.ErrNoRows) {
		fail(w, oldErr)
		return
	}
	secret, secretErr := a.one(ctx, "SELECT value,source FROM server_integration_secrets WHERE server_id=$1 AND variable_id=$2", server["id"], changed["id"])
	if secretErr != nil && !errors.Is(secretErr, pgx.ErrNoRows) {
		fail(w, secretErr)
		return
	}
	if secretErr == nil && str(secret["source"]) != "server" && !a.isFS25Password(ctx, server, str(changed["env_variable"])) {
		fail(w, forbidden())
		return
	}
	var sealed string
	if !reset && boolean(changed["secret"]) && value != "" {
		sealed, err = a.seal(value)
		if err != nil {
			fail(w, err)
			return
		}
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, "DELETE FROM server_integration_secrets WHERE server_id=$1 AND variable_id=$2", server["id"], changed["id"])
	if err == nil {
		if reset {
			_, err = tx.Exec(ctx, "DELETE FROM server_variables WHERE server_id=$1 AND variable_id=$2", server["id"], changed["id"])
		} else {
			stored := value
			if sealed != "" {
				stored = integrationPlaceholder
			}
			_, err = tx.Exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3) ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=excluded.variable_value,updated_at=now()`, server["id"], changed["id"], stored)
		}
	}
	if err == nil && sealed != "" {
		_, err = tx.Exec(ctx, "INSERT INTO server_integration_secrets(server_id,variable_id,value,source) VALUES($1,$2,$3,'server')", server["id"], changed["id"], sealed)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		fail(w, err)
		return
	}
	if err = a.syncServer(ctx, server); err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		restore, e := a.DB.Begin(cleanup)
		if e == nil {
			_, e = restore.Exec(cleanup, "DELETE FROM server_variables WHERE server_id=$1 AND variable_id=$2", server["id"], changed["id"])
			if e == nil {
				_, e = restore.Exec(cleanup, "DELETE FROM server_integration_secrets WHERE server_id=$1 AND variable_id=$2", server["id"], changed["id"])
			}
			if e == nil && oldErr == nil {
				_, e = restore.Exec(cleanup, "INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3)", server["id"], changed["id"], old["variable_value"])
			}
			if e == nil && secretErr == nil {
				_, e = restore.Exec(cleanup, "INSERT INTO server_integration_secrets(server_id,variable_id,value,source) VALUES($1,$2,$3,$4)", server["id"], changed["id"], secret["value"], secret["source"])
			}
			if e == nil {
				e = restore.Commit(cleanup)
			} else {
				_ = restore.Rollback(cleanup)
			}
		}
		if e == nil {
			e = a.syncServer(cleanup, server)
		}
		if boolean(changed["secret"]) {
			fail(w, APIError{http.StatusBadGateway, "StartupSecretSyncFailed", "Could not synchronize the secret with the node. Reload this setting before retrying."})
		} else {
			fail(w, errors.Join(err, e))
		}
		return
	}
	changed["server_value"] = value
	changed["configured"], changed["secret_configured"] = value != "", value != ""
	changed["is_overridden"] = !reset
	if err = a.annotateStartupFields(ctx, server, []M{changed}); err != nil {
		fail(w, err)
		return
	}
	a.opAudit(r, server, "server:startup.edit", M{"variable": input["key"], "reset": reset, "configured": value != ""})
	response := item("egg_variable", opVariable(changed))
	response["meta"] = M{"applies": "next_start"}
	writeJSON(w, 200, response)
}

// Reveal is explicit and requires both startup permissions. Admin integration
// credentials remain private even when their variable is visible.
func (a *App) revealStartupField(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	server, err := a.server(r, "startup.read")
	if err != nil {
		fail(w, err)
		return
	}
	if _, err = a.server(r, "startup.update"); err != nil {
		fail(w, err)
		return
	}
	v, err := a.one(r.Context(), `SELECT ev.user_viewable,COALESCE(sv.variable_value,ev.default_value) AS value,ss.value AS sealed,ss.source FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 LEFT JOIN server_integration_secrets ss ON ss.variable_id=ev.id AND ss.server_id=$1 WHERE ev.egg_id=$2 AND ev.env_variable=$3`, server["id"], server["egg_id"], r.PathValue("key"))
	if err != nil {
		fail(w, notFound())
		return
	}
	visible := boolean(v["user_viewable"])
	if !visible {
		egg, e := a.one(r.Context(), "SELECT features FROM eggs WHERE id=$1", server["egg_id"])
		key := r.PathValue("key")
		visible = e == nil && fs25Egg(egg) && (key == "WEB_PASSWORD" || key == "GAME_PASSWORD" || key == "ADMIN_PASSWORD")
	}
	if !visible || (str(v["source"]) != "" && str(v["source"]) != "server" && !a.isFS25Password(r.Context(), server, r.PathValue("key"))) {
		fail(w, forbidden())
		return
	}
	value := str(v["value"])
	if str(v["sealed"]) != "" {
		value, err = a.unseal(str(v["sealed"]))
		if err != nil {
			fail(w, err)
			return
		}
	}
	a.opAudit(r, server, "server:startup.reveal", M{"variable": r.PathValue("key")})
	writeJSON(w, 200, item("startup_value", M{"value": value}))
}

// Early FS25 installs marked user passwords as integration-owned. These three
// game credentials remain owner-editable, independently of licence credentials.
func (a *App) isFS25Password(ctx context.Context, server M, key string) bool {
	if key != "WEB_PASSWORD" && key != "GAME_PASSWORD" && key != "ADMIN_PASSWORD" {
		return false
	}
	egg, err := a.one(ctx, "SELECT features FROM eggs WHERE id=$1", server["egg_id"])
	return err == nil && fs25Egg(egg)
}
