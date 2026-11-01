package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestCarrierSettingsByteRoundTrip(t *testing.T) {
	source := []byte("\xef\xbb\xbf<?xml version=\"1.0\"?>\r\n<!-- <data server_name='fake'> -->\r\n<data unknown=\"fake password='do not edit'\" server_name = 'Native &amp; World' password=\"private&amp;secret\" save_name='existing save' max_players=\"04\" port=\"28020\" blueprints='0' game_data_path='operator_rom'><permissions><peer is_admin='true'/></permissions><active_mod_folders><mod value='licensed/mod'/></active_mod_folders><!--keep--></data>\r\n")
	parsed, err := parseCarrierGameSettings(source)
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]gameSetting{}
	for _, field := range parsed.fields {
		fields[field.key] = field
	}
	if len(fields) != 5 || !fields["password"].secret || fields["max_players"].kind != "number" || fields["blueprints"].kind != "boolean" || fields["blueprints"].on != "1" {
		t.Fatal("typed controls or secret marking missing")
	}
	same, err := parsed.patch(map[string]string{"server_name": "Native & World", "password": "private&secret", "max_players": "04"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("no-op changed native bytes")
	}
	updated, err := parsed.patch(map[string]string{"server_name": "New ' <&>\"", "max_players": "16", "blueprints": "1"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(source, []byte("'Native &amp; World'"), []byte("'New &#39; &lt;&amp;&gt;&#34;'"), 1)
	want = bytes.Replace(want, []byte(`max_players="04"`), []byte(`max_players="16"`), 1)
	want = bytes.Replace(want, []byte("blueprints='0'"), []byte("blueprints='1'"), 1)
	if !bytes.Equal(updated, want) {
		t.Fatalf("unrelated XML bytes changed: %s", updated)
	}
	if _, err = parseCarrierGameSettings(updated); err != nil {
		t.Fatal(err)
	}
	if _, err = parsed.patch(map[string]string{"port": "29000"}); err == nil {
		t.Fatal("runtime port writable")
	}
	if _, err = parsed.patch(map[string]string{"game_data_path": "outside"}); err == nil {
		t.Fatal("unreviewed path writable")
	}
}

func TestCarrierSettingsBoundsAndInjection(t *testing.T) {
	data := []byte(`<data server_name="Native" password="" save_name="" max_players="4" island_count="16" island_count_per_team="1" carrier_count_per_team="1" team_count_ai="1" team_count_human="1" base_difficulty="0" loadout_type="0" blueprints="0"/>`)
	parsed, err := parseCarrierGameSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"max_players": "17"}, {"island_count": "3"}, {"island_count_per_team": "9"}, {"carrier_count_per_team": "0"},
		{"team_count_ai": "-1"}, {"team_count_human": "0"}, {"base_difficulty": "3"}, {"loadout_type": "3"}, {"blueprints": "true"},
		{"server_name": "bad\nport=1"}, {"password": strings.Repeat("x", 65)}, {"save_name": "../outside"}, {"save_name": "world:evil"},
	} {
		if _, err = parsed.patch(changes); err == nil {
			t.Fatalf("accepted unsafe changes %v", changes)
		}
	}
	updated, err := parsed.patch(map[string]string{"team_count_ai": "0", "max_players": "16", "island_count": "32", "base_difficulty": "2", "loadout_type": "2", "password": "literal & <password>"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = parseCarrierGameSettings(updated); err != nil {
		t.Fatal(err)
	}
}

func TestCarrierSettingsNumericBooleanPreservation(t *testing.T) {
	for _, value := range []string{"00", "01"} {
		source := []byte(`<data blueprints="` + value + `"/>`)
		parsed, err := parseCarrierGameSettings(source)
		if err != nil {
			t.Fatal(err)
		}
		if parsed.fields[0].value != value[1:] || parsed.fields[0].kind != "boolean" {
			t.Fatal("native numeric boolean displayed incorrectly")
		}
		same, err := parsed.patch(map[string]string{"blueprints": value[1:]})
		if err != nil || !bytes.Equal(same, source) {
			t.Fatal("no-op boolean normalized native bytes")
		}
	}
}

func TestCarrierSettingsRejectsUnsafeXML(t *testing.T) {
	for _, data := range []string{
		`<!DOCTYPE data><data/>`, `<!DOCTYPE data [<!ENTITY secret "private">]><data password="&secret;"/>`,
		`<data password="a" password="b"/>`, `<data password="a" Password="b"/>`, `<data Port="28020"/>`,
		`<ServerSettings/>`, `<Data/>`, `<data/><data/>`, `<data>`, `<data password="&undefined;"/>`,
		`<data max_players="17"/>`, `<data save_name="../escape"/>`, `<?unsafe content?><data/>`,
		`<data xmlns:x="urn:test" password="a" x:password="b"/>`,
		"<data password=\"bad\x00value\"/>", string([]byte{0xff}), strings.Repeat("x", 8*1024*1024+1),
		"<data>" + strings.Repeat("<child>", 129) + strings.Repeat("</child>", 129) + "</data>",
	} {
		if _, err := parseCarrierGameSettings([]byte(data)); err == nil {
			t.Fatalf("accepted unsafe XML prefix %q", data[:min(len(data), 60)])
		}
	}
}

func TestCarrierPresentationAndOrder(t *testing.T) {
	egg := batchSettingsRecipeFixture(t, carrierAuthorityRecipe)
	field := M{"key": "base_difficulty", "value": "1"}
	carrierSettingPresentation(egg, carrierSettingsPath, field)
	if field["type"] != "select" || len(field["options"].([]M)) != 3 {
		t.Fatal(field)
	}
	number := M{"key": "max_players"}
	carrierSettingPresentation(egg, carrierSettingsPath, number)
	if number["min"] != 1 || number["max"] != 16 {
		t.Fatal(number)
	}
	source := []byte(`<data loadout_type="2" password="secret" base_difficulty="1" blueprints="01" max_players="04"/>`)
	parsed, err := parseCarrierGameSettings(source)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"loadout_type", "password", "base_difficulty", "blueprints", "max_players"}
	for i, f := range parsed.fields {
		if f.key != want[i] {
			t.Fatal("native attribute order changed")
		}
	}
	same, err := parsed.patch(map[string]string{})
	if err != nil || !bytes.Equal(source, same) {
		t.Fatal("empty patch changed bytes")
	}
}
