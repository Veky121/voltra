package panel

import (
	"strings"
	"testing"
)

// Exact default configuration emitted by ddrace-parity.py configuration(), with
// a deterministic test RCON_PASSWORD instead of the randomly generated secret.
const ddnetSeed = "# Seeded once. Edit this native file in Game settings.\nsv_name \"My DDNet server\"\nsv_map \"Tutorial\"\npassword \"\"\nsv_register 0\nsv_max_clients 64\nsv_sixup 1\nsv_test_cmds 0\nsv_rcon_password \"fixture-secret\"\n"

func TestDDNetSeedRoundTrip(t *testing.T) {
	input := ddnetSeed + "# operator\r\nexec operator.cfg\r\nadd_vote \"Map\" \"change_map Tutorial\"\r\nsv_sql_servername \"private-db\"\r\nunknown_value 7\r\nbindaddr 0.0.0.0\r\nsv_port 8303\r\nsv_input_fifo \"/private/fifo\"\r\n"
	p, err := parseDDNetSettings([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 6 {
		t.Fatalf("fields: %+v", p.fields)
	}
	for _, f := range p.fields {
		if gameSettingSecret.MatchString(f.key) || strings.Contains(f.value, "fixture-secret") || strings.Contains(f.value, "private") {
			t.Fatal("protected field exposed")
		}
	}
	same, err := p.patch(nil)
	if err != nil || string(same) != input {
		t.Fatal("no-op changed bytes")
	}
	next, err := p.patch(map[string]string{"sv_name": "New server", "sv_max_clients": "128", "sv_sixup": "0", "sv_register": "ipv4"})
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Replace(input, "My DDNet server", "New server", 1)
	expected = strings.Replace(expected, "sv_max_clients 64", "sv_max_clients 128", 1)
	expected = strings.Replace(expected, "sv_sixup 1", "sv_sixup 0", 1)
	expected = strings.Replace(expected, "sv_register 0", "sv_register \"ipv4\"", 1)
	if string(next) != expected {
		t.Fatalf("unexpected patch %q", next)
	}
	again, _ := parseDDNetSettings(next)
	if _, err := again.patch(map[string]string{"sv_max_clients": "64"}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"password", "sv_rcon_password", "sv_port", "bindaddr", "sv_input_fifo", "exec", "add_vote", "sv_sql_servername", "absent"} {
		if _, err := p.patch(map[string]string{key: "new"}); err == nil {
			t.Fatalf("protected %s writable", key)
		}
	}
}

func TestDDNetUnsafeSyntax(t *testing.T) {
	for _, suffix := range []string{"sv_name \"second\"\n", "SV_NAME second\n", "sv_name two words\n", "unknown 1; shutdown\n", "unknown \\\n", "unknown \"unclosed\n", "unknown { x }\n", "sv_name = bad\n"} {
		p, _ := parseDDNetSettings([]byte(ddnetSeed + suffix))
		if _, err := p.patch(map[string]string{"sv_name": "replacement"}); err == nil {
			t.Fatalf("ambiguous syntax accepted: %q", suffix)
		}
		same, err := p.patch(nil)
		if err != nil || string(same) != ddnetSeed+suffix {
			t.Fatal("unsafe no-op altered bytes")
		}
	}
}

func TestDDNetValidation(t *testing.T) {
	p, _ := parseDDNetSettings([]byte(ddnetSeed))
	for key, values := range map[string][]string{
		"sv_name":        {"bad\"; shutdown", "bad\nshutdown", "bad\rshutdown", "bad\\\"", "bad;shutdown", "bad\x00", "bad\u2028", strings.Repeat("Ã©", 64)},
		"sv_max_clients": {"0", "129", "1.5", "NaN", "1;shutdown"},
		"sv_sixup":       {"true", "2"}, "sv_register": {"2", "ipv4;shutdown"},
		"sv_map": {"../map", "..", "", "a/b"},
	} {
		for _, v := range values {
			if _, err := p.patch(map[string]string{key: v}); err == nil {
				t.Fatalf("accepted %s %q", key, v)
			}
		}
	}
	for key, value := range map[string]string{"sv_name": strings.Repeat("a", 127), "sv_max_clients": "1", "sv_map": "Sunny Side Up", "sv_test_cmds": "1", "sv_register": "1"} {
		if _, err := p.patch(map[string]string{key: value}); err != nil {
			t.Fatalf("valid %s rejected: %v", key, err)
		}
	}
}

func TestDDNetSpellingAndComments(t *testing.T) {
	input := "# keep \\\r\n  SV_NAME\t\"Before # literal\"  # tail\r\nsv_sixup \"0\"\r\n"
	p, _ := parseDDNetSettings([]byte(input))
	next, err := p.patch(map[string]string{"sv_name": "After # literal", "sv_sixup": "1"})
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Replace(strings.Replace(input, "Before", "After", 1), "\"0\"", "\"1\"", 1)
	if string(next) != expected {
		t.Fatalf("spelling/comments altered: %q", next)
	}
}
