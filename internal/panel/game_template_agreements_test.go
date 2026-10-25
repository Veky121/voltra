package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func publisherAgreementFixture() gameTemplate {
	text := "Publisher terms\r\nExact reviewed bytes.\r\n"
	sum := sha256.Sum256([]byte(text))
	accept := hex.EncodeToString(sum[:])
	return gameTemplate{Agreements: []templateAgreement{{Environment: "ACCEPT_TERMS", Title: "Publisher EULA", Text: text, EffectiveDate: "2026-03-03", AcceptValue: accept}}, Egg: M{"variables": []any{M{"name": "Agreement", "env_variable": "ACCEPT_TERMS", "default_value": "0", "rules": "required|string|in:0," + accept, "user_viewable": true, "user_editable": true}}}}
}

func TestPublisherAgreementIntegrityAndExplicitAcceptance(t *testing.T) {
	entry := publisherAgreementFixture()
	if err := validateTemplateAgreements(entry); err != nil {
		t.Fatal(err)
	}
	for _, input := range []any{nil, M{}, M{"ACCEPT_TERMS": "0"}, M{"ACCEPT_TERMS": true}, M{"ACCEPT_TERMS": "true"}, M{"ACCEPT_TERMS": nil}, M{"ACCEPT_TERMS": strings.Repeat("a", 64)}} {
		if err := requireTemplateAgreements(entry, input); err == nil {
			t.Fatalf("inferred consent from %#v", input)
		}
	}
	if err := requireTemplateAgreements(entry, M{"ACCEPT_TERMS": entry.Agreements[0].AcceptValue}); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*gameTemplate){
		func(e *gameTemplate) { e.Agreements[0].Text = strings.ReplaceAll(e.Agreements[0].Text, "\r\n", "\n") },
		func(e *gameTemplate) { e.Agreements[0].AcceptValue = strings.ToUpper(e.Agreements[0].AcceptValue) },
		func(e *gameTemplate) { e.Agreements[0].EffectiveDate = "2026-02-30" },
		func(e *gameTemplate) { e.Agreements[0].Environment = "missing" },
		func(e *gameTemplate) { e.Agreements = append(e.Agreements, e.Agreements[0]) },
		func(e *gameTemplate) {
			asMap(asSlice(e.Egg["variables"])[0])["default_value"] = e.Agreements[0].AcceptValue
		},
		func(e *gameTemplate) { asMap(asSlice(e.Egg["variables"])[0])["rules"] = "required|string" },
		func(e *gameTemplate) {
			e.Egg["variables"] = append(asSlice(e.Egg["variables"]), asSlice(e.Egg["variables"])[0])
		},
	} {
		e := publisherAgreementFixture()
		change(&e)
		if validateTemplateAgreements(e) == nil {
			t.Fatal("invalid reviewed metadata accepted")
		}
	}
	profile := gameTemplateOverride{UpstreamSHA256: "upstream", Revision: "review-1", Defaults: M{"memory": 1024}, Egg: M{"startup": "original"}}
	legacy := []byte(`{"upstream_sha256":"upstream","revision":"review-1","defaults":{"memory":1024},"egg":{"startup":"original"}}`)
	sum := sha256.Sum256(legacy)
	if gameTemplateOverrideDigest(profile) != hex.EncodeToString(sum[:]) {
		t.Fatal("no-agreement legacy identity changed")
	}
	profile.Agreements = entry.Agreements
	if gameTemplateOverrideDigest(profile) == hex.EncodeToString(sum[:]) {
		t.Fatal("agreement changes did not change reviewed identity")
	}
	if requireTemplateAgreements(gameTemplate{}, nil) != nil {
		t.Fatal("unrelated template gained consent gate")
	}
}

func TestPublisherAgreementInstallBeforeMutation(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	var entry gameTemplate
	for _, e := range gameTemplates().Entries {
		if e.Path == "openttd/egg-open-t-t-d-server.json" {
			entry = e
		}
	}
	if entry.ID == "" {
		t.Fatal("OpenTTD fixture missing")
	}
	encoded, _ := json.Marshal(entry.Egg)
	if err := json.Unmarshal(encoded, &entry.Egg); err != nil {
		t.Fatal(err)
	}
	agreed := publisherAgreementFixture()
	entry.ID = "publisher-agreement-fixture"
	entry.Path = "fixture/agreement.json"
	entry.Agreements = agreed.Agreements
	entry.Egg["variables"] = append(asSlice(entry.Egg["variables"]), asSlice(agreed.Egg["variables"])[0])
	entry.Profile = "agreement-fixture"
	length := len(templates.Entries)
	templates.Entries = append(templates.Entries, entry)
	t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	endpoint := "/api/client/game-library/templates/" + entry.ID
	counts := func() string {
		row, err := a.one(ctx, "SELECT (SELECT count(*) FROM nests) nests,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM servers) servers")
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(row)
		return string(b)
	}
	before := counts()
	options := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	b, _ := json.Marshal(options["agreements"])
	var exposed []templateAgreement
	if err := json.Unmarshal(b, &exposed); err != nil || len(exposed) != 1 || exposed[0].Text != entry.Agreements[0].Text {
		t.Fatal("options lost exact reviewed terms", err)
	}
	if _, exists := templateSummary(entry)["agreements"]; exists {
		t.Fatal("catalog summary exposes full terms")
	}
	env := M{}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	infraExpect(t, mux, admin, "POST", endpoint+"/ports", M{"node_id": node["id"], "environment": env}, 200)
	image := ""
	for _, v := range asMap(entry.Egg["docker_images"]) {
		image = str(v)
		break
	}
	var allocation int64
	if err = a.DB.QueryRow(ctx, "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id LIMIT 1", node["id"]).Scan(&allocation); err != nil {
		t.Fatal(err)
	}
	input := M{"name": "Agreement fixture", "request_id": newUUID(), "image": image, "memory": 2048, "disk": 10240, "allocation_id": allocation, "environment": env}
	for _, value := range []any{nil, "0", true, "true", strings.Repeat("b", 64)} {
		if value == nil {
			delete(env, "ACCEPT_TERMS")
		} else {
			env["ACCEPT_TERMS"] = value
		}
		infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 422)
		input["automatic_ports"] = true
		input["node_id"] = node["id"]
		delete(input, "allocation_id")
		infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 422)
		delete(input, "automatic_ports")
		delete(input, "node_id")
		input["allocation_id"] = allocation
		if counts() != before || wings.Creates != 0 {
			t.Fatal("unaccepted agreement mutated state")
		}
	}

	// Malformed reviewed metadata blocks options/install before provisioning too.
	originalText := templates.Entries[length].Agreements[0].Text
	templates.Entries[length].Agreements[0].Text += "revised"
	env["ACCEPT_TERMS"] = entry.Agreements[0].AcceptValue
	infraExpect(t, mux, admin, "GET", endpoint, nil, 409)
	infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 409)
	if counts() != before || wings.Creates != 0 {
		t.Fatal("invalid agreement metadata mutated state")
	}
	templates.Entries[length].Agreements[0].Text = originalText
	env["ACCEPT_TERMS"] = entry.Agreements[0].AcceptValue
	infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)
	infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 200)
	if wings.Creates != 1 {
		t.Fatal("accepted request/retry did not preserve idempotency")
	}
	env["ACCEPT_TERMS"] = "0"
	infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 422)
}
