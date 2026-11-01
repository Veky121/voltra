package panel

import (
	"strings"
	"testing"
)

func TestIW4xSettingsPreservesBytes(t *testing.T) {
	input := "// independent synthetic fixture\r\n  SeTa SV_MOTD \"Before // literal\" // retain\r\nset g_allowVote \"0\"\r\nsets sv_voice 1\r\nset unknown 42\r\nset rcon_password \"fixture-secret\"\r\nset net_port 28960\r\nset sv_hostname \"Managed\"\r\nset g_password \"fixture-secret\"\r\nset sv_maprotation \"gametype war map mp_rust\""
	p, err := parseIW4xSettings([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 3 {
		t.Fatalf("field count %d", len(p.fields))
	}
	same, err := p.patch(nil)
	if err != nil || string(same) != input {
		t.Fatal("no-op changed bytes")
	}
	next, err := p.patch(map[string]string{"sv_motd": "After // literal", "g_allowvote": "1", "sv_voice": "0"})
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(input, "Before // literal", "After // literal", 1)
	want = strings.Replace(want, `g_allowVote "0"`, `g_allowVote "1"`, 1)
	want = strings.Replace(want, "sv_voice 1", "sv_voice 0", 1)
	if string(next) != want {
		t.Fatal("span preservation failed")
	}
	again, _ := p.patch(nil)
	if string(again) != input {
		t.Fatal("mutated original")
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "secret") {
			t.Fatal("secret exposed")
		}
	}
	reparsed, _ := parseIW4xSettings(next)
	if reparsed.fields[0].value != "After // literal" {
		t.Fatal("readback failed")
	}
}

func TestIW4xSettingsRefusal(t *testing.T) {
	for _, tail := range []string{
		"set G_ALLOWVOTE 1", "g_allowVote 1", "set g_allowvote 1 extra", "set g_allowvote=1",
		"exec other.cfg", "ExEc other.cfg", "vstr rotation", "alias foo bar", "wait 1", "map_rotate",
		"set unknown 1; quit", "set unknown \\", "/* block\nset g_allowvote 1\n*/",
		"set unknown \"unterminated", "set unknown \"a\\\"b\"", "set unknown 1\u2028quit",
	} {
		t.Run(tail, func(t *testing.T) {
			input := "set g_allowvote 0\n" + tail + "\n"
			p, err := parseIW4xSettings([]byte(input))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := p.patch(map[string]string{"g_allowvote": "1"}); err == nil {
				t.Fatal("ambiguous config writable")
			}
			same, err := p.patch(nil)
			if err != nil || string(same) != input {
				t.Fatal("refusal changed bytes")
			}
		})
	}
}

func TestIW4xSettingsInjectionAndHidden(t *testing.T) {
	p, _ := parseIW4xSettings([]byte("set sv_motd \"hello\"\nset g_allowvote 0\n"))
	for _, v := range []string{"x;quit", "x\"quit", "x\\quit", "x\nquit", "x\rquit", "x\tquit", "x\x00quit", "x\x7fquit", "x\u0085quit", "x\u2028quit", "x\u2029quit", string([]byte{255})} {
		if _, e := p.patch(map[string]string{"sv_motd": v}); e == nil {
			t.Errorf("accepted injection %q", v)
		}
	}
	for _, k := range []string{"sv_hostname", "g_password", "rcon_password", "net_port", "fs_game", "exec", "sv_maprotation", "SV_MOTD", "missing"} {
		if _, e := p.patch(map[string]string{k: "1"}); e == nil {
			t.Errorf("accepted hidden key %s", k)
		}
	}
	if _, e := p.patch(map[string]string{"g_allowvote": "2"}); e == nil {
		t.Fatal("invalid boolean")
	}
	if _, e := p.patch(map[string]string{"sv_motd": strings.Repeat("x", 257)}); e == nil {
		t.Fatal("text too long")
	}
	absent, _ := parseIW4xSettings([]byte("// set g_allowvote 0\nset unknown 1\n"))
	if len(absent.fields) != 0 {
		t.Fatal("invented defaults")
	}
	if _, e := absent.patch(map[string]string{"g_allowvote": "1"}); e == nil {
		t.Fatal("inserted absent key")
	}
}
