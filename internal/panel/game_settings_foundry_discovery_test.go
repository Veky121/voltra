package panel

import (
	"bytes"
	"testing"
)

func TestDiscoveryFoundryLiteralConfig(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "foundry/egg-foundry.json" {
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry)}
		if gameSettingsDiscoveryFormat(egg, "/App.cfg") != "ini" {
			t.Fatal("factory Foundry's literal key=value document was hidden")
		}
		if gameSettingsDiscoveryFormat(egg, "/server.cfg") != "" {
			t.Fatal("unproven executable CFG allowed")
		}
		data := []byte(";operator\r\nserver_name=Before\r\nserver_port=3724\r\nserver_persistent_data_override_folder=Z:\\home\\container\\save\r\nfuture_option=retain\r\n")
		parsed, err := parseDiscoveredGameSettings(egg, "/App.cfg", data)
		if err != nil {
			t.Fatal(err)
		}
		changes, err := gameSettingsChanges(parsed.fields, M{"server_name": "After"}, egg, "/App.cfg")
		if err != nil {
			t.Fatal(err)
		}
		updated, err := parsed.patch(changes)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(updated, bytes.Replace(data, []byte("Before"), []byte("After"), 1)) {
			t.Fatal("unrelated native config bytes changed")
		}
		if !gameSettingManaged(egg, "/App.cfg", "server_query_port") { t.Fatal("query allocation became editable") }
		if _, err = gameSettingsChanges(parsed.fields, M{"server_port": "9999"}, egg, "/App.cfg"); err == nil {
			t.Fatal("allocation-owned port editable")
		}
		return
	}
	t.Fatal("Foundry recipe missing")
}
