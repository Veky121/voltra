package panel

import (
	"context"
	"net/http"
	"testing"
)

func TestManagedSteamTemplateNativeReviewMetadata(t *testing.T) {
	count := 0
	for _, entry := range gameTemplates().Entries {
		managed := steamCatalogBridgeID(entry.Path)
		if managed == "" {
			continue
		}
		count++
		out := templateSummary(entry)
		if str(out["verification"]) != "runtime_verified" || str(out["detail"]) != steamCatalogVerifiedDetail(entry.Path) || str(out["managed_game"]) != managed {
			t.Fatalf("Managed catalog alias lost reviewed metadata: %s", entry.Path)
		}
		if str(out["managed_install_url"]) != "/api/client/game-library/steam/"+managed+"/install" {
			t.Fatalf("Managed alias no longer uses shared setup: %s", entry.Path)
		}
	}
	if count != 4 {
		t.Fatalf("Managed review coverage changed: %d", count)
	}
}

func TestGameTemplateManagedDependencyGateCannotBeBypassed(t *testing.T) {
	// The reviewed public Proton runtime is available in shipping source. Use a
	// synthetic dependency outage to keep testing the generic imported-route gate.
	spec, ok := steamGameSpecFor("palworld-proton")
	if !ok || spec.UnavailableReason != "" {
		t.Fatal("reviewed public Proton setup remains unavailable")
	}
	original := steamGameSpecs
	steamGameSpecs = append([]steamGameSpec(nil), original...)
	t.Cleanup(func() { steamGameSpecs = original })
	for i := range steamGameSpecs {
		if steamGameSpecs[i].ID == "palworld-proton" {
			steamGameSpecs[i].UnavailableReason = "Synthetic dependency outage for imported-route regression."
		}
	}
	a, _, admin, _, _ := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	var blocked gameTemplate
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "palworld/egg-palworld-proton.json" && gameTemplateSetupUnavailable(entry) != "" {
			blocked = entry
		}
		if entry.Path == "openttd/egg-open-t-t-d-server.json" && !boolean(templateSummary(entry)["available"]) {
			t.Fatal("unrelated game setup was disabled")
		}
		if entry.Path == "swords_'n_Magic_and_Stuff/egg-swords-n-magic-and-stuff.json" && gameTemplateSetupUnavailable(entry) != "" {
			t.Fatal("publisher-documented native environment settings were incorrectly blocked")
		}
	}
	if blocked.ID == "" || blocked.Path != "palworld/egg-palworld-proton.json" || boolean(templateSummary(blocked)["available"]) {
		t.Fatal("managed dependency gate was not inherited by its imported template")
	}
	before, err := a.one(context.Background(), "SELECT count(*) AS count FROM servers")
	if err != nil {
		t.Fatal(err)
	}
	// The gate precedes input decoding, allocation selection and egg/server writes.
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+blocked.ID+"/install", nil, 409)
	after, err := a.one(context.Background(), "SELECT count(*) AS count FROM servers")
	if err != nil || num(after["count"]) != num(before["count"]) {
		t.Fatal("blocked setup changed server state", err)
	}
}
