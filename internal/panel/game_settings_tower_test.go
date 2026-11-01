package panel

import (
	"bytes"
	"strings"
	"testing"
)

const towerSettingsFixture = "\ufeff; native fixture\r\n[/Script/TowerNetworking.DedicatedServerOptions]\r\nServerTitle = \"Original\"  \r\nSteamLoginToken=private-steam\r\nTowerLoginToken=private-tower\r\nMaxPlayers=40\r\n[DedicatedCondoOptions]\r\nCondoAutoSave = True\r\nCondoBackupsEnabled = False\r\n[Administration]\r\nAdminSteamID=111\r\nAdminSteamID=222\r\n[Unknown]\r\nNumber=9007199254740993123\r\nArray=a\r\nArray=b\r\n"

func TestTowerSettingsPreservation(t *testing.T) {
	data := []byte(towerSettingsFixture)
	parsed, err := parseTowerSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.fields) != 3 {
		t.Fatalf("Expected only three reviewed fields, got %d", len(parsed.fields))
	}
	for _, f := range parsed.fields {
		if strings.Contains(f.value, "private-") || strings.Contains(f.key, "Token") {
			t.Fatal("Opaque credentials exposed")
		}
	}
	changes := map[string]string{
		"/Script/TowerNetworking.DedicatedServerOptions/ServerTitle": "Longer operator title",
		"DedicatedCondoOptions/CondoAutoSave":                        "False",
	}
	updated, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Replace(towerSettingsFixture, "\"Original\"", "\"Longer operator title\"", 1)
	expected = strings.Replace(expected, "CondoAutoSave = True", "CondoAutoSave = False", 1)
	if string(updated) != expected {
		t.Fatal("Untouched bytes changed")
	}
	again, err := parseTowerSettings(updated)
	if err != nil {
		t.Fatal(err)
	}
	noop, err := again.patch(changes)
	if err != nil || !bytes.Equal(noop, updated) {
		t.Fatal("Repeated save changed bytes", err)
	}
	if _, err := parseTowerSettings([]byte("[Unknown]\nArray=a\nArray=b\n")); err != nil {
		t.Fatal("Unrelated repeated arrays must remain opaque", err)
	}
}

func TestTowerSettingsAmbiguityRefusal(t *testing.T) {
	for name, data := range map[string]string{
		"case section":      strings.Replace(towerSettingsFixture, "[DedicatedCondoOptions]", "[/SCRIPT/TOWERNETWORKING.DEDICATEDSERVEROPTIONS]\nServerTitle=shadow\n[DedicatedCondoOptions]", 1),
		"case key":          strings.Replace(towerSettingsFixture, "MaxPlayers=40", "servertitle=shadow\nMaxPlayers=40", 1),
		"malformed section": strings.Replace(towerSettingsFixture, "[DedicatedCondoOptions]", "[DedicatedCondoOptions", 1),
		"quote":             strings.Replace(towerSettingsFixture, "\"Original\"", "\"unclosed", 1),
		"boolean":           strings.Replace(towerSettingsFixture, "CondoAutoSave = True", "CondoAutoSave = maybe", 1),
		"invalid utf8":      string([]byte{255, 254}),
		"array alias":       strings.Replace(towerSettingsFixture, "MaxPlayers=40", "+ServerTitle=shadow\nMaxPlayers=40", 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseTowerSettings([]byte(data)); err == nil {
				t.Fatal("Ambiguous or invalid scalar accepted")
			}
		})
	}
}

func TestTowerSettingsInvalidPatchCannotPublish(t *testing.T) {
	parsed, err := parseTowerSettings([]byte(towerSettingsFixture))
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"DedicatedCondoOptions/CondoAutoSave": "1"},
		{"/Script/TowerNetworking.DedicatedServerOptions/SteamLoginToken": "replacement"},
		{"/Script/TowerNetworking.DedicatedServerOptions/ServerTitle": "safe", "unknown": "value"},
		{"/Script/TowerNetworking.DedicatedServerOptions/ServerTitle": "injected\nMaxPlayers=999"},
		{"/Script/TowerNetworking.DedicatedServerOptions/ServerTitle": "trailing;comment"},
		{"/Script/TowerNetworking.DedicatedServerOptions/ServerTitle": strings.Repeat("x", 513)},
	} {
		updated, err := parsed.patch(changes)
		if err == nil || updated != nil {
			t.Fatal("Invalid mixed patch returned publishable bytes", err)
		}
	}
}
