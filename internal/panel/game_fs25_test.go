package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func TestFS25ReadyOnlyOnServerStarted(t *testing.T) {
	egg, _, err := parseEggDocument(farmingSimulatorTemplate().Egg)
	if err != nil {
		t.Fatal(err)
	}
	startup := asMap(egg["config_startup"])
	if str(startup["done"]) != fs25ReadyPattern || !boolean(startup["strip_ansi"]) {
		t.Fatal("FS25 readiness must strip label colors and wait for the server started marker")
	}
	pattern := regexp.MustCompile(strings.TrimPrefix(fs25ReadyPattern, "regex:"))
	if !pattern.MatchString("[Server] [26/Oct/2026:05:24:16] Game server started") {
		t.Fatal("server started marker not recognised")
	}
	for _, line := range []string{"Web manager ready.", "[Server] [26/Oct/2026:05:24:16] Game server process started", "[WebPanel] [26/Oct/2026:05:24:16] Game server started", "[Server] [26/Oct/2026:05:24:16] Player: Game server started", "[Server] [26/Oct/2026:05:24:16] Game server started failed", "[Game] 2026-10-26 05:26:44.624   Info: Entered Gameplay"} {
		if pattern.MatchString(line) {
			t.Fatalf("premature ready: %s", line)
		}
	}
}

func TestFS25ReviewedTemplate(t *testing.T) {
	entry := farmingSimulatorTemplate()
	egg, vars, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	if len(vars) != 20 || entry.RequiredPorts != 2 || entry.Verification == "runtime_verified" {
		t.Fatal("invalid FS25 metadata")
	}
	for _, variable := range vars {
		if name := str(variable["env_variable"]); name == "GAME_SERIAL" || name == "DLC_PRODUCT_KEY" {
			if boolean(variable["user_viewable"]) || boolean(variable["user_editable"]) {
				t.Fatal("Licence fields must be admin managed")
			}
			continue
		}
		if !boolean(variable["user_viewable"]) {
			t.Fatal("setting unavailable after installation", variable["env_variable"])
		}
	}
	for _, image := range asMap(egg["docker_images"]) {
		if !strings.Contains(str(image), "@sha256:") {
			t.Fatal("mutable image")
		}
	}
	environment, err := templateEnvironment(vars, M{})
	if err != nil {
		t.Fatal(err)
	}
	environment, err = normalizeTemplatePortEnvironment(entry, environment, M{"port": int64(10823)}, []M{{"port": int64(7999)}})
	if err != nil || environment["WEB_PORT"] != "7999" {
		t.Fatalf("web port: %v %v", environment["WEB_PORT"], err)
	}
	if err = validateTemplatePortRules(entry, environment, M{"port": int64(10823)}, []M{{"port": int64(7999)}}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"GAME_SERIAL", "DLC_PRODUCT_KEY", "WEB_PASSWORD"} {
		if !startupSecretName(name) {
			t.Fatal("unmasked secret", name)
		}
	}
}

func TestFS25SavedLicenseAndSecretOverrides(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	entry := farmingSimulatorTemplate()
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	a.registerIntegrations(mux)
	endpoint := "/api/client/game-library/templates/" + entry.ID
	options := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	eggID := num(options["egg_id"])
	if eggID == 0 || boolean(options["saved_license"]) {
		t.Fatal("licence metadata incorrect")
	}
	for _, variable := range asSlice(options["variables"]) {
		if name := str(asMap(variable)["env_variable"]); name == "GAME_SERIAL" || name == "DLC_PRODUCT_KEY" {
			t.Fatal("Licence field exposed in user setup")
		}
	}
	for _, name := range []string{"DLC One", "DLC Two"} {
		infraExpect(t, mux, admin, "POST", "/api/admin/integrations", M{"name": name, "provider": "game_license", "egg_id": eggID, "credentials": M{"license_key": "TEST-PRIVATE-" + name}, "bindings": M{"license_key": []any{"DLC_PRODUCT_KEY"}}}, 201)
	}
	sealed, err := a.seal(`{"license_key":"FS25-FAKE-TEST-KEY"}`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.insert(ctx, "integrations", M{"name": "FS25 fixture", "provider": "game_license", "egg_id": eggID, "enabled": true, "bindings": M{"license_key": []any{"GAME_SERIAL"}}, "credentials": sealed})
	if err != nil {
		t.Fatal(err)
	}
	options = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if !boolean(options["saved_license"]) {
		t.Fatal("saved licence missing")
	}
	_, vars, _ := parseEggDocument(entry.Egg)
	env, _ := templateEnvironment(vars, M{"WEB_PASSWORD": "fixture-password-only"})
	image := ""
	for _, raw := range asMap(entry.Egg["docker_images"]) {
		image = str(raw)
	}
	input := M{"name": "FS25 fixture", "request_id": newUUID(), "memory": 6144, "disk": 102400, "image": image, "node_id": node["id"], "automatic_ports": true, "environment": env}
	result := asMap(infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)["attributes"])
	if str(result["identifier"]) == "" || wings.Creates != 1 {
		t.Fatal("missing provisioned server")
	}
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	secrets, err := a.serverIntegrationSecrets(ctx, num(server["id"]))
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]string{}
	for _, secret := range secrets {
		plain, e := a.unseal(str(secret["value"]))
		if e != nil {
			t.Fatal(e)
		}
		found[str(secret["env_variable"])] = plain
	}
	if found["GAME_SERIAL"] != "FS25-FAKE-TEST-KEY" || found["WEB_PASSWORD"] != "fixture-password-only" {
		t.Fatal("encrypted snapshot not preserved")
	}
	var dlcs []fs25DLCLicence
	if json.Unmarshal([]byte(found["DLC_PRODUCT_KEY"]), &dlcs) != nil || len(dlcs) != 2 {
		t.Fatal("Multiple DLC licences were not snapshotted")
	}
	path := "/api/admin/servers/" + str(server["id"]) + "/fs25/licences"
	status := infraExpect(t, mux, admin, "GET", path, nil, 200)
	raw, _ := json.Marshal(status)
	if strings.Contains(string(raw), "TEST-PRIVATE") {
		t.Fatal("DLC key returned by admin read API")
	}
	infraExpect(t, mux, admin, "PUT", path, M{}, 200)
	download, e := a.one(ctx, `SELECT sv.variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable='DOWNLOAD_DLC'`, server["id"])
	if e != nil || str(download["variable_value"]) != "true" {
		t.Fatal("Applying DLC licences did not enable downloads")
	}
	if e = a.exec(ctx, `UPDATE integrations SET enabled=false WHERE egg_id=$1 AND bindings->'license_key' @> '["DLC_PRODUCT_KEY"]'::jsonb`, eggID); e != nil {
		t.Fatal(e)
	}
	if e = a.exec(ctx, `UPDATE server_variables SET variable_value='false' WHERE server_id=$1 AND variable_id IN (SELECT id FROM egg_variables WHERE egg_id=$2 AND env_variable='DOWNLOAD_DLC')`, server["id"], eggID); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, admin, "PUT", path, M{}, 200)
	download, e = a.one(ctx, `SELECT sv.variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable='DOWNLOAD_DLC'`, server["id"])
	if e != nil || str(download["variable_value"]) != "false" {
		t.Fatal("Applying no DLC licences changed the download preference")
	}
	user, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "fs25-ordinary", "email": "fs25-ordinary@example.test", "root_admin": false, "name_first": "Test", "name_last": "User"})
	if e != nil {
		t.Fatal(e)
	}
	infraExpect(t, mux, num(user["id"]), "GET", path, nil, 403)
	infraExpect(t, mux, num(user["id"]), "PUT", path, M{}, 403)
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.fs25ReserveLicences(ctx, tx, 0, M{"GAME_SERIAL": found["GAME_SERIAL"]}); e == nil || strings.Contains(e.Error(), "FAKE-TEST") {
		t.Fatal("An assigned licence was reusable or exposed")
	}
	_ = tx.Rollback(ctx)
	options = asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if boolean(options["saved_license"]) {
		t.Fatal("An already assigned licence was advertised as available")
	}
	// Licence scope follows genuine FS25 revisions, never lookalike variable names.
	for _, farming := range []bool{true, false} {
		revision := entry
		revision.SHA256 = strings.Repeat("b", 64)
		if !farming {
			revision.SHA256 = strings.Repeat("c", 64)
		}
		body, _ := json.Marshal(entry.Egg)
		document := M{}
		_ = json.Unmarshal(body, &document)
		if !farming {
			document["features"] = []any{}
		}
		e, v, e2 := parseEggDocument(document)
		if e2 != nil {
			t.Fatal(e2)
		}
		imported, e2 := a.ensureGameTemplateEgg(ctx, revision, e, v)
		if e2 != nil {
			t.Fatal(e2)
		}
		resolved, _, e2 := a.integrationEnvironment(ctx, num(imported["id"]))
		if e2 != nil {
			t.Fatal(e2)
		}
		if farming && str(resolved["GAME_SERIAL"]) != "FS25-FAKE-TEST-KEY" {
			t.Fatal("FS25 revision lost admin licence")
		}
		if !farming && (resolved["GAME_SERIAL"] != nil || resolved["DLC_PRODUCT_KEY"] != nil) {
			t.Fatal("Licence leaked to a non-FS25 template")
		}
	}
	rows, err := a.query(ctx, "SELECT sv.variable_value FROM server_variables sv WHERE server_id=$1", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if strings.Contains(str(row["variable_value"]), "FAKE-TEST") || strings.Contains(str(row["variable_value"]), "fixture-password") {
			t.Fatal("plaintext credential")
		}
	}
}

func TestFS25PasswordsEditable(t *testing.T) {
	_, variables, err := parseEggDocument(farmingSimulatorTemplate().Egg)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, v := range variables {
		switch str(v["env_variable"]) {
		case "WEB_PASSWORD", "ADMIN_PASSWORD", "GAME_PASSWORD":
			found++
			if !boolean(v["user_viewable"]) || !boolean(v["user_editable"]) {
				t.Fatal("password must be visible and editable")
			}
		}
	}
	if found != 3 {
		t.Fatal("missing FS25 password variables")
	}
}
