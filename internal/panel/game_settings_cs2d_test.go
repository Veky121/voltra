package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestCS2DSettingsRoundTrip(t *testing.T) {
	// The pinned publisher archive uses CRCRLF, including these six scalars.
	source := []byte("\ufeff// native comment\r\r\nsv_name Unquoted multiword name\r\r\nsv_password private-fixture\r\r\nsv_rcon private-admin-fixture\r\r\nsv_hostport 29100\r\r\nsv_friendlyfire 0 // leave comment\r\r\nmp_timelimit 0\r\r\nmp_winlimit 0\r\r\nmp_roundlimit 0\r\r\n  mp_roundtime \"5\"\t // seconds? operator note\r\r\nmp_freezetime 0\r\r\nunknown native command arguments")
	parsed, err := parseCS2DSettings(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.fields) != 6 {
		t.Fatalf("expected six gameplay scalars, got %d", len(parsed.fields))
	}
	for _, field := range parsed.fields {
		if strings.Contains(field.value, "private") || field.key == "sv_name" || field.key == "sv_hostport" || field.kind == "readonly" {
			t.Fatal("secret/runtime field exposed or safe field refused")
		}
		if field.key == "sv_friendlyfire" && (field.kind != "boolean" || field.on != "1" || field.off != "0") {
			t.Fatal("missing friendly-fire switch metadata")
		}
	}
	same, err := parsed.patch(map[string]string{"mp_roundtime": "5"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("no-op normalized source")
	}
	updated, err := parsed.patch(map[string]string{"sv_friendlyfire": "1", "mp_roundtime": "10", "mp_timelimit": "20"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(source, []byte("sv_friendlyfire 0"), []byte("sv_friendlyfire 1"), 1)
	expected = bytes.Replace(expected, []byte(`mp_roundtime "5"`), []byte(`mp_roundtime "10"`), 1)
	expected = bytes.Replace(expected, []byte("mp_timelimit 0"), []byte("mp_timelimit 20"), 1)
	if !bytes.Equal(updated, expected) {
		t.Fatal("changed bytes outside selected values")
	}
	again, err := parseCS2DSettings(updated)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := again.patch(map[string]string{"mp_roundtime": "100", "mp_freezetime": "30", "mp_timelimit": "10000", "mp_winlimit": "1000000", "mp_roundlimit": "1000000"}); err != nil {
		t.Fatal("publisher upper bounds refused", err)
	}
}

func TestCS2DSettingsAmbiguityAndExecutableSyntax(t *testing.T) {
	for _, suffix := range []string{
		"mp_roundtime 10\n", "MP_ROUNDTIME 10\n", "mp_roundtime=10\n",
		"mp_roundtime invalid\n", "mp_roundtime 10; quit\n",
		"unknown {\n", "unknown /* block\n", "unknown \"unterminated\n",
		"unknown literal\rcommand\n", "unknown value\u2028command\n",
		"exec sys/other.cfg\n", "lua malicious()\n", "alias commands\n",
	} {
		source := []byte("mp_roundtime 5\n" + suffix)
		parsed, err := parseCS2DSettings(source)
		if err != nil {
			t.Fatal(err)
		}
		for _, field := range parsed.fields {
			if field.key == "mp_roundtime" && field.kind != "readonly" {
				t.Fatalf("ambiguous executable syntax remained editable: %q", suffix)
			}
		}
		if _, err := parsed.patch(map[string]string{"mp_roundtime": "6"}); err == nil {
			t.Fatalf("patched unsafe document %q", suffix)
		}
		same, err := parsed.patch(nil)
		if err != nil || !bytes.Equal(same, source) {
			t.Fatal("readonly source bytes changed")
		}
	}
}

func TestCS2DSettingsPatchBoundary(t *testing.T) {
	parsed, err := parseCS2DSettings([]byte("sv_friendlyfire 0\nmp_freezetime 0\nmp_roundtime 5\nmp_timelimit 0\nmp_winlimit 0\nmp_roundlimit 0\nsv_password private\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"sv_name": "new"}, {"sv_password": "private-new"}, {"sv_rcon": "private-new"},
		{"sv_hostport": "1"}, {"sv_map": "new"}, {"sv_lan": "1"}, {"sv_gamemode": "2"}, {"bot_count": "3"},
		{"sv_friendlyfire": "2"}, {"mp_freezetime": "31"}, {"mp_roundtime": "0"},
		{"mp_roundtime": "101"}, {"mp_timelimit": "10001"}, {"mp_roundlimit": "1000001"},
		{"mp_winlimit": "-1"}, {"mp_winlimit": "NaN"}, {"mp_roundtime": "1.5"},
		{"mp_roundtime": "5; quit"}, {"mp_roundtime": "5\nsv_rcon injected"},
		{"mp_roundtime": "5\u2028quit"}, {"mp_roundtime": `5"`},
		{"mp_roundtime": `5\`}, {"MP_ROUNDTIME": "5"}, {"unknown": "1"},
	} {
		if _, err := parsed.patch(changes); err == nil {
			t.Fatalf("unsafe patch accepted %#v", changes)
		}
	}
}

func TestCS2DSettingsLimits(t *testing.T) {
	for _, source := range [][]byte{
		bytes.Repeat([]byte("x"), 8*1024*1024+1),
		[]byte(strings.Repeat("\n", 100001)),
		[]byte("//" + strings.Repeat("x", 65535)),
		{'m', 'p', '_', 0xff},
	} {
		if _, err := parseCS2DSettings(source); err == nil {
			t.Fatal("parser limit not enforced")
		}
	}
	parsed, err := parseCS2DSettings([]byte("mp_roundtime 101\nmp_freezetime 0\n// quote \" ; ignored in comment\n"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parsed.patch(map[string]string{"mp_roundtime": "5"}); err == nil {
		t.Fatal("invalid native scalar became writable")
	}
	if _, err := parsed.patch(map[string]string{"mp_freezetime": "1"}); err != nil {
		t.Fatal("unrelated valid scalar refused")
	}
}
