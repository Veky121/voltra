package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGameTemplateProvisioningAndRetries(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "openttd/egg-open-t-t-d-server.json" {
			entry = candidate
		}
	}
	if entry.ID == "" {
		t.Fatal("OpenTTD missing")
	}
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/templates/"+entry.ID, nil, 200)["attributes"])
	if len(asSlice(options["nodes"])) != 1 {
		t.Fatal("fixture node missing")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	var allocationID int64
	if err = a.DB.QueryRow(context.Background(), "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id LIMIT 1", node["id"]).Scan(&allocationID); err != nil {
		t.Fatal(err)
	}
	image := ""
	for _, value := range asMap(entry.Egg["docker_images"]) {
		image = str(value)
		break
	}
	input := M{"name": "OpenTTD fixture", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "allocation_id": allocationID, "allocation_additional": []any{}, "environment": env}
	endpoint := "/api/client/game-library/templates/" + entry.ID + "/install"
	invalid := M{}
	for key, value := range input {
		invalid[key] = value
	}
	invalid["image"] = "unlisted/image:latest"
	infraExpect(t, mux, admin, "POST", endpoint, invalid, 422)
	if wings.Creates != 0 {
		t.Fatal("invalid input reached Wings")
	}
	created := asMap(infraExpect(t, mux, admin, "POST", endpoint, input, 201)["attributes"])
	retry := asMap(infraExpect(t, mux, admin, "POST", endpoint, input, 200)["attributes"])
	if str(created["identifier"]) == "" || created["identifier"] != retry["identifier"] || wings.Creates != 1 {
		t.Fatal("retry created another server")
	}
	input["name"] = "Different request body"
	infraExpect(t, mux, admin, "POST", endpoint, input, 409)
	if wings.Creates != 1 {
		t.Fatal("conflicting retry reached Wings")
	}
	user, err := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "catalog-member", "email": "catalog-member@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, num(user["id"]), "GET", "/api/client/game-library/templates/"+entry.ID, nil, 403)
	infraExpect(t, mux, num(user["id"]), "POST", endpoint, input, 403)
}

func TestGameTemplateCatalogCompatibility(t *testing.T) {
	catalog := gameTemplates()
	if len(catalog.Entries) < 240 || len(catalog.Revision) != 40 {
		t.Fatal("incomplete pinned catalog")
	}
	if catalog.Revision == "c637a6d1e0449b167efeff81bb9a0177aa3df6c2" && len(catalog.Entries) != 241 {
		t.Fatal("pinned catalog is missing recipes")
	}
	ids := map[string]bool{}
	report := []M{}
	for _, entry := range catalog.Entries {
		t.Run(entry.Path, func(t *testing.T) {
			if ids[entry.ID] {
				t.Fatal("duplicate recipe identity")
			}
			ids[entry.ID] = true
			found, ok := gameTemplateFor(entry.ID)
			if !ok || found.Path != entry.Path {
				t.Fatal("recipe lookup changed identity")
			}
			egg, variables, err := parseEggDocument(entry.Egg)
			status := "schema_validated"
			detail := ""
			if err != nil {
				status = "compatibility_fix_required"
				detail = err.Error()
			}
			report = append(report, M{"id": entry.ID, "path": entry.Path, "name": entry.Egg["name"], "status": status, "detail": detail, "runtime_verified": entry.Verification == "runtime_verified", "runtime_status": entry.Verification, "runtime_detail": entry.Detail, "profile": entry.Profile})
			if err != nil {
				t.Errorf("recipe import: %v", err)
				return
			}
			if len(asMap(egg["docker_images"])) == 0 || str(egg["startup"]) == "" {
				t.Fatal("recipe cannot launch")
			}
			input := M{}
			for _, v := range variables {
				input[str(v["env_variable"])] = v["default_value"]
			}
			if _, err = templateEnvironment(variables, input); err != nil {
				t.Fatal(err)
			}
		})
	}
	if target := os.Getenv("GAME_CATALOG_REPORT"); target != "" {
		b, _ := json.MarshalIndent(M{"revision": catalog.Revision, "games": report}, "", "  ")
		if err := os.WriteFile(filepath.Clean(target), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestGameTemplateEnvironmentRejectsUnexpectedInputs(t *testing.T) {
	variables := []M{{"env_variable": "WORLD", "name": "World", "default_value": "Default"}}
	for _, input := range []any{nil, []any{}, M{"SHELL": "whoami"}, M{"WORLD": false}, M{"WORLD": "bad\x00value"}} {
		if _, err := templateEnvironment(variables, input); err == nil {
			t.Fatalf("accepted %#v", input)
		}
	}
	result, err := templateEnvironment(variables, M{})
	if err != nil || result["WORLD"] != "Default" {
		t.Fatal("defaults not preserved")
	}
}

func TestGameTemplateReviewMetadataPreservesEggIdentity(t *testing.T) {
	profile := gameTemplateOverride{UpstreamSHA256: "upstream", Revision: "review-1", Egg: M{"startup": "original"}, Defaults: M{"memory": 1024}}
	before := gameTemplateOverrideDigest(profile)
	profile.Verification = "runtime_verified"
	profile.Detail = "Checked on a temporary Linux node."
	profile.SetupSteps = []string{"Start the server after installation."}
	if after := gameTemplateOverrideDigest(profile); after != before {
		t.Fatal("review notes or instructions changed installed egg identity")
	}
	profile.Egg = M{"startup": "changed"}
	if gameTemplateOverrideDigest(profile) == before {
		t.Fatal("changed executable recipe kept its old identity")
	}
}

func TestGameTemplateImportIdentityPreservesExistingEgg(t *testing.T) {
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	entry := gameTemplates().Entries[0]
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	first, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.DB.Exec(ctx, "UPDATE eggs SET name='Operator edit' WHERE id=$1", first["id"]); err != nil {
		t.Fatal(err)
	}
	egg, variables, err = parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	if first["id"] != second["id"] || str(second["name"]) != "Operator edit" {
		t.Fatal("catalog revisiting replaced an existing egg")
	}
	entry.SHA256 = strings.Repeat("f", 64)
	egg, variables, _ = parseEggDocument(entry.Egg)
	third, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		t.Fatal(err)
	}
	if third["id"] == first["id"] {
		t.Fatal("changed upstream contents reused installed egg")
	}
}

func TestGameTemplateEveryRecipeImports(t *testing.T) {
	a, _, _ := infraTestApp(t)
	for _, entry := range gameTemplates().Entries {
		t.Run(entry.Path, func(t *testing.T) {
			egg, variables, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			imported, err := a.ensureGameTemplateEgg(context.Background(), entry, egg, variables)
			if err != nil {
				t.Fatal(err)
			}
			exported, err := a.eggExport(context.Background(), num(imported["id"]))
			if err != nil {
				t.Fatal(err)
			}
			if str(exported["startup"]) != str(entry.Egg["startup"]) || str(exported["name"]) != str(entry.Egg["name"]) {
				t.Fatal("recipe changed during import")
			}
			if len(exported["variables"].([]M)) != len(variables) {
				t.Fatal("game settings lost during import")
			}
		})
	}
}

func TestValheimProvisioningRequiresConsecutivePortsAndPreservesSettings(t *testing.T) {
	a, mux, admin, node, wings := steamGamesFixture(t)
	input := steamGamesInput("valheim", node)
	result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/valheim/install", input, 201)["attributes"])
	server, err := a.one(context.Background(), "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	allocations, err := a.query(context.Background(), "SELECT port FROM allocations WHERE server_id=$1 ORDER BY port", server["id"])
	if err != nil {
		t.Fatal(err)
	}
	if len(allocations) != 2 || num(allocations[1]["port"]) != num(allocations[0]["port"])+1 {
		t.Fatal("Valheim did not receive consecutive ports")
	}
	if err = a.steamGameAfterInstall(context.Background(), server); err != nil {
		t.Fatal(err)
	}
	values, err := valheimValues(wings.Files[valheimSettingsPath])
	if err != nil {
		t.Fatal(err)
	}
	if values["password"] != "test-pass" || values["public"] != "false" || values["world"] != "Dedicated" {
		t.Fatal("initial settings missing")
	}
	original := []byte("name=Operator world\npassword=retained-pass\nworld=Another\npublic=false\n")
	wings.Files[valheimSettingsPath] = original
	if err = a.steamGameAfterInstall(context.Background(), server); err != nil {
		t.Fatal(err)
	}
	if string(wings.Files[valheimSettingsPath]) != string(original) {
		t.Fatal("existing game settings overwritten")
	}
	spec, _ := steamGameSpecFor("valheim")
	if _, err = a.DB.Exec(context.Background(), "DELETE FROM allocations WHERE node_id=$1 AND server_id IS NULL AND port IN(8212,9001)", node["id"]); err != nil {
		t.Fatal(err)
	}
	if _, err = a.steamGameAllocations(context.Background(), node, spec, spec.Memory); err == nil {
		t.Fatal("non-consecutive ports accepted")
	}
}

func TestValheimQuickSettingsTreatShellTextAsData(t *testing.T) {
	values := M{"name": "Factory $(touch /tmp/injected)", "password": "a'\"$()=secret", "world": "Dedicated", "public": false}
	patch, err := quickValidateSettings("valheim", values)
	if err != nil {
		t.Fatal(err)
	}
	content, err := valheimPatch([]byte("custom=retained\n"), patch)
	if err != nil {
		t.Fatal(err)
	}
	read, err := valheimValues(content)
	if err != nil {
		t.Fatal(err)
	}
	if read["name"] != values["name"] || read["password"] != values["password"] || read["custom"] != "retained" {
		t.Fatal("settings changed during round trip")
	}
	for _, input := range []M{{"password": "tiny"}, {"password": strings.Repeat("a", 21)}, {"world": "../world"}, {"world": ""}, {"name": "bad\nline"}, {"name": ""}} {
		if _, err = quickValidateSettings("valheim", input); err == nil {
			t.Fatalf("accepted %v", input)
		}
	}
	for _, bad := range []string{"name=One\nname=Two\n", "not-a-setting\n", "name=bad\r\n"} {
		if _, err = valheimValues([]byte(bad)); err == nil {
			t.Fatal("accepted malformed config")
		}
	}
	if strings.Contains(valheimLauncher, "eval ") || strings.Contains(valheimLauncher, "source ") {
		t.Fatal("launcher evaluates game configuration")
	}
}
