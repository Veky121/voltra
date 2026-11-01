package panel

import (
	"bytes"
	"strings"
	"testing"
)

const hl2dmMeasuredFixture = "// app232370 build24600426 effective values, not declaration defaults\r\nmp_timelimit 0\r\nmp_fraglimit 0\r\nmp_teamplay 0\r\nmp_weaponstay 0\r\nmp_friendlyfire 0\r\nmp_flashlight 0\r\nmp_forcerespawn 0\r\nsv_alltalk 0\r\nsv_voiceenable 1\r\nsv_gravity \"600\" // operator\tcomment\r\nmp_chattime 10\r\nsv_hl2mp_weapon_respawn_time 20\r\nsv_hl2mp_item_respawn_time 30\r\n"

func TestHL2DMMeasuredDefaultsAndValueSpans(t *testing.T) {
	p, err := parseHL2DMSettings([]byte(hl2dmMeasuredFixture))
	if err != nil || len(p.fields) != 13 {
		t.Fatal("Actual thirteen-field projection missing", err)
	}
	booleans := 0
	for _, f := range p.fields {
		if f.kind == "readonly" {
			t.Fatal("Reviewed field readonly", f.key)
		}
		if f.kind == "boolean" {
			booleans++
		}
		if f.key == "mp_forcerespawn" && f.value != "0" {
			t.Fatal("Declaration default overwrote effective zero")
		}
	}
	if booleans != 7 {
		t.Fatal("Expected seven native boolean controls", booleans)
	}
	changes := map[string]string{"mp_timelimit": "12", "mp_teamplay": "1", "sv_gravity": "500", "mp_chattime": "15"}
	got, err := p.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := hl2dmMeasuredFixture
	for _, pair := range [][2]string{{"mp_timelimit 0", "mp_timelimit 12"}, {"mp_teamplay 0", "mp_teamplay 1"}, {"sv_gravity \"600\"", "sv_gravity \"500\""}, {"mp_chattime 10", "mp_chattime 15"}} {
		want = strings.Replace(want, pair[0], pair[1], 1)
	}
	if string(got) != want {
		t.Fatal("Edit changed unrelated native spans", string(got))
	}
	if same, err := p.patch(nil); err != nil || string(same) != hl2dmMeasuredFixture {
		t.Fatal("No-op changed bytes")
	}
}

func TestHL2DMClosedDocumentRefusesExecutableAndAmbiguousRows(t *testing.T) {
	for _, extra := range []string{"exec other.cfg", "alias mp_teamplay quit", "hostname private", "rcon_password private", "sv_password private", "sv_lan 0", "servercfgfile own.cfg", "clientport 1", "tv_port 2", "map dm_runoff", "maxplayers 1", "mp_roundtime 3", "sv_gravity 600;quit", "\"sv_gravity\" \"600\"", "MP_TEAMPLAY 1", "mp_chattime 121", "sv_gravity 1e3", "sv_gravity NaN", "sv_gravity -1"} {
		t.Run(extra, func(t *testing.T) {
			data := []byte(hl2dmMeasuredFixture + extra + "\r\n")
			p, err := parseHL2DMSettings(data)
			if err != nil {
				t.Fatal(err)
			}
			for _, f := range p.fields {
				if f.kind != "readonly" {
					t.Fatal("Ambiguous/executable document writable", f.key)
				}
			}
			if _, err := p.patch(map[string]string{"sv_gravity": "500"}); err == nil {
				t.Fatal("Unsafe document accepts edit")
			}
			if same, err := p.patch(nil); err != nil || !bytes.Equal(same, data) {
				t.Fatal("Unsafe no-op modified bytes")
			}
			for _, f := range p.fields {
				if f.key == "rcon_password" || f.key == "sv_password" {
					t.Fatal("Credential exposed by closed schema")
				}
			}
		})
	}
}

func TestHL2DMNumericAndBooleanDomainAgreement(t *testing.T) {
	for _, key := range []string{"mp_timelimit", "mp_fraglimit"} {
		if !hl2dmSettingValue(key, "2147483520") || hl2dmSettingValue(key, "2147483520.000000001") || hl2dmSettingValue(key, "2147483647") {
			t.Fatal("Conservative int conversion guard failed", key)
		}
	}
	if hl2dmSettingValue("mp_fraglimit", "1.5") || !hl2dmSettingValue("mp_timelimit", "1.5") {
		t.Fatal("Kill limit and minutes domains conflated")
	}
	for _, value := range []string{"1", "120", "15.5", "+1"} {
		if !hl2dmSettingValue("mp_chattime", value) {
			t.Fatal("Native bounded scalar refused", value)
		}
	}
	for _, value := range []string{"0", "0.99999999999999999999999", "120.000000000000000000001", "121", "-1", "1e2", "NaN", "1;quit", "1\nquit", strings.Repeat("9", 33)} {
		if hl2dmSettingValue("mp_chattime", value) {
			t.Fatal("Invalid exact domain accepted", value)
		}
	}
	for _, value := range []string{"true", "yes", "1.0", "00", "+1", "2"} {
		if hl2dmSettingValue("mp_teamplay", value) {
			t.Fatal("Noncanonical native flag accepted", value)
		}
	}
	for _, value := range []string{"0", "1"} {
		if !hl2dmSettingValue("mp_teamplay", value) {
			t.Fatal("Native flag refused", value)
		}
	}
	if hl2dmSettingValue("rcon_password", "1") || hl2dmSettingValue("mp_roundtime", "1") {
		t.Fatal("Schema leaked across game/managed boundary")
	}
}

func TestHL2DMEncodingResourceAndLineRefusals(t *testing.T) {
	for _, data := range [][]byte{bytes.Repeat([]byte{'/'}, 65537), {0xff}, {0xef, 0xbb, 0xbf, 'x'}, []byte("sv_gravity 600\r"), []byte("sv_gravity 600\r\r\n"), []byte("// hidden\x00value\n"), []byte("// hidden\x7fvalue\n"), []byte("sv_gravity 600\u2028"), []byte("// hidden\u0085value\n")} {
		if _, err := parseHL2DMSettings(data); err == nil {
			t.Fatal("Unsupported native input accepted", data)
		}
	}
}

func TestHL2DMPartialMixedCaseAndOtherSchemaPreservation(t *testing.T) {
	data := []byte("// keep\r\nSV_GRAVITY \"600\" // tab\tcomment\r\n")
	p, err := parseHL2DMSettings(data)
	if err != nil || len(p.fields) != 1 || p.fields[0].key != "sv_gravity" {
		t.Fatal("Partial native field missing", err)
	}
	got, err := p.patch(map[string]string{"sv_gravity": "500"})
	if err != nil || string(got) != strings.Replace(string(data), "600", "500", 1) {
		t.Fatal("Case/comment preservation failed", err)
	}
	if _, err := p.patch(map[string]string{"mp_teamplay": "1"}); err == nil {
		t.Fatal("Partial operator file silently gained missing defaults")
	}
	if sourceSettingKinds["mp_roundtime"] != "number" || !sourceSettingValue("mp_roundtime", "5") {
		t.Fatal("Existing CS2 schema changed")
	}
}

func TestHL2DMPresentationRequiresExactRecipeAndPath(t *testing.T) {
	// Identity mismatch must never decorate another Source game's document.
	field := M{"key": "mp_chattime", "type": "number", "value": "10"}
	hl2dmSettingPresentation(M{}, hl2dmSettingsPath, field)
	if _, ok := field["label"]; ok {
		t.Fatal("Unidentified recipe acquired HL2DM presentation")
	}
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == hl2dmSettingsRecipe {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": hl2dmSettingsStartup}
		}
	}
	if egg == nil {
		t.Fatal("Exact catalog identity missing")
	}
	hl2dmSettingPresentation(egg, hl2dmSettingsPath, field)
	if field["label"] != "Postgame chat duration (seconds)" || field["min"] != 1 || field["max"] != 120 {
		t.Fatal("Native bounds/plain label missing", field)
	}
	secret := M{"key": "mp_chattime", "type": "number", "secret": true}
	hl2dmSettingPresentation(egg, hl2dmSettingsPath, secret)
	if _, ok := secret["min"]; ok {
		t.Fatal("Secret presentation became editable")
	}
	other := M{"key": "mp_chattime", "type": "number"}
	hl2dmSettingPresentation(egg, "/hl2mp/cfg/server.cfg", other)
	if _, ok := other["label"]; ok {
		t.Fatal("Legacy executable config gained gameplay presentation")
	}
	old := M{"uuid": egg["uuid"], "startup": "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_variant_runtime.py"}
	if hl2dmSettingsDocument(old, hl2dmSettingsPath) || !hl2dmSettingsDocument(egg, hl2dmSettingsPath) || hl2dmSettingsDocument(egg, "/hl2mp/cfg/server.cfg") {
		t.Fatal("Startup/file authority boundary failed")
	}
	oldField := M{"key": "mp_chattime", "type": "number"}
	hl2dmSettingPresentation(old, hl2dmSettingsPath, oldField)
	if _, ok := oldField["label"]; ok {
		t.Fatal("Old launcher acquired an ineffective editor projection")
	}
}
