package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// Real isolated PostgreSQL and native Panel HTTP routes. The daemon is only
// operationsFixtureNew's explicit httptest fixture; no game is acquired/started.
func TestClusterioOriginalServerModeStartupParity(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	var catalog struct {
		Entries []struct {
			Path string `json:"path"`
			Egg  M      `json:"egg"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(gameTemplateCatalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	var original M
	for _, entry := range catalog.Entries {
		if entry.Path != "factorio/clusterio/egg-clusterio.json" {
			continue
		}
		for _, raw := range asSlice(entry.Egg["variables"]) {
			v := asMap(raw)
			if str(v["env_variable"]) == "SERVER_MODE" {
				original = v
				break
			}
		}
	}
	if original == nil || !boolean(original["user_editable"]) || !boolean(original["user_viewable"]) {
		t.Fatal("upstream SERVER_MODE must remain visible and editable")
	}
	if str(original["rules"]) != "required|string|in:controller,host" {
		t.Fatalf("original role choices changed: %v", original["rules"])
	}
	var reviewed map[string]struct {
		Egg M `json:"egg"`
	}
	if err := json.Unmarshal(gameTemplateOverridesJSON, &reviewed); err != nil {
		t.Fatal(err)
	}
	var canonical M
	for _, raw := range asSlice(reviewed["factorio/clusterio/egg-clusterio.json"].Egg["variables"]) {
		v := asMap(raw)
		if str(v["env_variable"]) == "SERVER_MODE" {
			canonical = v
			break
		}
	}
	if canonical == nil || boolean(canonical["user_editable"]) != boolean(original["user_editable"]) || boolean(canonical["user_viewable"]) != boolean(original["user_viewable"]) || str(canonical["rules"]) != str(original["rules"]) || str(canonical["default_value"]) != str(original["default_value"]) {
		t.Fatal("canonical Clusterio SERVER_MODE must preserve original editability, visibility, default and role choices")
	}
	variable, err := f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "env_variable": "SERVER_MODE", "name": original["name"], "description": original["description"], "default_value": original["default_value"], "rules": original["rules"], "field_type": original["field_type"], "user_viewable": true, "user_editable": false})
	if err != nil {
		t.Fatal(err)
	}
	// Reproduce the prior narrowed metadata through the real owner Startup API.
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_MODE", "value": "host"}, f.owner), 422)
	var count int
	if err = f.a.DB.QueryRow(ctx, "SELECT count(*) FROM server_variables WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"]).Scan(&count); err != nil || count != 0 {
		t.Fatal("read-only attempt changed stored role", err)
	}
	// Apply only the staged metadata flag, retaining original values and rules.
	if _, err = f.a.update(ctx, "egg_variables", num(variable["id"]), M{"user_editable": true}); err != nil {
		t.Fatal(err)
	}
	response := operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.owner), 200)
	found := false
	for _, raw := range asSlice(response["data"]) {
		v := asMap(asMap(raw)["attributes"])
		if str(v["env_variable"]) == "SERVER_MODE" {
			found = true
			if !boolean(v["is_editable"]) || str(v["rules"]) != str(original["rules"]) {
				t.Fatalf("startup metadata lost role editability/choices: %#v", v)
			}
		}
	}
	if !found {
		t.Fatal("original SERVER_MODE missing from Startup response")
	}
	for _, role := range []string{"host", "controller"} {
		operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_MODE", "value": role}, f.owner), 200)
		var actual string
		if err = f.a.DB.QueryRow(ctx, "SELECT variable_value FROM server_variables WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"]).Scan(&actual); err != nil || actual != role {
			t.Fatalf("role not persisted by native Startup API: %q %v", actual, err)
		}
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_MODE", "value": "worker"}, f.owner), 422)
	var actual string
	if err = f.a.DB.QueryRow(ctx, "SELECT variable_value FROM server_variables WHERE server_id=$1 AND variable_id=$2", f.server["id"], variable["id"]).Scan(&actual); err != nil || actual != "controller" {
		t.Fatal("invalid role changed persisted original setting", err)
	}
}

// The proposed rule is tested against the initial environment validator and
// ordinary owner Startup requests. This must pass before a rule-only merge.
func TestClusterioConditionalNameContextParity(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	candidateRule := "nullable|required_if:environment.SERVER_MODE,controller|string|max:100"
	if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"startup": "exec node .voltra/clusterio-start.mjs"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.a.update(ctx, "servers", num(f.server["id"]), M{"startup": "exec node .voltra/clusterio-start.mjs"}); err != nil {
		t.Fatal(err)
	}
	for _, variable := range []M{
		{"env_variable": "SERVER_MODE", "name": "Server mode", "default_value": "controller", "rules": "required|string|in:controller,host", "user_viewable": true, "user_editable": true},
		{"env_variable": "CLUSTER_NAME", "name": "Cluster name", "default_value": "Your Cluster", "rules": candidateRule, "user_viewable": true, "user_editable": true},
	} {
		variable["egg_id"] = f.server["egg_id"]
		if _, err := f.a.insert(ctx, "egg_variables", variable); err != nil {
			t.Fatal(err)
		}
	}
	// This is the real database-backed initial creation validator reused by templates.
	for _, mode := range []string{"host", "controller"} {
		_, err := f.a.validateEggEnvironment(ctx, num(f.server["egg_id"]), M{"SERVER_MODE": mode, "CLUSTER_NAME": "", "VISIBLE": "visible"}, false)
		if mode == "host" && err != nil {
			t.Fatalf("initial host blank name rejected: %v", err)
		}
		if mode == "controller" && err == nil {
			t.Fatal("initial controller blank name must be rejected")
		}
	}
	modeVariable, err := f.a.one(ctx, "SELECT id FROM egg_variables WHERE egg_id=$1 AND env_variable='SERVER_MODE'", f.server["egg_id"])
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"host", "controller"} {
		if err := f.a.exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3) ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=EXCLUDED.variable_value", f.server["id"], modeVariable["id"], mode); err != nil {
			t.Fatal(err)
		}
		response := f.request("PUT", f.serverPath("/startup/variable"), M{"key": "CLUSTER_NAME", "value": ""}, f.owner)
		expected := 200
		if mode == "controller" {
			expected = 422
		}
		if response.Code != expected {
			t.Fatalf("ordinary owner Startup mode=%s blank-name status=%d want=%d; candidate rule lacks stored role context: %s", mode, response.Code, expected, response.Body.String())
		}
	}
	// A blank host name cannot be stranded by switching/resetting into controller.
	if err := f.a.exec(ctx, "UPDATE server_variables SET variable_value='host' WHERE server_id=$1 AND variable_id=$2", f.server["id"], modeVariable["id"]); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "CLUSTER_NAME", "value": ""}, f.owner), 200)
	for _, body := range []M{{"key": "SERVER_MODE", "value": "controller"}, {"key": "SERVER_MODE", "reset": true}} {
		operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), body, f.owner), 422)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "CLUSTER_NAME", "reset": true}, f.owner), 200)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_MODE", "value": "controller"}, f.owner), 200)
	valid := strings.Repeat("\U0001F600", 100)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "CLUSTER_NAME", "value": valid}, f.owner), 200)
	for _, name := range []string{"", "   ", valid + "\U0001F600"} {
		operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "CLUSTER_NAME", "value": name}, f.owner), 422)
	}
	row, err := f.a.one(ctx, "SELECT COALESCE(sv.variable_value,ev.default_value) AS value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 AND ev.env_variable='CLUSTER_NAME'", f.server["id"], f.server["egg_id"])
	if err != nil || str(row["value"]) != valid {
		t.Fatal("invalid controller edits changed persisted name", err)
	}
	// Same key on an unrelated effective egg keeps generic Laravel context.
	if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"startup": "unrelated reviewed launcher"}); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "CLUSTER_NAME", "value": ""}, f.owner), 200)
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "VISIBLE", "value": "changed"}, f.owner), 200)

}
