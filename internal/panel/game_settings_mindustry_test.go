package panel

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"testing"
	"voltra/internal/gamesettings"
)

func mindustryTestUTF(t *testing.T, s string) []byte {
	t.Helper()
	b, e := gamesettings.MindustryEncodeUTF(s)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func mindustryTestRow(t *testing.T, key string, kind byte, value []byte) []byte {
	return append(append(mindustryTestUTF(t, key), kind), value...)
}
func mindustryTestInt(n uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, n)
	return b
}
func mindustryTestData(rows ...[]byte) []byte {
	b := mindustryTestInt(uint32(len(rows)))
	for _, r := range rows {
		b = append(b, r...)
	}
	return b
}
func mindustryTestFixture(t *testing.T) []byte {
	return mindustryTestData(
		mindustryTestRow(t, "servername", 4, mindustryTestUTF(t, "Literal 世界 😀")),
		mindustryTestRow(t, "playerlimit", 1, mindustryTestInt(30)),
		mindustryTestRow(t, "autoPause", 0, []byte{1}),
		mindustryTestRow(t, "port", 1, mindustryTestInt(6567)),
		mindustryTestRow(t, "player-data", 5, append(mindustryTestInt(7), []byte{0, 255, 's', 'e', 'c', 'r', 't'}...)),
		mindustryTestRow(t, "operator-unknown", 4, mindustryTestUTF(t, "keep\x00exact😀")),
		mindustryTestRow(t, "unknown-long", 2, []byte{255, 255, 255, 255, 255, 255, 255, 255}),
		mindustryTestRow(t, "unknown-float", 3, []byte{127, 192, 0, 1}),
	)
}

func TestMindustryNativeSpanPreservation(t *testing.T) {
	data := mindustryTestFixture(t)
	parsed, err := gamesettings.ParseMindustrySettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Fields) != 4 {
		t.Fatalf("opaque data exposed: %d", len(parsed.Fields))
	}
	values := map[string]gamesettings.Setting{}
	for _, f := range parsed.Fields {
		values[f.Key] = f
	}
	if values["servername"].Value != "Literal 世界 😀" || values["playerlimit"].Kind != "number" || values["autoPause"].Kind != "boolean" || values["port"].Kind != "number" || !gamesettings.MindustrySettingManaged("port") {
		t.Fatal("native scalar types lost")
	}
	updated, err := parsed.Patch(map[string]string{"servername": "Updated $() \"quoted\" 世界 😀", "autoPause": "false", "playerlimit": "19"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(data, mindustryTestUTF(t, "Literal 世界 😀"), mindustryTestUTF(t, "Updated $() \"quoted\" 世界 😀"), 1)
	expected = bytes.Replace(expected, mindustryTestRow(t, "autoPause", 0, []byte{1}), mindustryTestRow(t, "autoPause", 0, []byte{0}), 1)
	expected = bytes.Replace(expected, mindustryTestRow(t, "playerlimit", 1, mindustryTestInt(30)), mindustryTestRow(t, "playerlimit", 1, mindustryTestInt(19)), 1)
	if !bytes.Equal(updated, expected) {
		t.Fatal("unknown/binary/order bytes changed")
	}
}

func TestMindustryNativeGuards(t *testing.T) {
	parsed, err := gamesettings.ParseMindustrySettings(mindustryTestFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]string{{"port": "1"}, {"player-data": "unsafe"}, {"operator-unknown": "unsafe"}, {"autoPause": "1"}, {"playerlimit": "2147483648"}, {"servername": "bad\ncommand"}, {"servername": "bad\x00text"}, {"playerlimit": "-1"}} {
		if _, err = parsed.Patch(change); err == nil {
			t.Fatalf("unsafe change accepted: %v", change)
		}
	}
	same, err := parsed.Patch(map[string]string{"servername": "Literal 世界 😀"})
	if err != nil || !bytes.Equal(same, mindustryTestFixture(t)) {
		t.Fatal("idempotent edit changed bytes")
	}
}

func TestMindustryNativeMalformedRefusal(t *testing.T) {
	valid := mindustryTestFixture(t)
	cases := [][]byte{nil, {0, 0, 0, 0}, append(append([]byte{}, valid...), 0), valid[:len(valid)-1], mindustryTestData(mindustryTestRow(t, "servername", 4, []byte{0, 1, 0xff})), mindustryTestData(mindustryTestRow(t, "autoPause", 0, []byte{2})), mindustryTestData(mindustryTestRow(t, "playerlimit", 4, mindustryTestUTF(t, "wrong"))), mindustryTestData(mindustryTestRow(t, "binary", 5, []byte{255, 255, 255, 255})), mindustryTestData(mindustryTestRow(t, "unknown", 6, []byte{})), mindustryTestData(mindustryTestRow(t, "servername", 4, mindustryTestUTF(t, "a")), mindustryTestRow(t, "ServerName", 4, mindustryTestUTF(t, "b")))}
	for i, data := range cases {
		if _, err := gamesettings.ParseMindustrySettings(data); err == nil {
			t.Fatalf("malformed fixture accepted: %d", i)
		}
	}
}

func TestMindustryNativeCompressionAndUTF(t *testing.T) {
	data := mindustryTestFixture(t)
	var b bytes.Buffer
	w := zlib.NewWriter(&b)
	_, _ = w.Write(data)
	_ = w.Close()
	compressed := b.Bytes()
	parsed, err := gamesettings.ParseMindustrySettings(compressed)
	if err != nil {
		t.Fatal(err)
	}
	same, err := parsed.Patch(map[string]string{"autoPause": "true"})
	if err != nil || !bytes.Equal(same, compressed) {
		t.Fatal("idempotent compressed data changed")
	}
	updated, err := parsed.Patch(map[string]string{"autoPause": "false"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := gamesettings.ParseMindustrySettings(updated)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range again.Fields {
		if f.Key == "autoPause" && f.Value != "false" {
			t.Fatal("compressed edit lost")
		}
	}
	for _, text := range []string{"literal", "\x00", "世界😀"} {
		raw := mindustryTestUTF(t, text)
		offset := 0
		got, err := gamesettings.MindustryUTF(raw, &offset)
		if err != nil || got != text || offset != len(raw) {
			t.Fatal("modified UTF roundtrip failed")
		}
	}
	if _, err := gamesettings.ParseMindustrySettings(append(append([]byte{}, compressed...), 0)); err == nil {
		t.Fatal("compressed trailing data accepted")
	}
}

func TestMindustryNativeAdvancedControlsStayPrivateAndHeld(t *testing.T) {
	data := mindustryTestData(
		mindustryTestRow(t, "startCommands", 4, mindustryTestUTF(t, "plugin-login opaque-credential")),
		mindustryTestRow(t, "socket", 0, []byte{0}),
		mindustryTestRow(t, "socketInputPort", 1, mindustryTestInt(6859)),
		mindustryTestRow(t, "socketInputAddress", 4, mindustryTestUTF(t, "localhost")),
		mindustryTestRow(t, "autoUpdate", 0, []byte{0}),
	)
	parsed, err := gamesettings.ParseMindustrySettings(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range parsed.Fields {
		if f.Key == "startCommands" && (!f.Secret || f.Kind != "readonly") {
			t.Fatal("startup command credentials exposed")
		}
		if f.Key == "autoUpdate" && f.Kind != "boolean" {
			t.Fatal("managed flag lost its native type")
		}
		if _, err := parsed.Patch(map[string]string{f.Key: f.Value}); err == nil {
			t.Fatalf("advanced/managed edit accepted: %s", f.Key)
		}
	}
	if gamesettings.MindustrySettingManaged("socket") || !gamesettings.MindustrySettingManaged("autoUpdate") {
		t.Fatal("advanced settings mislabeled as platform-owned")
	}
}

func TestMindustryNativeDocumentVersionGate(t *testing.T) {
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "mindustry/egg-mindustry.json" {
			entry = candidate
			break
		}
	}
	if entry.Path == "" {
		t.Fatal("Mindustry catalog entry missing")
	}
	egg := M{"uuid": gameTemplateEggUUID(entry), "startup": "exec bash .voltra/mindustry-start.sh"}
	if gamesettings.MindustrySettingsDocument(egg, gamesettings.MindustrySettingsPath) {
		t.Fatal("old overwriting launcher received native editor authority")
	}
	egg["startup"] = "exec bash .voltra/mindustry-native-start.sh"
	if !gamesettings.MindustrySettingsDocument(egg, gamesettings.MindustrySettingsPath) || !gamesettings.MindustrySettingsManaged(egg, gamesettings.MindustrySettingsPath, "port") {
		t.Fatal("new exact native document not recognized")
	}
	if gamesettings.MindustrySettingsDocument(egg, "/other/settings.bin") || gamesettings.MindustrySettingsManaged(egg, gamesettings.MindustrySettingsPath, "servername") {
		t.Fatal("unrelated document or gameplay value became managed")
	}
}
