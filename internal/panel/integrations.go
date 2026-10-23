package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

const integrationPlaceholder = "[global integration]"

// Credentials are write-only to the panel. Only authenticated Wings configuration
// receives the resolved values. Per-server snapshots survive global edits/removal.
func (a *App) registerIntegrations(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/integrations", a.integrationsList)
	mux.HandleFunc("POST /api/admin/integrations", a.integrationSave)
	mux.HandleFunc("PATCH /api/admin/integrations/{integration}", a.integrationSave)
	mux.HandleFunc("DELETE /api/admin/integrations/{integration}", a.integrationDelete)
	mux.HandleFunc("GET /api/admin/integrations/defaults/{egg}", a.integrationDefaults)
}

var integrationFields = map[string][]string{
	"cloudflare":   {"api_token", "account_id", "zone_id"},
	"curseforge":   {"api_key"},
	"steam":        {"username", "password", "web_api_key"},
	"modrinth":     {"api_token"},
	"game_license": {"license_key"},
	"custom":       {"username", "password", "api_key", "license_key"},
}
var integrationEnvName = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)

func integrationPublic(row M, credentials M) M {
	configured := M{}
	for _, field := range integrationFields[str(row["provider"])] {
		configured[field] = str(credentials[field]) != ""
	}
	return M{"id": row["id"], "name": row["name"], "provider": row["provider"], "enabled": row["enabled"], "egg_id": row["egg_id"], "bindings": row["bindings"], "configured_fields": configured, "created_at": row["created_at"], "updated_at": row["updated_at"]}
}
func (a *App) integrationCredentials(row M) (M, error) {
	raw, err := a.unseal(str(row["credentials"]))
	if err != nil {
		return nil, err
	}
	credentials := M{}
	err = json.Unmarshal([]byte(raw), &credentials)
	return credentials, err
}
func (a *App) integrationsList(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	records, err := a.query(r.Context(), "SELECT * FROM integrations ORDER BY name,id")
	if err != nil {
		fail(w, err)
		return
	}
	out := []M{}
	for _, row := range records {
		credentials, err := a.integrationCredentials(row)
		if err != nil {
			fail(w, err)
			return
		}
		out = append(out, integrationPublic(row, credentials))
	}
	writeJSON(w, 200, collection("integration", out))
}
func (a *App) integrationSave(w http.ResponseWriter, r *http.Request) {
	actor, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	// Preserve password whitespace and distinguish blank replacements from null.
	input, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	credentials := M{}
	row := M{"enabled": true, "bindings": M{}}
	id := num(r.PathValue("integration"))
	if r.Method == "PATCH" {
		row, err = a.one(ctx, "SELECT * FROM integrations WHERE id=$1", id)
		if err != nil {
			fail(w, err)
			return
		}
		credentials, err = a.integrationCredentials(row)
		if err != nil {
			fail(w, err)
			return
		}
	}
	for _, key := range []string{"name", "provider", "enabled", "egg_id", "bindings"} {
		if value, ok := input[key]; ok {
			row[key] = value
		}
	}
	name, ok := row["name"].(string)
	if !ok || strings.TrimSpace(name) == "" || len(name) > 191 {
		fail(w, bad("Enter an integration name of at most 191 characters."))
		return
	}
	fields, ok := integrationFields[str(row["provider"])]
	if !ok {
		fail(w, bad("Select a supported integration provider."))
		return
	}
	if _, ok := row["enabled"].(bool); !ok {
		fail(w, bad("enabled must be a boolean."))
		return
	}
	if r.Method == "PATCH" {
		old, e := a.one(ctx, "SELECT provider FROM integrations WHERE id=$1", id)
		if e != nil {
			fail(w, e)
			return
		}
		if old["provider"] != row["provider"] {
			fail(w, bad("The provider cannot be changed. Create another integration instead."))
			return
		}
	}
	if row["egg_id"] != nil {
		eggID, valid := applicationInteger(row["egg_id"])
		if !valid || eggID <= 0 {
			fail(w, bad("Select a valid egg scope."))
			return
		}
		if _, e := a.one(ctx, "SELECT id FROM eggs WHERE id=$1", eggID); e != nil {
			fail(w, bad("Select a valid egg scope."))
			return
		}
		row["egg_id"] = eggID
	}
	if str(row["provider"]) == "game_license" && row["egg_id"] == nil {
		fail(w, bad("Game licences must be scoped to a specific egg."))
		return
	}
	allowed := map[string]bool{}
	for _, field := range fields {
		allowed[field] = true
	}
	if value, present := input["credentials"]; present {
		incoming, valid := value.(map[string]any)
		if !valid {
			fail(w, bad("credentials must be an object."))
			return
		}
		for field, value := range incoming {
			if !allowed[field] {
				fail(w, bad("Unknown credential field."))
				return
			}
			if value == nil {
				delete(credentials, field)
				continue
			}
			text, valid := value.(string)
			if !valid || len(text) > 16384 {
				fail(w, bad("Credentials must be strings of at most 16384 characters."))
				return
			}
			// Empty replacement inputs keep the saved credential; null clears it.
			if text != "" {
				credentials[field] = text
			}
		}
	}
	bindings := asMap(row["bindings"])
	switch row["bindings"].(type) {
	case nil, M:
	default:
		fail(w, bad("bindings must be an object."))
		return
	}
	seen := map[string]bool{}
	for field, value := range bindings {
		if !allowed[field] {
			fail(w, bad("Unknown credential binding."))
			return
		}
		names, ok := value.([]any)
		if !ok || len(names) > 20 {
			fail(w, bad("Each binding must be a list of environment variable names."))
			return
		}
		for _, value := range names {
			name, ok := value.(string)
			if !ok || len(name) > 191 || !integrationEnvName.MatchString(name) || seen[name] {
				fail(w, bad("Use unique uppercase environment variable names for bindings."))
				return
			}
			if name == "STARTUP" || strings.HasPrefix(name, "P_SERVER_") {
				fail(w, bad("Reserved environment variables cannot be bound."))
				return
			}
			seen[name] = true
			if str(credentials[field]) == "" {
				fail(w, bad("Save a credential before mapping it to an egg variable."))
				return
			}
		}
	}
	raw, err := json.Marshal(credentials)
	if err != nil {
		fail(w, err)
		return
	}
	sealed, err := a.seal(string(raw))
	if err != nil {
		fail(w, err)
		return
	}
	data := M{"name": strings.TrimSpace(name), "provider": row["provider"], "enabled": row["enabled"], "egg_id": row["egg_id"], "bindings": bindings, "credentials": sealed}
	var saved M
	if r.Method == "POST" {
		saved, err = a.insert(ctx, "integrations", data)
	} else {
		saved, err = a.update(ctx, "integrations", id, data)
	}
	if err != nil {
		fail(w, err)
		return
	}
	_ = a.audit(ctx, num(actor["id"]), 0, "admin:integration.save", M{"integration_id": saved["id"], "provider": saved["provider"]})
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	writeJSON(w, status, item("integration", integrationPublic(saved, credentials)))
}
func (a *App) integrationDelete(w http.ResponseWriter, r *http.Request) {
	actor, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	row, err := a.one(r.Context(), "DELETE FROM integrations WHERE id=$1 RETURNING id,provider", num(r.PathValue("integration")))
	if err != nil {
		fail(w, err)
		return
	}
	_ = a.audit(r.Context(), num(actor["id"]), 0, "admin:integration.delete", M{"integration_id": row["id"], "provider": row["provider"]})
	w.WriteHeader(http.StatusNoContent)
}

// Only explicitly mapped variables declared by this egg can receive credentials.
// Egg-specific records override global records. Ambiguous records fail closed.
func (a *App) integrationEnvironment(ctx context.Context, eggID int64) (M, M, error) {
	vars, err := a.eggVariables(ctx, eggID)
	if err != nil {
		return nil, nil, err
	}
	declared := map[string]bool{}
	for _, v := range vars {
		declared[str(v["env_variable"])] = true
	}
	records, err := a.query(ctx, "SELECT * FROM integrations WHERE enabled=true AND (egg_id IS NULL OR egg_id=$1) ORDER BY (egg_id IS NULL),id", eggID)
	if err != nil {
		return nil, nil, err
	}
	env, sources := M{}, M{}
	specific := map[string]bool{}
	for _, row := range records {
		var credentials M
		for field, names := range asMap(row["bindings"]) {
			for _, value := range asSlice(names) {
				name := str(value)
				if !declared[name] {
					continue
				}
				scoped := row["egg_id"] != nil
				if _, exists := env[name]; exists && specific[name] && !scoped {
					continue
				}
				if _, exists := env[name]; exists && specific[name] == scoped {
					return nil, nil, bad("Multiple integrations map to " + name + ". Disable one or choose an egg scope.")
				}
				if credentials == nil {
					credentials, err = a.integrationCredentials(row)
					if err != nil {
						return nil, nil, err
					}
				}
				if str(credentials[field]) == "" {
					continue
				}
				env[name] = credentials[field]
				sources[name] = M{"integration_id": row["id"], "name": row["name"], "field": field}
				specific[name] = scoped
			}
		}
	}
	return env, sources, nil
}
func (a *App) integrationDefaults(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	eggID := num(r.PathValue("egg"))
	if _, err := a.one(r.Context(), "SELECT id FROM eggs WHERE id=$1", eggID); err != nil {
		fail(w, err)
		return
	}
	_, sources, err := a.integrationEnvironment(r.Context(), eggID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("integration_defaults", M{"variables": sources}))
}
func (a *App) serverIntegrationSecrets(ctx context.Context, serverID int64) ([]M, error) {
	return a.query(ctx, "SELECT s.variable_id,s.value,s.source,ev.env_variable FROM server_integration_secrets s JOIN egg_variables ev ON ev.id=s.variable_id JOIN servers srv ON srv.id=s.server_id AND srv.egg_id=ev.egg_id WHERE s.server_id=$1", serverID)
}
func (a *App) resolveServerIntegrationSecrets(ctx context.Context, serverID int64, env M) error {
	secrets, err := a.serverIntegrationSecrets(ctx, serverID)
	if err != nil {
		return err
	}
	for _, secret := range secrets {
		value, err := a.unseal(str(secret["value"]))
		if err != nil {
			return err
		}
		env[str(secret["env_variable"])] = value
	}
	return nil
}
func (a *App) maskIntegrationVariables(ctx context.Context, serverID int64, vars []M) error {
	secrets, err := a.serverIntegrationSecrets(ctx, serverID)
	if err != nil {
		return err
	}
	names := map[string]string{}
	for _, secret := range secrets {
		names[str(secret["env_variable"])] = str(secret["source"])
	}
	for _, v := range vars {
		if source, exists := names[str(v["env_variable"])]; exists {
			v["server_value"] = integrationPlaceholder
			v["secret"] = true
			if source != "server" {
				v["user_editable"] = false
			}
		}
	}
	return nil
}
