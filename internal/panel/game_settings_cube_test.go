package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestCubeSettingsSwitchPreservation(t *testing.T) {
	source := []byte("\ufeff// native\r\n-Iconfig/campaign-info\r\n -l2 // native true\r\n-kA15\r\n-kB20\r\n")
	p, err := parseCubeGameSettings("assaultcube", source)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 3 || p.fields[0].value != "1" || p.fields[0].kind != "boolean" || p.fields[1].value != "0" {
		t.Fatal("native semantic values not typed correctly")
	}
	same, err := p.patch(map[string]string{"log-game-status": "1", "afk-limit": "0"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("no-op changed source bytes")
	}
	updated, err := p.patch(map[string]string{"log-game-status": "0", "afk-limit": "60", "ban-duration": "30"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(source, []byte("-l2"), []byte("-l0"), 1)
	want = bytes.Replace(want, []byte("-kA15"), []byte("-kA60"), 1)
	want = bytes.Replace(want, []byte("-kB20"), []byte("-kB30"), 1)
	if !bytes.Equal(updated, want) {
		t.Fatal("unrelated command/comment bytes changed")
	}
}

func TestCubeSettingsCubeScriptPreservation(t *testing.T) {
	source := []byte("// native\r\nserverdesc \"publicserver 2; quoted only\"\r\npublicserver 0 // policy\r\nffamaps [\r\n publicserver\r\n complex\r\n]\r\nrestrictpausegame \"1\"\r\n")
	p, err := parseCubeGameSettings("sauerbraten", source)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range p.fields {
		if f.kind == "readonly" {
			t.Fatal("publisher data block confused with executable control")
		}
	}
	updated, err := p.patch(map[string]string{"public-server-mode": "1", "restrict-pause": "0", "restrict-game-speed": "0"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(source, []byte("publicserver 0 // policy"), []byte("publicserver 1 // policy"), 1)
	want = bytes.Replace(want, []byte("restrictpausegame \"1\""), []byte("restrictpausegame \"0\""), 1)
	want = append(want, []byte("restrictgamespeed 0\r\n")...)
	if !bytes.Equal(updated, want) {
		t.Fatalf("unrelated CubeScript bytes changed: %s", updated)
	}
}

func TestCubeSettingsMissingControlsAndBounds(t *testing.T) {
	for _, kind := range []string{"assaultcube", "sauerbraten"} {
		p, err := parseCubeGameSettings(kind, []byte("// keep without newline"))
		if err != nil {
			t.Fatal(err)
		}
		if len(p.fields) != 3 {
			t.Fatal("known native defaults absent")
		}
		var change map[string]string
		if kind == "assaultcube" {
			change = map[string]string{"log-game-status": "0", "afk-limit": "30", "ban-duration": "0"}
		} else {
			change = map[string]string{"public-server-mode": "2", "restrict-pause": "0", "restrict-game-speed": "0"}
		}
		updated, err := p.patch(change)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.HasPrefix(updated, []byte("// keep without newline\n")) {
			t.Fatal("existing source prefix lost")
		}
		if _, err = parseCubeGameSettings(kind, updated); err != nil {
			t.Fatal(err)
		}
		for _, bad := range []map[string]string{{"serverport": "1"}, {"afk-limit": "29"}, {"ban-duration": "35792"}, {"public-server-mode": "3"}, {"restrict-pause": "true"}, {"log-game-status": "1\n-Cbad"}} {
			if _, err = p.patch(bad); err == nil {
				t.Fatalf("unsafe %s edit accepted: %v", kind, bad)
			}
		}
	}
}

func TestCubeSettingsDynamicAndDuplicateFences(t *testing.T) {
	for _, tc := range []struct{ kind, source string }{
		{"assaultcube", "-Cother-options.txt\n-l1\n"},
		{"sauerbraten", "exec other.cfg\npublicserver 0\n"},
		{"sauerbraten", "if $foo [publicserver 2]\n"},
		{"sauerbraten", "publicserver 0; restrictpausegame 0\n"},
	} {
		p, err := parseCubeGameSettings(tc.kind, []byte(tc.source))
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range p.fields {
			if f.kind != "readonly" {
				t.Fatal("dynamic file exposed editable control")
			}
		}
		if _, err = p.patch(map[string]string{p.fields[0].key: "0"}); err == nil {
			t.Fatal("dynamic patch accepted")
		}
	}
	for _, tc := range []struct{ kind, source, key string }{{"assaultcube", "-l1\n-l0\n", "log-game-status"}, {"sauerbraten", "publicserver 0\npublicserver 1\n", "public-server-mode"}} {
		p, err := parseCubeGameSettings(tc.kind, []byte(tc.source))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.patch(map[string]string{tc.key: "1"}); err == nil {
			t.Fatal("duplicate patch accepted")
		}
	}
	for _, data := range [][]byte{[]byte{0xff}, []byte("x\x00y"), []byte(strings.Repeat("x", 1024*1024+1))} {
		if _, err := parseCubeGameSettings("assaultcube", data); err == nil {
			t.Fatal("unsafe document accepted")
		}
	}
}

func TestCubeSettingsNativeCapture(t *testing.T) {
	p := os.Getenv("CUBE_NATIVE_CAPTURE")
	if p == "" {
		t.Skip("Private native capture not supplied")
	}
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseCubeGameSettings("assaultcube", data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.fields) != 3 {
		t.Fatal("Expected all three native controls")
	}
	for _, f := range parsed.fields {
		if f.kind == "readonly" {
			t.Fatal("Actual native options unexpectedly read-only")
		}
	}
	edited, err := parsed.patch(map[string]string{"log-game-status": "0", "afk-limit": "60", "ban-duration": "30"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(edited, data) || !bytes.Contains(edited, []byte("-kA60")) || !bytes.Contains(edited, []byte("-kB30")) {
		t.Fatal("Native operator contents changed or controls not appended")
	}
}

func TestCubeSettingsNativeIntegerOverflowFence(t *testing.T) {
	for _, tc := range []struct{ source, key string }{{"-l4294967296\n", "log-game-status"}, {"-kA-4294967236\n", "afk-limit"}} {
		parsed, err := parseCubeGameSettings("assaultcube", []byte(tc.source))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, field := range parsed.fields {
			if field.key == tc.key {
				found = true
				if field.kind != "readonly" {
					t.Fatalf("C int overflow %q presented as writable semantic %q", tc.source, field.value)
				}
			}
		}
		if !found {
			t.Fatal("Expected native control not found")
		}
		if _, err := parsed.patch(map[string]string{tc.key: "0"}); err == nil {
			t.Fatal("Ambiguous overflow text was editable")
		}
	}
	parsed, err := parseCubeGameSettings("assaultcube", []byte("-l-2147483648\n"))
	if err != nil || parsed.fields[0].kind != "boolean" || parsed.fields[0].value != "1" {
		t.Fatal("Valid signed C int truthy value refused")
	}
}
