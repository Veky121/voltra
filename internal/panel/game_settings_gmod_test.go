package panel

import (
	"strings"
	"testing"
)

func TestGModSettingsPreservesAndEmits(t *testing.T) {
	input := "// operator\r\nhostname \"Private name\"\r\nrcon_password \"opaque\"\r\n  sbox_maxprops \"73\" // keep\r\nsbox_noclip 0\r\n"
	p, e := parseGModSettings([]byte(input))
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 2 {
		t.Fatal("opaque values exposed")
	}
	same, e := p.patch(nil)
	if e != nil || string(same) != input {
		t.Fatal("no-op changed bytes")
	}
	got, e := p.patch(map[string]string{"sbox_maxprops": "101", "sbox_noclip": "1"})
	if e != nil {
		t.Fatal(e)
	}
	want := strings.Replace(strings.Replace(input, "\"73\"", "\"101\"", 1), "sbox_noclip 0", "sbox_noclip 1", 1)
	if string(got) != want {
		t.Fatalf("emitted %q", got)
	}
	for k, kind := range gmodSettingKinds() {
		v := "1"
		if kind == "number" {
			v = "-1"
		}
		p, _ := parseGModSettings([]byte(k + " 0\n"))
		if _, e := p.patch(map[string]string{k: v}); e != nil {
			t.Fatalf("%s: %v", k, e)
		}
	}
}
func TestGModSettingsRefusal(t *testing.T) {
	for _, tail := range []string{"exec other.cfg", "alias sbox_maxprops quit", "sbox_maxprops 2", "SBOX_MAXPROPS 2", "sbox_noclip 0;quit", "lua_run x", "unknown 2", "/* block */", "sbox_noclip \"unterminated", "sbox_noclip 0\\", "sbox_noclip 0\rquit"} {
		input := "sbox_maxprops 73\n" + tail + "\n"
		p, e := parseGModSettings([]byte(input))
		if e != nil {
			continue
		}
		if _, e = p.patch(map[string]string{"sbox_maxprops": "74"}); e == nil {
			t.Errorf("accepted %q", tail)
		}
		got, e := p.patch(nil)
		if e != nil || string(got) != input {
			t.Fatal("refusal changed bytes")
		}
	}
	p, _ := parseGModSettings([]byte("sbox_maxprops 73\nsbox_noclip 0\n"))
	for _, v := range []string{"2;quit", "1\nquit", "NaN", "1.5", "2147483648", "-2", "1e3"} {
		if _, e := p.patch(map[string]string{"sbox_maxprops": v}); e == nil {
			t.Errorf("accepted %q", v)
		}
	}
	for _, k := range []string{"rcon_password", "sv_password", "hostname", "map", "exec", "SBOX_MAXPROPS"} {
		if _, e := p.patch(map[string]string{k: "1"}); e == nil {
			t.Errorf("accepted %s", k)
		}
	}
}
