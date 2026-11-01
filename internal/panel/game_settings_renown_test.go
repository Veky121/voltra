package panel

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestRenownCompleteInstallerSeeds(t *testing.T) {
	data, err := os.ReadFile("game_library/scripts/ghost-love-renown-config.json")
	if err != nil {
		t.Fatal(err)
	}
	var seeds struct {
		Templates map[string]string `json:"templates"`
	}
	if err = json.Unmarshal(data, &seeds); err != nil {
		t.Fatal(err)
	}
	for name, raw := range seeds.Templates {
		p, err := parseRenownSettings(renownSettingsDirectory+name, []byte(raw))
		if err != nil {
			t.Fatal(name, err)
		}
		b, err := p.patch(map[string]string{})
		if err != nil || string(b) != raw {
			t.Fatalf("seed bytes %s: %v", name, err)
		}
		if name == "Game.ini" {
			key := "/Game/Core/Blueprints/GameModes/Renown_Base_GameMode.Renown_Base_GameMode_C/ResourceGainMultiplier"
			b, err = p.patch(map[string]string{key: "2"})
			if err != nil || !strings.Contains(string(b), "ResourceGainMultiplier=2") {
				t.Fatalf("gameplay scalar %v", err)
			}
		}
	}
}

func TestRenownNativeEdits(t *testing.T) {
	raw := []byte("[Server]\r\nFirstPersonOnly=1\r\n; keep\r\nUnknown=secret\r\n")
	p, err := parseRenownSettings(renownSettingsDirectory+"Engine.ini", raw)
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.patch(map[string]string{"Server/FirstPersonOnly": "0"})
	if err != nil || string(b) != strings.Replace(string(raw), "FirstPersonOnly=1", "FirstPersonOnly=0", 1) {
		t.Fatalf("edit: %q %v", b, err)
	}
	if _, err := parseRenownSettings("/Game.ini", raw); err == nil {
		t.Fatal("accepted wrong path")
	}
	p, err = parseRenownSettings(renownSettingsDirectory+"Game.ini", []byte("[S]\nRCONPort=28003\nMaxPlayers=32\nMaxPlayers=64\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"S/RCONPort", "S/MaxPlayers"} {
		if _, err := p.patch(map[string]string{key: "5"}); err == nil {
			t.Fatal("accepted managed/duplicate", key)
		}
	}
}
