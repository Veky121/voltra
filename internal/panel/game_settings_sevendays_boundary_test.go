package panel

import (
	"bytes"
	"testing"
)

func TestSevenDaysWave3ManagedConsoleBoundary(t *testing.T) {
	egg := M{"uuid": "6ed6972a-865a-473a-bc9e-22ff682bb154"}
	source := []byte(`<ServerSettings><!-- preserve --><property name="TelnetEnabled" value="true"/><property name="TelnetPort" value="8081"/><property name="TelnetPassword" value="fixture-old"/><property name="DayNightLength" value="60"/><property name="UnknownFuture" value="retained"/></ServerSettings>`)
	parsed, err := parseGameSettingsForEgg(egg, sevenDaysSettingsPath, source)
	if err != nil {
		t.Fatal(err)
	}
	attempts := M{"TelnetEnabled": false, "TelnetPort": "9081", "TelnetPassword": "fixture-new"}
	for key, value := range attempts {
		t.Run(key, func(t *testing.T) {
			if !gameSettingManaged(egg, sevenDaysSettingsPath, key) {
				t.Error("console-owned field is editable in native settings")
			}
			if _, err := gameSettingsChanges(parsed.fields, M{key: value}, egg, sevenDaysSettingsPath); err == nil {
				t.Error("native settings accepted console desynchronization")
			}
		})
	}
	changes, err := gameSettingsChanges(parsed.fields, M{"DayNightLength": "90"}, egg, sevenDaysSettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	output, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(source, []byte(`name="DayNightLength" value="60"`), []byte(`name="DayNightLength" value="90"`), 1)
	if !bytes.Equal(output, expected) {
		t.Fatal("unrelated XML bytes or console credentials changed")
	}
	for _, candidate := range []struct {
		egg  M
		file string
	}{{M{"uuid": "unrelated"}, sevenDaysSettingsPath}, {egg, "/other.xml"}} {
		if gameSettingsRecipeManaged(candidate.egg, candidate.file, "TelnetPassword") {
			t.Fatal("console rule escaped managed recipe/document boundary")
		}
	}
}
