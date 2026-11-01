package panel

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"testing"
)

func mindustryTestUTF(t *testing.T, s string) []byte {
	t.Helper()
	b, e := mindustryEncodeUTF(s)
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
	parsed, err := parseMindustrySettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.fields) != 4 {
		t.Fatalf("opaque data exposed: %d", len(parsed.fields))
	}
	values := map[string]gameSetting{}
	for _, f := range parsed.fields {
		values[f.key] = f
	}
	if values["servername"].value != "Literal 世界 😀" || values["playerlimit"].kind != "number" || values["autoPause"].kind != "boolean" || values["port"].kind != "number" || !mindustrySettingManaged("port") {
		t.Fatal("native scalar types lost")
	}
	updated, err := parsed.patch(map[string]string{"servername": "Updated $() \"quoted\" 世界 😀", "autoPause": "false", "playerlimit": "19"})
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
	parsed, err := parseMindustrySettings(mindustryTestFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]string{{"port": "1"}, {"player-data": "unsafe"}, {"operator-unknown": "unsafe"}, {"autoPause": "1"}, {"playerlimit": "2147483648"}, {"servername": "bad\ncommand"}, {"servername": "bad\x00text"}, {"playerlimit": "-1"}} {
		if _, err = parsed.patch(change); err == nil {
			t.Fatalf("unsafe change accepted: %v", change)
		}
	}
	same, err := parsed.patch(map[string]string{"servername": "Literal 世界 😀"})
	if err != nil || !bytes.Equal(same, mindustryTestFixture(t)) {
		t.Fatal("idempotent edit changed bytes")
	}
}

func TestMindustryNativeMalformedRefusal(t *testing.T) {
	valid := mindustryTestFixture(t)
	cases := [][]byte{nil, {0, 0, 0, 0}, append(append([]byte{}, valid...), 0), valid[:len(valid)-1], mindustryTestData(mindustryTestRow(t, "servername", 4, []byte{0, 1, 0xff})), mindustryTestData(mindustryTestRow(t, "autoPause", 0, []byte{2})), mindustryTestData(mindustryTestRow(t, "playerlimit", 4, mindustryTestUTF(t, "wrong"))), mindustryTestData(mindustryTestRow(t, "binary", 5, []byte{255, 255, 255, 255})), mindustryTestData(mindustryTestRow(t, "unknown", 6, []byte{})), mindustryTestData(mindustryTestRow(t, "servername", 4, mindustryTestUTF(t, "a")), mindustryTestRow(t, "ServerName", 4, mindustryTestUTF(t, "b")))}
	for i, data := range cases {
		if _, err := parseMindustrySettings(data); err == nil {
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
	parsed, err := parseMindustrySettings(compressed)
	if err != nil {
		t.Fatal(err)
	}
	same, err := parsed.patch(map[string]string{"autoPause": "true"})
	if err != nil || !bytes.Equal(same, compressed) {
		t.Fatal("idempotent compressed data changed")
	}
	updated, err := parsed.patch(map[string]string{"autoPause": "false"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := parseMindustrySettings(updated)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range again.fields {
		if f.key == "autoPause" && f.value != "false" {
			t.Fatal("compressed edit lost")
		}
	}
	for _, text := range []string{"literal", "\x00", "世界😀"} {
		raw := mindustryTestUTF(t, text)
		offset := 0
		got, err := mindustryUTF(raw, &offset)
		if err != nil || got != text || offset != len(raw) {
			t.Fatal("modified UTF roundtrip failed")
		}
	}
	if _, err := parseMindustrySettings(append(append([]byte{}, compressed...), 0)); err == nil {
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
	parsed, err := parseMindustrySettings(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range parsed.fields {
		if f.key == "startCommands" && (!f.secret || f.kind != "readonly") {
			t.Fatal("startup command credentials exposed")
		}
		if f.key == "autoUpdate" && f.kind != "boolean" {
			t.Fatal("managed flag lost its native type")
		}
		if _, err := parsed.patch(map[string]string{f.key: f.value}); err == nil {
			t.Fatalf("advanced/managed edit accepted: %s", f.key)
		}
	}
	if mindustrySettingManaged("socket") || !mindustrySettingManaged("autoUpdate") {
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
	if mindustrySettingsDocument(egg, mindustrySettingsPath) {
		t.Fatal("old overwriting launcher received native editor authority")
	}
	egg["startup"] = "exec bash .voltra/mindustry-native-start.sh"
	if !mindustrySettingsDocument(egg, mindustrySettingsPath) || !mindustrySettingsManaged(egg, mindustrySettingsPath, "port") {
		t.Fatal("new exact native document not recognized")
	}
	if mindustrySettingsDocument(egg, "/other/settings.bin") || mindustrySettingsManaged(egg, mindustrySettingsPath, "servername") {
		t.Fatal("unrelated document or gameplay value became managed")
	}
}
