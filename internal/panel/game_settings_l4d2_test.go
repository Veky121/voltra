package panel

import (
	"strings"
	"testing"
)

func TestL4D2ScalarPreservation(t *testing.T) {
	input := "// operator comment\r\n  sv_alltalk\t\"0\" // retain spacing\r\n"
	p, err := parseL4D2Settings([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 1 || p.fields[0].kind != "boolean" {
		t.Fatal("missing switch")
	}
	next, err := p.patch(map[string]string{"sv_alltalk": "1"})
	if err != nil || string(next) != strings.Replace(input, "\"0\"", "\"1\"", 1) {
		t.Fatalf("patch: %q %v", next, err)
	}
	for _, value := range []string{"2", "true", "1;quit", "1\nquit", "1\\", "1\u2028quit"} {
		if _, err := p.patch(map[string]string{"sv_alltalk": value}); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	for _, key := range []string{"rcon_password", "sv_password", "hostport", "z_difficulty", "mp_gamemode"} {
		if _, err := p.patch(map[string]string{key: "1"}); err == nil {
			t.Fatalf("accepted excluded %s", key)
		}
	}
}

func TestL4D2AmbiguityRefusesWithoutChangingBytes(t *testing.T) {
	for _, extra := range []string{"sv_alltalk 1\n", "SV_ALLTALK 1\n", "sv_alltalk=1\n", "exec autoexec.cfg\n", "unknown_scalar 17 // retain\n", "quit 1\n", "sv_alltalk 0;quit\n", "alias x quit\n", "/* block */\n"} {
		input := "// preserved\nsv_alltalk 0\n" + extra
		p, err := parseL4D2Settings([]byte(input))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := p.patch(map[string]string{"sv_alltalk": "1"}); err == nil {
			t.Fatalf("writable %q", extra)
		}
		same, err := p.patch(nil)
		if err != nil || string(same) != input {
			t.Fatal("refusal changed bytes")
		}
	}
}

func TestL4D2MalformedAndMissing(t *testing.T) {
	for _, input := range [][]byte{{0xff}, []byte("\xef\xbb\xbfsv_alltalk 0"), []byte("sv_alltalk 0\rquit"), []byte("sv_alltalk 0\x00"), []byte(strings.Repeat(" ", 65537))} {
		if _, err := parseL4D2Settings(input); err == nil {
			t.Fatal("accepted malformed document")
		}
	}
	p, err := parseL4D2Settings([]byte("// no inferred defaults\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 0 {
		t.Fatal("invented field")
	}
	if _, err := p.patch(map[string]string{"sv_alltalk": "1"}); err == nil {
		t.Fatal("inserted default")
	}
}
