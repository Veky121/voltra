package panel

import (
	"bytes"
	"testing"

	"voltra/internal/gamesettings"
)

func TestSevenDaysWave3ManagedConsoleBoundary(t *testing.T) {
	egg := M{"uuid": "6ed6972a-865a-473a-bc9e-22ff682bb154"}
	source := []byte(`<ServerSettings><!-- preserve --><property name="TelnetEnabled" value="true"/><property name="TelnetPort" value="8081"/><property name="TelnetPassword" value="fixture-old"/><property name="DayNightLength" value="60"/><property name="UnknownFuture" value="retained"/></ServerSettings>`)
	parsed, err := gamesettings.ParseForEgg(egg, gamesettings.SevenDaysSettingsPath, source)
	if err != nil {
		t.Fatal(err)
	}
	attempts := M{"TelnetEnabled": false, "TelnetPort": "9081", "TelnetPassword": "fixture-new"}
	for key, value := range attempts {
		t.Run(key, func(t *testing.T) {
			if !gamesettings.SettingManaged(egg, gamesettings.SevenDaysSettingsPath, key) {
				t.Error("console-owned field is editable in native settings")
			}
			if _, err := gamesettings.Changes(parsed.Fields, M{key: value}, egg, gamesettings.SevenDaysSettingsPath); err == nil {
				t.Error("native settings accepted console desynchronization")
			}
		})
	}
	changes, err := gamesettings.Changes(parsed.Fields, M{"DayNightLength": "90"}, egg, gamesettings.SevenDaysSettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	output, err := parsed.Patch(changes)
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
	}{{M{"uuid": "unrelated"}, gamesettings.SevenDaysSettingsPath}, {egg, "/other.xml"}} {
		if gamesettings.RecipeManaged(candidate.egg, candidate.file, "TelnetPassword") {
			t.Fatal("console rule escaped managed recipe/document boundary")
		}
	}
}
