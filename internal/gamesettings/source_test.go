package gamesettings

import (
	"strings"
	"testing"
)

func TestSourceSettingsRoundTrip(t *testing.T) {
	input := "// keep\r\n  sv_cheats \"0\" // bool\r\nmp_friendlyfire 0\r\nmp_autoteambalance 1\r\nmp_limitteams 2\r\nmp_teamname_1 \"Before // literal\" // name\r\nunknown_cvar 99\r\nexec operator.cfg\r\nrcon_password \"private-fixture\"\r\n"
	p, err := parseSourceSettings([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Fields) != 5 {
		t.Fatalf("fields: %+v", p.Fields)
	}
	for _, f := range p.Fields {
		if strings.Contains(f.Value, "private-fixture") || strings.Contains(f.Key, "rcon") {
			t.Fatal("secret exposed")
		}
	}
	if p.Fields[0].Kind != "boolean" || p.Fields[3].Kind != "number" {
		t.Fatal("typed fields missing")
	}
	same, err := p.Patch(nil)
	if err != nil || string(same) != input {
		t.Fatal("no-op changed bytes")
	}
	next, err := p.Patch(map[string]string{"sv_cheats": "1", "mp_limitteams": "3", "mp_teamname_1": "After // literal"})
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Replace(input, "sv_cheats \"0\"", "sv_cheats \"1\"", 1)
	expected = strings.Replace(expected, "mp_limitteams 2", "mp_limitteams 3", 1)
	expected = strings.Replace(expected, "Before // literal", "After // literal", 1)
	if string(next) != expected {
		t.Fatalf("unexpected output: %q", next)
	}
	reparsed, err := parseSourceSettings(next)
	if err != nil || reparsed.Fields[4].Value != "After // literal" {
		t.Fatal("round trip failed")
	}
	again, _ := p.Patch(nil)
	if string(again) != input {
		t.Fatal("patch mutated source")
	}
}

func TestSourceSettingsFailClosed(t *testing.T) {
	for _, tail := range []string{
		"sv_cheats 1", "SV_CHEATS 1", "sv_cheats 1 extra", "sv_cheats 1; quit",
		"mp_limitteams 2; sv_cheats 1", "alias test {", "/* block\nsv_cheats 1\n*/", "mp_teamname_1 \"unterminated", "mp_teamname_1 \"escaped\\\"value\"",
	} {
		t.Run(tail, func(t *testing.T) {
			input := "sv_cheats 0\n" + tail + "\n"
			p, err := parseSourceSettings([]byte(input))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = p.Patch(map[string]string{"sv_cheats": "1"}); err == nil {
				t.Fatal("ambiguous document writable")
			}
			same, _ := p.Patch(nil)
			if string(same) != input {
				t.Fatal("unsupported syntax changed")
			}
		})
	}
}

func TestSourceSettingsInjectionAndHiddenKeys(t *testing.T) {
	p, _ := parseSourceSettings([]byte("mp_teamname_1 \"Team\"\nsv_cheats 0\nmp_limitteams 2\n"))
	for _, value := range []string{"x; quit", "x\nquit", "x\rquit", "x\";quit", "x\\", "x\x00quit", "x\tquit", "x\u2028quit"} {
		if _, err := p.Patch(map[string]string{"mp_teamname_1": value}); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
	for _, key := range []string{"exec", "rcon_password", "sv_password", "hostname", "unknown", "SV_CHEATS"} {
		if _, err := p.Patch(map[string]string{key: "1"}); err == nil {
			t.Errorf("accepted key %q", key)
		}
	}
	for _, value := range []string{"true", "2", "0;quit"} {
		if _, err := p.Patch(map[string]string{"sv_cheats": value}); err == nil {
			t.Errorf("boolean accepted %q", value)
		}
	}
	for _, value := range []string{"NaN", "Inf", "1 extra", "1;quit"} {
		if _, err := p.Patch(map[string]string{"mp_limitteams": value}); err == nil {
			t.Errorf("number accepted %q", value)
		}
	}
}

func TestSourceSettingsQuotedSemicolonPreserved(t *testing.T) {
	input := "mp_teamname_1 \"Team; operator value\"\nsv_cheats 0 // ; harmless comment\n"
	p, _ := parseSourceSettings([]byte(input))
	if p.Fields[0].Kind != "readonly" {
		t.Fatal("unsupported value writable")
	}
	next, err := p.Patch(map[string]string{"sv_cheats": "1"})
	if err != nil {
		t.Fatal(err)
	}
	if string(next) != strings.Replace(input, "sv_cheats 0", "sv_cheats 1", 1) {
		t.Fatal("quoted semicolon changed")
	}
}
