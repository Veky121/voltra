package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func startupPasswordFixture(t *testing.T) (*operationsFixture, M) {
	t.Helper()
	f := operationsFixtureNew(t)
	v, err := f.a.insert(context.Background(), "egg_variables", M{"egg_id": f.server["egg_id"], "name": "Server password", "env_variable": "SERVER_PASSWORD", "default_value": "template-password", "rules": "nullable|string|max:100", "user_editable": true, "user_viewable": true})
	if err != nil {
		t.Fatal(err)
	}
	f.server, err = f.a.update(context.Background(), "servers", num(f.server["id"]), M{"startup": "run --password {{SERVER_PASSWORD}} --token=literal-token {{VISIBLE}}"})
	if err != nil {
		t.Fatal(err)
	}
	return f, v
}

func startupVariable(t *testing.T, response M, key string) M {
	t.Helper()
	for _, row := range asSlice(response["data"]) {
		v := asMap(asMap(row)["attributes"])
		if str(v["env_variable"]) == key {
			return v
		}
	}
	t.Fatalf("missing variable %s", key)
	return nil
}

func TestStartupFieldsMaskEncryptClearAndReset(t *testing.T) {
	f, variable := startupPasswordFixture(t)
	ctx := context.Background()
	get := f.request("GET", f.serverPath("/startup"), nil, f.owner)
	m := operationsExpect(t, get, 200)
	v := startupVariable(t, m, "SERVER_PASSWORD")
	if !boolean(v["secret"]) || !boolean(v["secret_configured"]) || boolean(v["can_reset"]) || strings.Contains(get.Body.String(), "template-password") || strings.Contains(get.Body.String(), "literal-token") {
		t.Fatal(get.Body.String())
	}
	password := "  opaque-password + % whitespace  "
	put := f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": password}, f.owner)
	v = asMap(operationsExpect(t, put, 200)["attributes"])
	if strings.Contains(put.Body.String(), password) || !boolean(v["secret_configured"]) || !boolean(v["can_reset"]) {
		t.Fatal(put.Body.String())
	}
	saved, err := f.a.one(ctx, "SELECT s.variable_value,i.value,i.source FROM server_variables s JOIN server_integration_secrets i ON i.server_id=s.server_id AND i.variable_id=s.variable_id WHERE s.server_id=$1 AND s.variable_id=$2", f.server["id"], variable["id"])
	if err != nil {
		t.Fatal(err)
	}
	plain, err := f.a.unseal(str(saved["value"]))
	if err != nil || plain != password || str(saved["source"]) != "server" || str(saved["variable_value"]) != integrationPlaceholder || strings.Contains(str(saved["value"]), password) {
		t.Fatal("secret persistence did not preserve an encrypted opaque value")
	}
	configuration, err := f.a.serverConfig(ctx, f.server)
	if err != nil || str(asMap(configuration["environment"])["SERVER_PASSWORD"]) != password {
		t.Fatalf("daemon did not receive its actual environment: %v", err)
	}
	get = f.request("GET", f.serverPath("/startup"), nil, f.owner)
	v = startupVariable(t, operationsExpect(t, get, 200), "SERVER_PASSWORD")
	if !boolean(v["is_editable"]) || !boolean(v["can_reset"]) || strings.Contains(get.Body.String(), password) {
		t.Fatal(get.Body.String())
	}
	clear := f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": ""}, f.owner)
	v = asMap(operationsExpect(t, clear, 200)["attributes"])
	if boolean(v["secret_configured"]) || !boolean(v["is_overridden"]) {
		t.Fatal(clear.Body.String())
	}
	reset := f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "reset": true}, f.owner)
	v = asMap(operationsExpect(t, reset, 200)["attributes"])
	if !boolean(v["secret_configured"]) || boolean(v["is_overridden"]) || boolean(v["can_reset"]) || strings.Contains(reset.Body.String(), "template-password") {
		t.Fatal(reset.Body.String())
	}
	var count int
	if err = f.a.DB.QueryRow(ctx, "SELECT count(*) FROM server_variables WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"]).Scan(&count); err != nil || count != 0 {
		t.Fatal("reset did not restore inheritance", err)
	}
	logs, err := f.a.query(ctx, "SELECT properties FROM activity_logs WHERE server_id=$1", f.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(logs)
	if strings.Contains(string(encoded), password) || strings.Contains(string(encoded), "template-password") {
		t.Fatal("audit leaked a secret")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.calls {
		if strings.HasSuffix(str(call["path"]), "/power") || strings.HasSuffix(str(call["path"]), "/reinstall") {
			t.Fatal("startup save changed power or installation")
		}
	}
}

func TestStartupFieldsPermissionValidationAndRollback(t *testing.T) {
	f, variable := startupPasswordFixture(t)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": "forbidden"}, f.sub), 403)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": 123}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "reset": "true"}, f.owner), 422)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": "previous"}, f.owner), 200)
	f.mu.Lock()
	f.failPath = "/sync"
	f.mu.Unlock()
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": "replacement"}, f.owner), 502)
	saved, err := f.a.one(context.Background(), "SELECT value FROM server_integration_secrets WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"])
	if err != nil {
		t.Fatal(err)
	}
	plain, err := f.a.unseal(str(saved["value"]))
	if err != nil || plain != "previous" {
		t.Fatal("failed sync did not restore the saved secret")
	}
	f.mu.Lock()
	f.failPath = ""
	f.mu.Unlock()
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "value": "changed"}, f.owner), 200)
	reset := f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "reset": true}, f.owner)
	v := asMap(operationsExpect(t, reset, 200)["attributes"])
	if str(v["server_value"]) != "visible" || boolean(v["is_overridden"]) {
		t.Fatal(reset.Body.String())
	}
}

func TestStartupFieldsAdminPreservesAndEncryptsSecrets(t *testing.T) {
	f, variable := startupPasswordFixture(t)
	f.a.registerLifecycle(f.mux)
	path := "/api/application/servers/" + str(f.server["id"]) + "/startup"
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": "initial-secret"}, f.owner), 200)
	for _, body := range []M{{"image": "alpine:3.23"}, {"environment": M{"SERVER_PASSWORD": "admin-replacement"}}, {"image": "alpine:3.23"}} {
		response := f.request("PATCH", path, body, f.admin)
		operationsExpect(t, response, 200)
		if strings.Contains(response.Body.String(), "initial-secret") || strings.Contains(response.Body.String(), "admin-replacement") {
			t.Fatal("admin startup returned a secret")
		}
	}
	saved, err := f.a.one(context.Background(), "SELECT value,source FROM server_integration_secrets WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"])
	if err != nil {
		t.Fatal(err)
	}
	plain, err := f.a.unseal(str(saved["value"]))
	if err != nil || plain != "admin-replacement" || str(saved["source"]) != "server" {
		t.Fatal("admin runtime did not preserve editable encrypted identity")
	}
}

func TestStartupFieldsLiteralPreviewMask(t *testing.T) {
	for _, command := range []string{`run --password "literal secret" --port 123`, `TOKEN=private-value run`, `run +rcon.password 'quoted password'`, `run --api-key=key-value`} {
		masked := maskStartupArguments(command)
		if masked == command || !strings.Contains(masked, "[hidden]") {
			t.Fatalf("unmasked argument %q", command)
		}
	}
}

func TestStartupRevealSavedValue(t *testing.T) {
	f, variable := startupPasswordFixture(t)
	path := f.serverPath("/startup/variable/SERVER_PASSWORD/reveal")
	operationsExpect(t, f.request("GET", path, nil, f.sub), 403)
	response := f.request("GET", path, nil, f.owner)
	value := asMap(operationsExpect(t, response, 200)["attributes"])
	if str(value["value"]) != "template-password" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("saved value or cache policy missing")
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_PASSWORD", "value": "saved-password"}, f.owner), 200)
	value = asMap(operationsExpect(t, f.request("GET", path, nil, f.owner), 200)["attributes"])
	if str(value["value"]) != "saved-password" {
		t.Fatal("encrypted saved value was not revealed")
	}
	if err := f.a.exec(context.Background(), "UPDATE server_integration_secrets SET source='integration' WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"]); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", path, nil, f.owner), 403)
}

func TestFS25LegacyPasswordsEditableAndRevealable(t *testing.T) {
	f, variable := startupPasswordFixture(t)
	ctx := context.Background()
	if err := f.a.exec(ctx, `UPDATE eggs SET features='["voltra_fs25"]'::jsonb WHERE id=$1`, f.server["egg_id"]); err != nil {
		t.Fatal(err)
	}
	if err := f.a.exec(ctx, "UPDATE egg_variables SET env_variable='WEB_PASSWORD',user_editable=false,user_viewable=false WHERE id=$1", variable["id"]); err != nil {
		t.Fatal(err)
	}
	sealed, err := f.a.seal("legacy-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.a.exec(ctx, "INSERT INTO server_integration_secrets(server_id,variable_id,value,source) VALUES($1,$2,$3,'integration')", f.server["id"], variable["id"], sealed); err != nil {
		t.Fatal(err)
	}
	v := startupVariable(t, operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.owner), 200), "WEB_PASSWORD")
	if !boolean(v["is_editable"]) {
		t.Fatal("legacy password is read-only")
	}
	path := f.serverPath("/startup/variable/WEB_PASSWORD/reveal")
	v = asMap(operationsExpect(t, f.request("GET", path, nil, f.owner), 200)["attributes"])
	if str(v["value"]) != "legacy-password" {
		t.Fatal("legacy password was not revealed")
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "WEB_PASSWORD", "value": "replacement-password"}, f.owner), 200)
	v = asMap(operationsExpect(t, f.request("GET", path, nil, f.owner), 200)["attributes"])
	if str(v["value"]) != "replacement-password" {
		t.Fatal("password was not changed")
	}
}
