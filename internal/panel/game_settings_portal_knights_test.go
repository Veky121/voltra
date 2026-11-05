package panel

import (
	"bytes"
	"os"
	"testing"
)

func TestPortalKnightsSettingsPreserveBytes(t *testing.T) {
	data, err := os.ReadFile("../../artifacts/portal-knights-settings-followup/publisher-schema.fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parsePortalKnightsSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 11 {
		t.Fatalf("fields: %d", len(p.fields))
	}
	for _, f := range p.fields {
		if f.secret || f.key == "/admins/credentials/password" {
			t.Fatal("credential exposed")
		}
	}
	unchanged, err := p.patch(nil)
	if err != nil || !bytes.Equal(data, unchanged) {
		t.Fatal("no-op changed bytes", err)
	}
	changes := map[string]string{"/basicServerData/name": "New \"name\"", "/universeSize": "Large", "/guests/canLogin": "true"}
	got, err := p.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(data, []byte(`"Servername"`), []byte(`"New \"name\""`), 1)
	want = bytes.Replace(want, []byte(`"Normal"`), []byte(`"Large"`), 1)
	want = bytes.Replace(want, []byte(`"canLogin": false`), []byte(`"canLogin": true`), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("patch changed unrelated bytes")
	}
	if _, err := parsePortalKnightsSettings(got); err != nil {
		t.Fatal(err)
	}
	for _, patch := range []map[string]string{{"/basicServerData/port": "12345"}, {"/admins/credentials/password": "changed"}, {"/hideConsoleWindow": "true"}, {"/gameplayMode": "Creative"}, {"/admins/canInteractWithLockables": "false"}, {"/universeSize": "Huge"}, {"/users/canLogin": "1"}, {"/basicServerData/name": "bad\nname"}} {
		if _, err := p.patch(patch); err == nil {
			t.Fatalf("accepted %v", patch)
		}
	}
	if !bytes.Equal(data, unchanged) {
		t.Fatal("refusal mutated input")
	}
}

func TestPortalKnightsSettingsRejectAmbiguity(t *testing.T) {
	for _, data := range []string{`{"universeSize":"Normal","universeSize":"Large"}`, `{"universeSize":"Normal","UniverseSize":"Large"}`, `{"admins":{"canLogin":"true"}}`, `{"admins":[]}`, `{"basicServerData":{"name":null}}`, `{"x":{"a":1,"a":2}}`, `{"x":1} {}`, `[]`, `{"universeSize":false}`} {
		if _, err := parsePortalKnightsSettings([]byte(data)); err == nil {
			t.Fatalf("accepted %s", data)
		}
	}
	p, err := parsePortalKnightsSettings([]byte(`{"unknown":123456789012345678901234567890}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 0 {
		t.Fatal("invented fields")
	}
	if _, err := p.patch(map[string]string{"/universeSize": "Normal"}); err == nil {
		t.Fatal("inserted absent key")
	}
}
