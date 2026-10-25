package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
)

func TestTemplateSetupUnavailableMetadataAndLegacyIdentity(t *testing.T) {
	const reason = "2026-10-24: Current anonymous public acquisition contains no runnable server; publisher acquisition needs review."
	var override gameTemplateOverride
	if err := json.Unmarshal([]byte(`{"setup_unavailable_reason":"`+reason+`"}`), &override); err != nil || override.SetupUnavailableReason != reason {
		t.Fatal("optional metadata not decoded", err)
	}
	if got := gameTemplateSetupUnavailable(gameTemplate{Path: "palworld/egg-palworld-proton.json", SetupUnavailableReason: reason}); got != reason {
		t.Fatal("explicit reviewed reason did not precede bridge fallback", got)
	}
	if gameTemplateSetupUnavailable(gameTemplate{Path: "openttd/egg-open-t-t-d-server.json"}) != "" {
		t.Fatal("unrelated template blocked")
	}
	profile := gameTemplateOverride{UpstreamSHA256: "upstream", Revision: "review-1", Defaults: M{"memory": 1024}, Egg: M{"startup": "original"}}
	legacy := []byte(`{"upstream_sha256":"upstream","revision":"review-1","defaults":{"memory":1024},"egg":{"startup":"original"}}`)
	sum := sha256.Sum256(legacy)
	before := gameTemplateOverrideDigest(profile)
	if before != hex.EncodeToString(sum[:]) {
		t.Fatal("empty optional metadata changed legacy digest")
	}
	body, _ := json.Marshal(profile)
	var metadata M
	json.Unmarshal(body, &metadata)
	if _, ok := metadata["setup_unavailable_reason"]; ok {
		t.Fatal("empty metadata no longer omitted")
	}
	profile.SetupUnavailableReason = reason
	if gameTemplateOverrideDigest(profile) == before {
		t.Fatal("changed setup policy kept old reviewed profile identity")
	}
	// Check actual canonical metadata load whenever integration provides a reason.
	var overrides map[string]gameTemplateOverride
	if err := json.Unmarshal(gameTemplateOverridesJSON, &overrides); err != nil {
		t.Fatal(err)
	}
	for _, entry := range gameTemplates().Entries {
		if want, ok := overrides[entry.Path]; ok && entry.SetupUnavailableReason != want.SetupUnavailableReason {
			t.Fatal("reviewed setup reason lost during catalog load", entry.Path)
		}
	}
}

func TestTemplateSetupUnavailableInstallZeroMutations(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	var entry gameTemplate
	for _, e := range gameTemplates().Entries {
		if e.Path == "openttd/egg-open-t-t-d-server.json" {
			entry = e
		}
	}
	if entry.ID == "" {
		t.Fatal("fixture recipe missing")
	}
	entry.ID = "setup-unavailable-fixture"
	entry.Path = "fixture/acquisition-review.json"
	entry.SetupUnavailableReason = "2026-10-24: Current public acquisition has no executable. Review needed before setup."
	length := len(templates.Entries)
	templates.Entries = append(templates.Entries, entry)
	t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	endpoint := "/api/client/game-library/templates/" + entry.ID
	counts := func() string {
		row, err := a.one(ctx, "SELECT (SELECT count(*) FROM servers) servers,(SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM nests) nests,(SELECT count(*) FROM egg_variables) variables")
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(row)
		return string(b)
	}
	before := counts()
	summary := templateSummary(entry)
	if boolean(summary["available"]) || str(summary["detail"]) != entry.SetupUnavailableReason {
		t.Fatal("summary did not expose repairable reason", summary)
	}
	options := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	if boolean(options["available"]) || str(options["detail"]) != entry.SetupUnavailableReason || len(asSlice(options["variables"])) == 0 {
		t.Fatal("options hid recipe or failed gate", options)
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	image := ""
	for _, v := range asMap(entry.Egg["docker_images"]) {
		image = str(v)
		break
	}
	var allocation int64
	if err = a.DB.QueryRow(ctx, "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id LIMIT 1", node["id"]).Scan(&allocation); err != nil {
		t.Fatal(err)
	}
	for _, input := range []M{nil, {"name": "Blocked fixture", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "environment": env, "allocation_id": allocation}, {"name": "Blocked fixture", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "environment": env, "automatic_ports": true, "node_id": node["id"]}} {
		response := infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 409)
		b, _ := json.Marshal(response)
		var decoded M
		json.Unmarshal(b, &decoded)
		errors := asSlice(decoded["errors"])
		if len(errors) == 0 || str(asMap(errors[0])["code"]) != "GameSetupUnavailable" {
			t.Fatal("wrong failure contract", response)
		}
		if counts() != before || wings.Creates != 0 {
			t.Fatal("blocked setup mutated state")
		}
	}
	// Clearing the reviewed reason restores the existing path; it is not an
	// unsupported-game declaration or deletion of the recipe/objective.
	entry.SetupUnavailableReason = ""
	if !boolean(templateSummary(entry)["available"]) {
		t.Fatal("cleared temporary gate still blocks recipe")
	}
}
