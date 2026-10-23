package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIntegrationsSnapshotRoundTrip(t *testing.T) {
	ctx := context.Background()
	a := migrationTestApp(t)
	snapshot := migrationFixture()
	// Old snapshots remain importable without either new table.
	delete(snapshot.Tables, "integrations")
	delete(snapshot.Tables, "server_integration_secrets")
	if _, err := a.ImportLegacyWithOptions(ctx, migrationReader(t, snapshot), LegacyImportOptions{DryRun: true}); err != nil {
		t.Fatal(err)
	}
	snapshot.Tables["integrations"] = []M{{"id": 1, "name": "Saved account", "provider": "custom", "enabled": true, "credentials": `{"api_key":"snapshot-private-key"}`, "bindings": M{"api_key": []any{"VARIABLE"}}}}
	snapshot.Tables["server_integration_secrets"] = []M{{"server_id": 701, "variable_id": 601, "value": "server-private-key"}}
	snapshot.Tables["server_variables"][0]["variable_value"] = integrationPlaceholder
	if err := a.ImportLegacy(ctx, migrationReader(t, snapshot)); err != nil {
		t.Fatal(err)
	}
	var exported bytes.Buffer
	if err := a.ExportSnapshot(ctx, &exported); err != nil {
		t.Fatal(err)
	}
	b := migrationTestApp(t)
	b.Config.EncryptionKey = "different-integration-snapshot-key"
	if err := b.ImportLegacy(ctx, bytes.NewReader(exported.Bytes())); err != nil {
		t.Fatal(err)
	}
	row, err := b.one(ctx, "SELECT * FROM integrations WHERE id=1")
	if err != nil {
		t.Fatal(err)
	}
	credentials, err := b.integrationCredentials(row)
	if err != nil || credentials["api_key"] != "snapshot-private-key" {
		t.Fatal("global credentials lost in snapshot round trip")
	}
	env := M{}
	if err := b.resolveServerIntegrationSecrets(ctx, 701, env); err != nil || env["VARIABLE"] != "server-private-key" {
		t.Fatal("server credentials lost in snapshot round trip")
	}
}

func integrationTestJSON(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func TestIntegrationsCredentialsAndProvisioning(t *testing.T) {
	a, _, adminID := infraTestApp(t)
	mux := http.NewServeMux()
	a.registerIntegrations(mux)
	a.registerLifecycle(mux)
	a.registerOperations(mux)
	ctx := context.Background()
	insert := func(table string, data M) M {
		t.Helper()
		row, err := a.insert(ctx, table, data)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	user := insert("users", M{"uuid": newUUID(), "username": "integration-user", "email": "integration-user@example.invalid"})
	infraExpect(t, mux, num(user["id"]), "GET", "/api/admin/integrations", nil, 403)
	infraExpect(t, mux, num(user["id"]), "POST", "/api/admin/integrations", M{}, 403)
	location := insert("locations", M{"short": "integrations"})
	nest := insert("nests", M{"uuid": newUUID(), "name": "Integration tests", "author": "test@example.invalid"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "Credential test", "author": "test@example.invalid", "startup": "echo {{CF_API_KEY}}", "docker_images": M{"alpine": "alpine:3.21"}})
	variable := insert("egg_variables", M{"egg_id": egg["id"], "name": "API key", "env_variable": "CF_API_KEY", "default_value": "", "rules": "required|string|max:100", "user_viewable": true, "user_editable": true})
	path := "/api/admin/integrations"
	payload := M{"name": "CurseForge", "provider": "curseforge", "enabled": true, "credentials": M{"api_key": "test-private-api-key"}, "bindings": M{"api_key": []any{"CF_API_KEY"}}}
	created := asMap(infraExpect(t, mux, adminID, "POST", path, payload, 201)["attributes"])
	id := str(created["id"])
	for _, response := range []M{created, infraExpect(t, mux, adminID, "GET", path, nil, 200)} {
		if strings.Contains(integrationTestJSON(response), "test-private-api-key") || strings.Contains(integrationTestJSON(response), "enc:v1:") {
			t.Fatal("credential leaked through admin response")
		}
	}
	stored, err := a.one(ctx, "SELECT credentials FROM integrations WHERE id=$1", num(created["id"]))
	if err != nil || !strings.HasPrefix(str(stored["credentials"]), "enc:v1:") || strings.Contains(str(stored["credentials"]), "test-private-api-key") {
		t.Fatal("credential not encrypted")
	}
	infraExpect(t, mux, adminID, "PATCH", path+"/"+id, M{"name": "Renamed", "credentials": M{"api_key": ""}}, 200)
	defaults := infraExpect(t, mux, adminID, "GET", path+"/defaults/"+str(egg["id"]), nil, 200)
	if strings.Contains(integrationTestJSON(defaults), "test-private-api-key") || asMap(asMap(defaults["attributes"])["variables"])["CF_API_KEY"] == nil {
		t.Fatal("missing safe defaults metadata")
	}
	infraExpect(t, mux, adminID, "POST", path, M{"name": "Bad licence", "provider": "game_license", "credentials": M{"license_key": "test"}}, 422)
	infraExpect(t, mux, adminID, "PATCH", path+"/"+id, M{"bindings": M{"api_key": []any{"STARTUP"}}}, 422)
	infraExpect(t, mux, adminID, "PATCH", path+"/"+id, M{"credentials": M{"unknown": "test"}}, 422)
	infraExpect(t, mux, num(user["id"]), "PATCH", path+"/"+id, M{"enabled": false}, 403)
	infraExpect(t, mux, num(user["id"]), "DELETE", path+"/"+id, nil, 403)

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(202) }))
	defer daemon.Close()
	nodeData := daemonTestNode(t, daemon)
	nodeData["uuid"], nodeData["name"], nodeData["location_id"] = newUUID(), "Integration node", location["id"]
	nodeData["daemon_token"], _ = a.seal("secret")
	node := insert("nodes", nodeData)
	allocation := insert("allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25565})
	serverInput := M{"name": "Global credentials", "user": user["id"], "egg": egg["id"], "docker_image": "alpine:3.21", "startup": egg["startup"], "environment": M{}, "allocation": M{"default": allocation["id"]}, "limits": M{"memory": 128, "disk": 128, "io": 500, "cpu": 100, "swap": 0}}
	server, err := a.createServer(ctx, serverInput)
	if err != nil {
		t.Fatal(err)
	}
	serverID := str(server["id"])
	storedVariable, err := a.one(ctx, "SELECT variable_value FROM server_variables WHERE server_id=$1 AND variable_id=$2", server["id"], variable["id"])
	if err != nil || storedVariable["variable_value"] != integrationPlaceholder {
		t.Fatal("plaintext stored in server variable")
	}
	assertResolved := func(want string) {
		t.Helper()
		config, e := a.serverConfig(ctx, server)
		if e != nil || asMap(config["environment"])["CF_API_KEY"] != want {
			t.Fatalf("resolved config mismatch: %v", e)
		}
		public, e := a.applicationServer(ctx, server)
		if e != nil || strings.Contains(integrationTestJSON(public), "test-private-api-key") {
			t.Fatal("public environment leaked credential")
		}
	}
	assertResolved("test-private-api-key")
	if err = a.exec(ctx, "UPDATE servers SET status=NULL,installed_at=now() WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	server["status"] = nil
	startupPath := "/api/client/servers/" + str(server["uuid_short"]) + "/startup"
	startup := infraExpect(t, mux, num(user["id"]), "GET", startupPath, nil, 200)
	startupVariable := asMap(asMap(asSlice(startup["data"])[0])["attributes"])
	if strings.Contains(integrationTestJSON(startup), "test-private-api-key") || boolean(startupVariable["is_editable"]) || startupVariable["server_value"] != "" || !boolean(startupVariable["secret_configured"]) {
		t.Fatal("client startup leaked credentials")
	}
	infraExpect(t, mux, num(user["id"]), "PUT", startupPath+"/variable", M{"key": "CF_API_KEY", "value": "override"}, 422)
	publicClient, err := a.clientServer(ctx, user, server)
	if err != nil || strings.Contains(integrationTestJSON(publicClient), "test-private-api-key") {
		t.Fatal("client server leaked credentials")
	}
	infraExpect(t, mux, adminID, "PATCH", "/api/application/servers/"+serverID+"/startup", M{"environment": M{"CF_API_KEY": integrationPlaceholder}}, 200)
	assertResolved("test-private-api-key")
	infraExpect(t, mux, adminID, "PATCH", path+"/"+id, M{"credentials": M{"api_key": "updated-global-api-key"}}, 200)
	assertResolved("test-private-api-key")
	secondAllocation := insert("allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25566})
	serverInput["allocation"] = M{"default": secondAllocation["id"]}
	newServer, err := a.createServer(ctx, serverInput)
	if err != nil {
		t.Fatal(err)
	}
	newConfig, err := a.serverConfig(ctx, newServer)
	if err != nil || asMap(newConfig["environment"])["CF_API_KEY"] != "updated-global-api-key" {
		t.Fatal("new server did not inherit updated credentials")
	}
	thirdAllocation := insert("allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 25567})
	serverInput["allocation"] = M{"default": thirdAllocation["id"]}
	serverInput["environment"] = M{"CF_API_KEY": "explicit-server-key"}
	overrideServer, err := a.createServer(ctx, serverInput)
	if err != nil {
		t.Fatal(err)
	}
	overrideConfig, err := a.serverConfig(ctx, overrideServer)
	if err != nil || asMap(overrideConfig["environment"])["CF_API_KEY"] != "explicit-server-key" {
		t.Fatal("explicit creation override was ignored")
	}
	if secrets, e := a.serverIntegrationSecrets(ctx, num(overrideServer["id"])); e != nil || len(secrets) != 0 {
		t.Fatal("explicit override inherited global binding")
	}
	infraExpect(t, mux, adminID, "DELETE", path+"/"+id, nil, 204)
	assertResolved("test-private-api-key")
	infraExpect(t, mux, adminID, "PATCH", "/api/application/servers/"+serverID+"/startup", M{"environment": M{"CF_API_KEY": "local-override"}}, 200)
	secrets, err := a.serverIntegrationSecrets(ctx, num(server["id"]))
	if err != nil || len(secrets) != 1 || str(secrets[0]["source"]) != "server" {
		t.Fatal("explicit override did not replace the global binding with a private server secret")
	}
	assertResolved("local-override")

	// A scoped credential wins over the global one, and never reaches other eggs.
	infraExpect(t, mux, adminID, "POST", path, payload, 201)
	payload["egg_id"] = egg["id"]
	payload["name"] = "Scoped key"
	payload["credentials"] = M{"api_key": "scoped-key"}
	scoped := asMap(infraExpect(t, mux, adminID, "POST", path, payload, 201)["attributes"])
	env, _, err := a.integrationEnvironment(ctx, num(egg["id"]))
	if err != nil || env["CF_API_KEY"] != "scoped-key" {
		t.Fatal("scoped key did not override global")
	}
	infraExpect(t, mux, adminID, "PATCH", path+"/"+str(scoped["id"]), M{"enabled": false}, 200)
	env, _, err = a.integrationEnvironment(ctx, num(egg["id"]))
	if err != nil || env["CF_API_KEY"] != "test-private-api-key" {
		t.Fatal("disabled key still used")
	}
	otherEgg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "Unrelated egg", "author": "test@example.invalid"})
	env, _, err = a.integrationEnvironment(ctx, num(otherEgg["id"]))
	if err != nil || len(env) != 0 {
		t.Fatal("credentials injected into unrelated egg")
	}
	delete(payload, "egg_id")
	infraExpect(t, mux, adminID, "POST", path, payload, 201)
	if _, _, err = a.integrationEnvironment(ctx, num(egg["id"])); err == nil {
		t.Fatal("ambiguous integration silently selected")
	}
	infraExpect(t, mux, adminID, "PATCH", path+"/"+str(scoped["id"]), M{"credentials": M{"api_key": nil}, "bindings": M{}}, 200)
}
