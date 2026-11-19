package panel

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGameCatalogResponseHoldsBothListsForTheLibraryGrid(t *testing.T) {
	responses, err := gameCatalogResponses()
	if err != nil {
		t.Fatal(err)
	}
	for audience, canInstall := range []bool{false, true} {
		var body struct {
			Object     string `json:"object"`
			Attributes struct {
				CanInstall bool `json:"can_install"`
				Revision   string
				Templates  []M
				Steam      []M
			}
		}
		if err := json.Unmarshal(responses.catalog[audience].body, &body); err != nil {
			t.Fatal(err)
		}
		attributes := body.Attributes
		if body.Object != "game_catalog" || attributes.CanInstall != canInstall || attributes.Revision != gameTemplates().Revision {
			t.Fatalf("unexpected envelope for audience %d: %s %v %q", audience, body.Object, attributes.CanInstall, attributes.Revision)
		}
		if len(attributes.Templates) != len(gameTemplates().Entries) || len(attributes.Steam) != len(steamGameSpecs) {
			t.Fatalf("catalog lists %d recipes and %d guided games", len(attributes.Templates), len(attributes.Steam))
		}
		for _, card := range attributes.Templates {
			if str(card["id"]) == "" || str(card["name"]) == "" || str(card["category"]) == "" || str(card["source"]) == "" {
				t.Fatalf("recipe card is missing grid fields: %v", card)
			}
			// Setup metadata belongs to the setup endpoints.
			for _, field := range []string{"setup_steps", "port_rules", "setup_validation", "steam_installation", "profile"} {
				if _, exists := card[field]; exists {
					t.Fatalf("recipe card %s carries %s", card["id"], field)
				}
			}
		}
	}
	if responses.catalog[0].tag == responses.catalog[1].tag {
		t.Fatal("member and administrator catalogs must not share a tag")
	}
	again, err := gameCatalogResponses()
	if err != nil || again.catalog[1].tag != responses.catalog[1].tag {
		t.Fatalf("catalog was rebuilt: %v", err)
	}
	// A replaced list is read again even when it is the same length.
	original := steamGameSpecs
	steamGameSpecs = append([]steamGameSpec(nil), original...)
	steamGameSpecs[0].Name = "Renamed for the test"
	t.Cleanup(func() { steamGameSpecs = original })
	renamed, err := gameCatalogResponses()
	if err != nil || renamed.catalog[1].tag == responses.catalog[1].tag || !strings.Contains(string(renamed.catalog[0].body), "Renamed for the test") {
		t.Fatalf("a replaced guided list was answered from the old cache: %v", err)
	}
}

// Real PostgreSQL in infraTestApp's disposable schema.
func TestGameCatalogEndpointsAnswerEachAudienceAndRefuseAnonymousRequests(t *testing.T) {
	a, _, admin := infraTestApp(t)
	member, err := a.insert(t.Context(), "users", M{"uuid": newUUID(), "username": "catalog_member", "email": "catalog-member@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	get := func(path string, user int64, tag string) *httptest.ResponseRecorder {
		request := httptest.NewRequest("GET", path, nil)
		if user > 0 {
			request = WithUser(request, user)
		}
		if tag != "" {
			request.Header.Set("If-None-Match", tag)
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		return response
	}
	for _, path := range []string{"/api/client/game-library/catalog", "/api/client/game-library/templates"} {
		tags := map[bool]string{}
		for user, canInstall := range map[int64]bool{admin: true, num(member["id"]): false} {
			response := get(path, user, "")
			var body struct {
				Attributes struct {
					CanInstall *bool `json:"can_install"`
				} `json:"attributes"`
			}
			if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &body) != nil || body.Attributes.CanInstall == nil || *body.Attributes.CanInstall != canInstall {
				t.Fatalf("%s for can_install=%v: %d %.120s", path, canInstall, response.Code, response.Body.String())
			}
			tags[canInstall] = response.Header().Get("ETag")
			if repeat := get(path, user, tags[canInstall]); repeat.Code != http.StatusNotModified || repeat.Body.Len() != 0 {
				t.Fatalf("%s: unchanged answer was sent again (%d, %d bytes)", path, repeat.Code, repeat.Body.Len())
			}
		}
		if tags[true] == "" || tags[true] == tags[false] {
			t.Fatalf("%s: member and administrator answers share the tag %q", path, tags[true])
		}
		// Another audience's tag is not this one's answer.
		if crossed := get(path, num(member["id"]), tags[true]); crossed.Code != http.StatusOK || !strings.Contains(crossed.Body.String(), `"can_install":false`) {
			t.Fatalf("%s: a member holding the administrator tag got %d", path, crossed.Code)
		}
		// Knowing a tag proves nothing about who is asking.
		if anonymous := get(path, 0, tags[true]); anonymous.Code != http.StatusUnauthorized {
			t.Fatalf("%s: an anonymous request with a valid tag got %d", path, anonymous.Code)
		}
	}
}

func TestRevalidatedJSONAnswersMatchingTagsWithoutABody(t *testing.T) {
	response, err := newRevalidatedJSON(M{"games": []string{"rust"}})
	if err != nil {
		t.Fatal(err)
	}
	first := httptest.NewRecorder()
	response.write(first, httptest.NewRequest("GET", "/api/client/game-library/catalog", nil))
	if first.Code != http.StatusOK || first.Header().Get("ETag") != response.tag || first.Header().Get("Cache-Control") != "private, no-cache" || first.Body.Len() == 0 {
		t.Fatalf("first response: %d %v", first.Code, first.Header())
	}
	for _, sent := range []string{response.tag, "W/" + response.tag, `"other", ` + response.tag} {
		request := httptest.NewRequest("GET", "/api/client/game-library/catalog", nil)
		request.Header.Set("If-None-Match", sent)
		repeat := httptest.NewRecorder()
		response.write(repeat, request)
		if repeat.Code != http.StatusNotModified || repeat.Body.Len() != 0 {
			t.Fatalf("If-None-Match %s: %d with %d bytes", sent, repeat.Code, repeat.Body.Len())
		}
	}
	request := httptest.NewRequest("GET", "/api/client/game-library/catalog", nil)
	request.Header.Set("If-None-Match", `"stale"`)
	changed := httptest.NewRecorder()
	response.write(changed, request)
	if changed.Code != http.StatusOK || changed.Body.Len() == 0 {
		t.Fatalf("stale tag: %d", changed.Code)
	}
}
