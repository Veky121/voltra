package panel

import (
	"reflect"
	"testing"
)

func goldSrcPresentationFixture(t *testing.T) M {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json" {
			return M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	t.Fatal("Vanilla CS16 recipe missing")
	return nil
}

func TestGoldSrcPresentationScopeAndExistingTypes(t *testing.T) {
	egg := goldSrcPresentationFixture(t)
	for key, spec := range goldSrcCS16ScalarSchema() {
		field := M{"key": key, "label": key, "type": spec.kind, "readonly": false, "secret": false, "value": "5"}
		if spec.kind == "boolean" {
			field["value"] = true
		}
		goldSrcCS16SettingPresentation(egg, goldSrcCS16SettingsPath, field)
		if field["label"] == key || field["type"] != spec.kind || field["secret"] != false || field["readonly"] != false {
			t.Fatal("Presentation changed validation, privacy or existing control type", key)
		}
	}
	round := M{"key": "mp_roundtime", "label": "mp_roundtime", "type": "number", "value": "5"}
	goldSrcCS16SettingPresentation(egg, goldSrcCS16SettingsPath, round)
	if round["min"] != float64(1) || round["max"] != float64(9) {
		t.Fatal("Presentation did not use measured native roundtime bounds")
	}
	for _, scope := range []struct {
		egg  M
		file string
	}{{M{"name": "Counter-Strike"}, goldSrcCS16SettingsPath}, {egg, "/cstrike/server.cfg"}, {M{"recipe": "counter_strike/counter_strike_source/egg-counter--strike--source.json"}, goldSrcCS16SettingsPath}} {
		field := M{"key": "mp_forcecamera", "label": "raw", "type": "number", "value": "2", "secret": true}
		want := M{"key": "mp_forcecamera", "label": "raw", "type": "number", "value": "2", "secret": true}
		goldSrcCS16SettingPresentation(scope.egg, scope.file, field)
		if !reflect.DeepEqual(field, want) {
			t.Fatal("Presentation escaped exact scope")
		}
	}
}

func TestGoldSrcPresentationPublisherCameraList(t *testing.T) {
	egg := goldSrcPresentationFixture(t)
	for _, value := range []string{"0", "1", "2"} {
		field := M{"key": "mp_forcecamera", "type": "number", "value": value, "secret": false, "readonly": false}
		goldSrcCS16SettingPresentation(egg, goldSrcCS16SettingsPath, field)
		choices, ok := field["options"].([]M)
		if !ok || len(choices) != 3 || field["type"] != "select" || field["value"] != value {
			t.Fatal("Publisher camera list missing or value changed")
		}
		for i, want := range []string{"0", "1", "2"} {
			if choices[i]["value"] != want {
				t.Fatal("Other-family enum leaked")
			}
		}
	}
	for _, original := range []M{{"key": "mp_forcecamera", "type": "readonly", "value": "unsupported", "readonly": true, "secret": true}, {"key": "mp_forcecamera", "type": "number", "value": "1.0"}, {"key": "hostname", "type": "text", "value": "managed"}} {
		beforeType, beforeValue, beforeSecret := original["type"], original["value"], original["secret"]
		goldSrcCS16SettingPresentation(egg, goldSrcCS16SettingsPath, original)
		if original["type"] != beforeType || original["value"] != beforeValue || original["secret"] != beforeSecret || original["options"] != nil {
			t.Fatal("Readonly, privacy or lexical preservation changed")
		}
	}
}
