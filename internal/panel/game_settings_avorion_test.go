package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestAvorionTypedPreservation(t *testing.T) {
	source := []byte("; operator\r\n[Game]\r\nPlayerToPlayerDamage=true\r\nLogoutInvincibilityDelay=30\r\nDifficulty=0\r\n[Networking]\r\nbroadcastInterval=7\r\n[Administration]\r\ndescription=Hello\r\npassword=private\r\n[Mod]\r\nopaque=x\r\n")
	p, e := parseAvorionSettings(source)
	if e != nil {
		t.Fatal(e)
	}
	next, e := p.patch(map[string]string{"Game/PlayerToPlayerDamage": "false", "Networking/broadcastInterval": "9", "Administration/description": "New description"})
	if e != nil {
		t.Fatal(e)
	}
	want := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(string(source), "PlayerToPlayerDamage=true", "PlayerToPlayerDamage=false"), "broadcastInterval=7", "broadcastInterval=9"), "description=Hello", "description=New description")
	if string(next) != want {
		t.Fatalf("unexpected byte change")
	}
	for k, v := range map[string]string{"Game/Difficulty": "3", "Networking/port": "28000", "Administration/password": "new", "Game/PlayerToPlayerDamage": "1", "Networking/broadcastInterval": "-1", "Administration/description": "x\nport=8"} {
		if _, e = p.patch(map[string]string{k: v}); e == nil {
			t.Fatalf("accepted %s", k)
		}
	}
	for _, s := range []string{"[Game]\nPlayerToPlayerDamage=true\nplayertoplayerdamage=false\n", "[Game]\nPlayerToPlayerDamage=1\n", "[Game]\nPlayerToPlayerDamage=true\n[game]\nPlayerToPlayerDamage=false\n"} {
		if _, e := parseAvorionSettings([]byte(s)); e == nil {
			t.Fatal("ambiguous document accepted")
		}
	}
	if !bytes.Contains(source, []byte("password=private")) {
		t.Fatal("source mutated")
	}
}
func TestAvorionCanonicalEmissionAuthority(t *testing.T) {
	data, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts map[string]struct {
				Script string `json:"script"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if e = json.Unmarshal(data, &profiles); e != nil {
		t.Fatal(e)
	}
	profile := profiles[avorionSettingsRecipe]
	in := settingsAuthorityInput{Startup: profile.Egg.Startup, Env: map[string]string{"GALAXY_NAME": "Custom"}, Files: map[string][]byte{"galaxy/Custom/server.ini": []byte("[Networking]\nbroadcastInterval=7\n")}}
	for _, chunk := range strings.Split(profile.Egg.Scripts["installation"].Script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, _, ok := strings.Cut(head, " <<'VOLTRA_SOURCE'")
		if !ok {
			continue
		}
		content, _, ok := strings.Cut(body, "\nVOLTRA_SOURCE")
		if ok {
			in.Files[name] = []byte(strings.TrimRight(content, "\n") + "\n")
		}
	}
	a, e := avorionSettingsAuthority(avorionSettingsRecipe, profile.Egg.Startup, in)
	if e != nil {
		t.Fatal(e)
	}
	if a.Path != "/galaxy/Custom/server.ini" {
		t.Fatal(a)
	}
	in.Env["GALAXY_NAME"] = "../escape"
	if _, e = avorionSettingsAuthority(avorionSettingsRecipe, profile.Egg.Startup, in); e == nil {
		t.Fatal("escape accepted")
	}
	in.Env["GALAXY_NAME"] = "Custom"
	in.Files[".voltra/avorion_runtime.py"] = []byte("altered")
	if _, e = avorionSettingsAuthority(avorionSettingsRecipe, profile.Egg.Startup, in); e == nil {
		t.Fatal("altered launcher accepted")
	}
}
