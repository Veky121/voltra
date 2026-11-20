package panel

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"voltra/internal/apiutil"
)

func TestGameSettingsSharedErrorsKeepTheirStatus(t *testing.T) {
	for _, tc := range []struct {
		err          error
		status       int
		code, detail string
	}{
		{apiutil.Bad("Choose a value."), 422, "ValidationException", "Choose a value."},
		{&apiutil.APIError{Status: 409, Code: "GameSettingsSelectionChanged", Detail: "Reload."}, 409, "GameSettingsSelectionChanged", "Reload."},
	} {
		w := httptest.NewRecorder()
		gameSettingsHost{}.Fail(w, tc.err)
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || !strings.Contains(w.Body.String(), tc.detail) {
			t.Fatalf("shared error became %d %s", w.Code, w.Body.String())
		}
	}
}

// Failure logs name the handler that failed, not the Host forwarder.
func TestGameSettingsFailureNamesTheCaller(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	gameSettingsHost{}.Fail(httptest.NewRecorder(), bad("Choose a value."))
	var record struct{ Handler string }
	if err := json.Unmarshal(logs.Bytes(), &record); err != nil || record.Handler != "voltra/internal/panel.TestGameSettingsFailureNamesTheCaller" {
		t.Fatalf("failure attributed to %q (%v)", record.Handler, err)
	}
	// diagnosticFailureCaller skips these frames by name.
	if name := runtime.FuncForPC(reflect.ValueOf(gameSettingsHost.Fail).Pointer()).Name(); name != "voltra/internal/panel.gameSettingsHost.Fail" {
		t.Fatalf("forwarder renamed to %s", name)
	}
}

func TestGameSettingsProfilesFollowCatalogChanges(t *testing.T) {
	before := gameSettingsProfiles()
	if len(before) != len(gameTemplates().Entries) {
		t.Fatalf("profiles %d, templates %d", len(before), len(gameTemplates().Entries))
	}
	for i, entry := range gameTemplates().Entries {
		p := before[i]
		if p.Path != entry.Path || p.EggUUID != gameTemplateEggUUID(entry) || len(p.SettingsDocuments) != len(entry.SettingsDocuments) {
			t.Fatalf("profile %d differs from %s", i, entry.Path)
		}
	}
	length := len(templates.Entries)
	templates.Entries = append(templates.Entries, gameTemplate{Path: "fixture/egg-profile-cache.json", Egg: M{"startup": "fixture"}})
	t.Cleanup(func() { templates.Entries = templates.Entries[:length] })
	after := gameSettingsProfiles()
	if len(after) != length+1 || after[length].Path != "fixture/egg-profile-cache.json" {
		t.Fatal("appended template not visible to game settings")
	}
}
