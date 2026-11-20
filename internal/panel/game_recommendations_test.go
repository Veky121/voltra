package panel

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestTemplateRecommendationOptions(t *testing.T) {
	players := 12
	rec := gameRecommendation{
		Memory: 8192, Disk: 20480, Players: &players, Confidence: "community",
		Source: "https://example.invalid/server", Note: "Test fixture",
		Agreements: []gameRecommendationAgreement{{"TEST_TERMS", "Test terms", "https://example.invalid/terms"}},
	}
	entry := gameTemplate{Path: "test/egg-test.json"}
	identity := gameTemplateEggUUID(entry)
	defaults := M{"memory": int64(2048), "disk": int64(10240)}
	out := M{"defaults": defaults}
	addTemplateRecommendations(out, entry, nil, rec)
	if !reflect.DeepEqual(out["defaults"], M{"memory": int64(8192), "disk": int64(20480)}) {
		t.Fatalf("unexpected defaults: %v", out["defaults"])
	}
	want := M{"memory": int64(8192), "disk": int64(20480), "players": &players, "confidence": "community", "source": rec.Source, "note": rec.Note}
	if !reflect.DeepEqual(out["recommendation"], want) || identity != gameTemplateEggUUID(entry) {
		t.Fatal("unexpected recommendation or changed egg identity")
	}
	rec.Confidence = "none"
	out = M{"defaults": defaults}
	variables := []M{{"env_variable": "TEST_TERMS", "rules": "required|in:1,0", "default_value": "0"}}
	addTemplateRecommendations(out, entry, variables, rec)
	if !reflect.DeepEqual(out["defaults"], defaults) || out["recommendation"] != nil || len(out["acceptances"].([]gameAcceptance)) != 1 {
		t.Fatal("confidence none must preserve defaults and still allow agreement metadata")
	}
}

func TestTemplateAcceptanceOptions(t *testing.T) {
	variables := []M{
		{"env_variable": "EULA_ACCEPTED", "rules": "required|in:false,true", "default_value": "false"},
		{"env_variable": "REFORGER_ACCEPT_BATTLEYE", "rules": "required|string|in:0,digest", "default_value": "0"},
		{"env_variable": "SCPSL_ACCEPT_EULA", "rules": "required|boolean", "default_value": "0"},
		{"env_variable": "TEST_TERMS", "rules": "required|boolean", "default_value": "false"},
		{"env_variable": "FIVEM_LICENSE", "rules": "required|string|in:yes,no"},
		{"env_variable": "CFX_LICENSE", "rules": "required|string|in:yes,no"},
	}
	metadata := []gameRecommendationAgreement{
		{"EULA_ACCEPTED", "Custom Minecraft EULA", "https://example.invalid/eula"},
		{"TEST_TERMS", "Test terms", "https://example.invalid/terms"},
		{"TEST_TERMS", "Usage rules", "https://example.invalid/rules"},
		{"FIVEM_LICENSE", "FiveM licence", "https://example.invalid/key"},
		{"CFX_LICENSE", "Cfx licence", "https://example.invalid/key"},
		{"ABSENT_TERMS", "Absent terms", "https://example.invalid/absent"},
	}
	got := templateAcceptances([]templateAgreement{{Environment: "REFORGER_ACCEPT_BATTLEYE"}}, variables, metadata)
	link := func(a gameRecommendationAgreement) gameAcceptanceLink { return gameAcceptanceLink{a.Title, a.URL} }
	scpsl := gameRecommendationAgreement{"SCPSL_ACCEPT_EULA", "SCP: Secret Laboratory EULA", "https://link.scpslgame.com/eula"}
	want := []gameAcceptance{
		{metadata[0], []gameAcceptanceLink{link(metadata[0])}, "true"},
		{scpsl, []gameAcceptanceLink{link(scpsl)}, "1"},
		// One variable covering two documents names and links both.
		{gameRecommendationAgreement{"TEST_TERMS", "Test terms and Usage rules", "https://example.invalid/terms"}, []gameAcceptanceLink{link(metadata[1]), link(metadata[2])}, "true"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("acceptances = %#v, want %#v", got, want)
	}
	if got := templateAcceptValue("required|string|in:0,digest", "0"); got != "digest" {
		t.Fatalf("acceptance digest = %q", got)
	}
	body, err := json.Marshal(got[0])
	if err != nil || string(body) != `{"environment":"EULA_ACCEPTED","title":"Custom Minecraft EULA","url":"https://example.invalid/eula","links":[{"title":"Custom Minecraft EULA","url":"https://example.invalid/eula"}],"accept_value":"true"}` {
		t.Fatalf("acceptance wire format = %s, %v", body, err)
	}
}

func TestSteamRecommendationPreservesProfileDefaults(t *testing.T) {
	spec, ok := steamGameSpecFor("palworld")
	if !ok {
		t.Fatal("missing Palworld profile")
	}
	defaults := M{"memory": spec.Memory, "disk": spec.Disk, "max_players": spec.Players}
	out := M{"defaults": defaults}
	addSteamRecommendation(out, "palworld")
	if !reflect.DeepEqual(out["defaults"], defaults) || out["recommendation"] == nil {
		t.Fatal("managed profile should expose recommendations with its existing defaults")
	}
	out = M{}
	addSteamRecommendation(out, "palworld-native")
	if out["recommendation"] == nil {
		t.Fatal("a managed variant should share its base game's recommendation")
	}
	out = M{}
	addSteamRecommendation(out, "missing")
	if out["recommendation"] != nil {
		t.Fatal("unexpected recommendation for a missing entry")
	}
}

// The researched data must point at real recipes and profiles, and stay
// installable: whole 512 MiB steps of memory, at least 2 GiB of storage, and
// a managed profile never told to use less storage than it provisions.
func TestGameRecommendationData(t *testing.T) {
	paths := map[string]bool{}
	for _, entry := range gameTemplates().Entries {
		paths[entry.Path] = true
	}
	check := func(key string, rec gameRecommendation) {
		switch rec.Confidence {
		case "official", "community", "estimate", "none":
		default:
			t.Errorf("%s: confidence %q", key, rec.Confidence)
		}
		if rec.Memory < 512 || rec.Memory%512 != 0 || rec.Disk < 2048 || rec.Note == "" {
			t.Errorf("%s: memory %d, disk %d, note %q", key, rec.Memory, rec.Disk, rec.Note)
		}
		for _, agreement := range rec.Agreements {
			if agreement.Environment == "" || agreement.Title == "" || !strings.HasPrefix(agreement.URL, "https://") {
				t.Errorf("%s: agreement %#v", key, agreement)
			}
		}
	}
	if len(gameRecommendations.Templates) < 100 {
		t.Fatalf("only %d template recommendations", len(gameRecommendations.Templates))
	}
	for path, rec := range gameRecommendations.Templates {
		if !paths[path] {
			t.Errorf("recommendation for unknown recipe %s", path)
		}
		check(path, rec)
	}
	for id, rec := range gameRecommendations.Steam {
		spec, ok := steamGameSpecFor(id)
		if !ok {
			t.Errorf("recommendation for unknown Steam profile %s", id)
			continue
		}
		check(id, rec)
		if rec.Disk < spec.Disk || rec.Memory < spec.MinimumMemory {
			t.Errorf("%s: recommendation %d MiB / %d MiB is below the profile", id, rec.Memory, rec.Disk)
		}
	}
}

// Recipes sharing an acknowledgement variable each name and link their own project.
func TestLegacyPrerequisiteAcknowledgementsArePerRecipe(t *testing.T) {
	variables := []M{{"env_variable": "ACKNOWLEDGE_LEGACY_PREREQUISITES", "rules": "required|string|in:true,false", "default_value": "false"}}
	for path, want := range map[string]string{
		"League Sandbox/egg-league-sandbox.json": "League Sandbox prerequisites",
		"eft/egg-stay-in-tarkov.json":            "Stay In Tarkov prerequisites",
	} {
		got := templateAcceptances(nil, variables, gameRecommendations.Templates[path].Agreements)
		if len(got) != 1 || got[0].Title != want || got[0].AcceptValue != "true" {
			t.Errorf("%s: acceptances = %#v", path, got)
		}
	}
	if got := templateAcceptances(nil, variables, nil); len(got) != 0 {
		t.Errorf("an unnamed recipe must not borrow another project's acknowledgement: %#v", got)
	}
}
