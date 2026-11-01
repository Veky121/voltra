package panel

import (
	"strings"
	"testing"
)

// Source-only packet: use the shared parser and validator, never a native process.
func TestBedrockVanillaSharedSettingsPacket(t *testing.T) {
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "minecraft/bedrock/bedrock/egg-vanilla-bedrock.json" {
			egg = entry.Egg
		}
	}
	if egg == nil {
		t.Fatal("exact recipe missing")
	}
	input := []byte("# operator\r\nserver-name=Original\r\nmax-players=7\r\nallow-list=true\r\nserver-port=28020\r\nserver-portv6=28020\r\nserver-udp-ports=28020:28020\r\ntransport=nethernet\r\ncustom=keep\r\n")
	parsed, err := parseGameSettings("/server.properties", input)
	if err != nil {
		t.Fatal(err)
	}
	patch, err := gameSettingsChanges(parsed.fields, M{"max-players": "8", "allow-list": false}, egg, "/server.properties")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(patch)
	if err != nil {
		t.Fatal(err)
	}
	for _, keep := range []string{"# operator\r\n", "custom=keep\r\n", "max-players=8", "allow-list=false"} {
		if !strings.Contains(string(updated), keep) {
			t.Fatalf("lost %q", keep)
		}
	}
	if _, err := gameSettingsChanges(parsed.fields, M{"server-port": "12345"}, egg, "/server.properties"); err == nil {
		t.Fatal("allocated primary port accepted")
	}
	// Record actual admissions for the shared owner. These are observations,
	// deliberately not assertions that the current unsafe behavior is desired.
	for _, key := range []string{"server-name", "server-portv6", "server-udp-ports", "transport"} {
		value := "changed"
		if key == "server-portv6" {
			value = "29000"
		}
		_, err := gameSettingsChanges(parsed.fields, M{key: value}, egg, "/server.properties")
		t.Logf("authority observation: %s managed=%v admission_error=%v", key, gameSettingManaged(egg, "/server.properties", key), err)
	}
}
