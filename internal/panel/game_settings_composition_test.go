package panel

import (
	"bytes"
	"testing"
)

func TestNativeSettingsCompositionSpanRefresh(t *testing.T) {
	for _, tc := range []struct {
		name      string
		parse     func([]byte) (gameSettingsParsed, error)
		source    string
		changes   map[string]string
		preserved string
	}{
		{"sons", parseCompleteSonsSettings, `{"ServerName":"a","Password":"opaque","unknown":123456789012345678901234567890,"GameSettings":{"Gameplay.TreeRegrowth":true,"token":"opaque"}}`, map[string]string{"/ServerName": "much longer name", "/SaveInterval": "300", "/GameSettings/Gameplay.TreeRegrowth": "false"}, `"unknown":123456789012345678901234567890`},
		{"resonite", parseCompleteResoniteSettings, `{"comment":"a","loginPassword":"opaque","unknown":123456789012345678901234567890,"startWorlds":[null,{"sessionName":"same","saveOnExit":false,"token":"opaque"}]}`, map[string]string{"/comment": "much longer comment", "/startWorlds/1/sessionName": "longer session label", "/startWorlds/1/saveOnExit": "true"}, `"token":"opaque"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := append([]byte{0xef, 0xbb, 0xbf}, []byte(tc.source)...)
			parsed, err := tc.parse(input)
			if err != nil {
				t.Fatal(err)
			}
			output, err := parsed.patch(tc.changes)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.HasPrefix(output, []byte{0xef, 0xbb, 0xbf}) || !bytes.Contains(output, []byte(tc.preserved)) {
				t.Fatal("opaque bytes or BOM lost")
			}
			fresh, err := tc.parse(output)
			if err != nil {
				t.Fatal(err)
			}
			values := map[string]string{}
			for _, f := range fresh.fields {
				values[f.key] = f.value
			}
			for key, value := range tc.changes {
				if values[key] != value {
					t.Fatalf("%s=%s want %s", key, values[key], value)
				}
			}
			noop, err := fresh.patch(nil)
			if err != nil || !bytes.Equal(noop, output) {
				t.Fatal("no-op changed bytes")
			}
		})
	}
}

func TestNativeSettingsCompositionRejectsInvalidPartition(t *testing.T) {
	input := []byte(`{"ServerName":"operator","GameSettings":{"Gameplay.TreeRegrowth":true}}`)
	before := append([]byte(nil), input...)
	parsed, err := parseCompleteSonsSettings(input)
	if err != nil {
		t.Fatal(err)
	}
	if output, err := parsed.patch(map[string]string{"/ServerName": "longer", "/GameSettings/Gameplay.TreeRegrowth": "invalid"}); err == nil || output != nil {
		t.Fatal("invalid second partition returned publishable bytes")
	}
	if !bytes.Equal(input, before) {
		t.Fatal("failed validation mutated input")
	}
	if _, err := composeGameSettings(input, parseSonsSettings, parseSonsSettings); err == nil {
		t.Fatal("duplicate ownership accepted")
	}
}
