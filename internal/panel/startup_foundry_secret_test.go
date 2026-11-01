package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func foundryStartupFixture(t *testing.T) (*operationsFixture, M) {
	t.Helper()
	f := operationsFixtureNew(t)
	for _, entry := range gameTemplates().Entries {
		if entry.Path != foundryVTTRecipe {
			continue
		}
		egg, variables, err := parseEggDocument(entry.Egg)
		if err != nil {
			t.Fatal(err)
		}
		egg["nest_id"] = f.server["nest_id"]
		if _, err = f.a.importEggRecord(context.Background(), num(f.server["egg_id"]), egg, variables); err != nil {
			t.Fatal(err)
		}
		f.server, err = f.a.update(context.Background(), "servers", num(f.server["id"]), M{"startup": egg["startup"]})
		if err != nil {
			t.Fatal(err)
		}
		rows, err := f.a.eggVariables(context.Background(), num(f.server["egg_id"]))
		if err != nil {
			t.Fatal(err)
		}
		for _, variable := range rows {
			if str(variable["env_variable"]) == "TIMED_URL" {
				return f, variable
			}
		}
	}
	t.Fatal("Missing canonical Foundry acquisition variable")
	return nil, nil
}

func TestFoundryStartupLegacyURLMaskingAndReplacement(t *testing.T) {
	f, variable := foundryStartupFixture(t)
	ctx := context.Background()
	old := "https://download.example.invalid/foundry.zip?signature=legacy-sentinel"
	next := "https://download.example.invalid/foundry.zip?signature=new-sentinel%2Braw&expires=123"
	if err := f.a.exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3)", f.server["id"], variable["id"], old); err != nil {
		t.Fatal(err)
	}
	assertFoundryPublicURLHidden(t, f, old)
	for _, user := range []M{f.owner, f.sub} {
		response := f.request("GET", f.serverPath("/startup"), nil, user)
		v := startupVariable(t, operationsExpect(t, response, 200), "TIMED_URL")
		if strings.Contains(response.Body.String(), old) || !boolean(v["secret_configured"]) {
			t.Fatal("Saved signed URL exposed through Startup")
		}
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TIMED_URL", "value": next}, f.sub), 403)
	response := f.request("PUT", f.serverPath("/startup/variable"), M{"key": "TIMED_URL", "value": next}, f.owner)
	operationsExpect(t, response, 200)
	if strings.Contains(response.Body.String(), next) {
		t.Fatal("Replacement URL exposed through Startup")
	}
	assertFoundryURLStored(t, f, variable, next)
	logs, err := f.a.query(ctx, "SELECT properties FROM activity_logs WHERE server_id=$1", f.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(logs)
	if strings.Contains(string(encoded), old) || strings.Contains(string(encoded), next) {
		t.Fatal("Signed acquisition URL retained in startup audit")
	}
}

func assertFoundryURLStored(t *testing.T, f *operationsFixture, variable M, want string) {
	t.Helper()
	ctx := context.Background()
	row, err := f.a.one(ctx, "SELECT sv.variable_value,s.value,s.source FROM server_variables sv JOIN server_integration_secrets s ON s.server_id=sv.server_id AND s.variable_id=sv.variable_id WHERE sv.server_id=$1 AND sv.variable_id=$2", f.server["id"], variable["id"])
	if err != nil {
		t.Fatal("Signed URL was not stored in the secret store", err)
	}
	plain, err := f.a.unseal(str(row["value"]))
	if err != nil || plain != want || str(row["variable_value"]) != integrationPlaceholder || str(row["source"]) != "server" || strings.Contains(str(row["value"]), want) {
		t.Fatal("Signed URL secret persistence mismatch")
	}
	config, err := f.a.serverConfig(ctx, f.server)
	if err != nil || str(asMap(config["environment"])["TIMED_URL"]) != want {
		t.Fatal("Installer environment lost the raw signed URL", err)
	}
	response := f.request("GET", f.serverPath("/startup"), nil, f.owner)
	v := startupVariable(t, operationsExpect(t, response, 200), "TIMED_URL")
	if strings.Contains(response.Body.String(), want) || !boolean(v["is_editable"]) || !boolean(v["secret_configured"]) {
		t.Fatal("Signed URL was exposed or made uneditable")
	}
	assertFoundryPublicURLHidden(t, f, want)
}

func assertFoundryPublicURLHidden(t *testing.T, f *operationsFixture, value string) {
	t.Helper()
	application, err := f.a.applicationServer(context.Background(), f.server)
	if err != nil {
		t.Fatal(err)
	}
	client, err := f.a.clientServer(context.Background(), f.owner, f.server)
	if err != nil {
		t.Fatal(err)
	}
	for _, response := range []M{application, client} {
		data, err := json.Marshal(response)
		if err != nil || strings.Contains(string(data), value) {
			t.Fatal("Public server response exposed signed URL", err)
		}
	}
}

func TestFoundryStartupProvisioningEncryptsURL(t *testing.T) {
	f, variable := foundryStartupFixture(t)
	ctx := context.Background()
	allocation, err := f.a.insert(ctx, "allocations", M{"node_id": f.node["id"], "ip": "127.0.0.1", "port": 25566})
	if err != nil {
		t.Fatal(err)
	}
	url := "https://download.example.invalid/foundry.zip?signature=provision-sentinel%2Braw"
	env := M{}
	variables, err := f.a.eggVariables(ctx, num(f.server["egg_id"]))
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	env["TIMED_URL"] = url
	f.server, err = f.a.createServer(ctx, M{"name": "Foundry secret fixture", "user": f.owner["id"], "egg": f.server["egg_id"], "docker_image": "alpine:3.23", "startup": f.server["startup"], "environment": env, "allocation": M{"default": allocation["id"]}, "limits": M{"memory": 4096, "disk": 4096, "io": 500, "cpu": 100, "swap": 0}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.a.update(ctx, "servers", num(f.server["id"]), M{"status": nil, "installed_at": now()}); err != nil {
		t.Fatal(err)
	}
	assertFoundryURLStored(t, f, variable, url)
}
