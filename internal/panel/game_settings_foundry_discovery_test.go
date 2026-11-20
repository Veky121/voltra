package panel

import (
	"bytes"
	"testing"

	"voltra/internal/gamesettings"
)

func TestDiscoveryFoundryLiteralConfig(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "foundry/egg-foundry.json" {
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry)}
		if gamesettings.DiscoveryFormat(egg, "/App.cfg") != "ini" {
			t.Fatal("factory Foundry's literal key=value document was hidden")
		}
		if gamesettings.DiscoveryFormat(egg, "/server.cfg") != "" {
			t.Fatal("unproven executable CFG allowed")
		}
		data := []byte(";operator\r\nserver_name=Before\r\nserver_port=3724\r\nserver_persistent_data_override_folder=Z:\\home\\container\\save\r\nfuture_option=retain\r\n")
		parsed, err := gamesettings.ParseDiscovered(egg, "/App.cfg", data)
		if err != nil {
			t.Fatal(err)
		}
		changes, err := gamesettings.Changes(parsed.Fields, M{"server_name": "After"}, egg, "/App.cfg")
		if err != nil {
			t.Fatal(err)
		}
		updated, err := parsed.Patch(changes)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(updated, bytes.Replace(data, []byte("Before"), []byte("After"), 1)) {
			t.Fatal("unrelated native config bytes changed")
		}
		if !gamesettings.SettingManaged(egg, "/App.cfg", "server_query_port") { t.Fatal("query allocation became editable") }
		if _, err = gamesettings.Changes(parsed.Fields, M{"server_port": "9999"}, egg, "/App.cfg"); err == nil {
			t.Fatal("allocation-owned port editable")
		}
		return
	}
	t.Fatal("Foundry recipe missing")
}
