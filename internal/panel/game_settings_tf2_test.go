package panel

import (
	"bytes"
	"testing"
)

// Synthetic grammar fixture. Only mp_timelimit=23 is transcribed from
// artifacts/tf2-live-acceptance.json restored.operator_timelimit, not a native dump.
func TestTF2SettingsPreserve(t *testing.T) {
	input := []byte("// operator\r\n  mp_timelimit \"23\" // minutes\r\nrcon_password \"fixture-private\"\r\nhostname \"operator\"\r\n")
	p, err := parseTF2Settings(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 1 || p.fields[0].kind != "number" {
		t.Fatalf("fields: %+v", p.fields)
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(same, input) {
		t.Fatal("no-op changed bytes")
	}
	next, err := p.patch(map[string]string{"mp_timelimit": "24.5"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(next, bytes.Replace(input, []byte("\"23\""), []byte("\"24.5\""), 1)) {
		t.Fatal("non-value bytes changed")
	}
	for _, key := range []string{"hostname", "sv_password", "rcon_password", "maxplayers", "tv_port", "missing", "MP_TIMELIMIT"} {
		if _, err := p.patch(map[string]string{key: "1"}); err == nil {
			t.Errorf("accepted %s", key)
		}
	}
	empty, _ := parseTF2Settings([]byte("// no defaults\n"))
	if _, err := empty.patch(map[string]string{"mp_timelimit": "1"}); err == nil {
		t.Fatal("inserted missing default")
	}
}

func TestTF2SettingsRefusals(t *testing.T) {
	for _, tail := range []string{"mp_timelimit 1", "MP_TIMELIMIT 1", "mp_timelimit 1 extra", "exec later.cfg", "execifexists later.cfg", "alias x quit", "script_execute x", "unknown_cvar 9", "\"mp_timelimit\" 2", "echo x; quit", "/* block */", "mp_timelimit \"unterminated"} {
		input := []byte("mp_timelimit 23\n" + tail + "\n")
		p, err := parseTF2Settings(input)
		if err != nil {
			continue
		}
		if _, err := p.patch(map[string]string{"mp_timelimit": "24"}); err == nil {
			t.Errorf("accepted %q", tail)
		}
		same, err := p.patch(nil)
		if err != nil || !bytes.Equal(same, input) {
			t.Fatal("refusal changed bytes")
		}
	}
	p, _ := parseTF2Settings([]byte("mp_timelimit 23\n"))
	for _, value := range []string{"-1", "NaN", "Inf", "1e3", "1;quit", "1\nquit", "1\rquit", "1\u2028quit", "1\\", "\"1\"", "999999999999999999999999999999999999999999999999999999999"} {
		if _, err := p.patch(map[string]string{"mp_timelimit": value}); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
	for _, input := range [][]byte{{0xff}, []byte("\xef\xbb\xbfmp_timelimit 23\n"), []byte("mp_timelimit 23\rx")} {
		if _, err := parseTF2Settings(input); err == nil {
			t.Fatal("invalid encoding/line accepted")
		}
	}
}
