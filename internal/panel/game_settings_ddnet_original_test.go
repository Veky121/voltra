package panel

import (
	"strings"
	"testing"
)

const ddnetOriginalSeed = "# Seeded once\r\nexec data/autoexec_server.cfg\r\nsv_name \"Original\"\r\nsv_map \"Sunny Side Up\"\r\npassword \"private-player\"\r\nsv_register 0\r\nsv_max_clients 64\r\nsv_sixup 1\r\nsv_test_cmds 0\r\nsv_rcon_password \"private-rcon\"\r\n"

func TestDDNetOriginalProvenPrefixRoundTrip(t *testing.T) {
	p, err := parseDDNetOriginalSettings([]byte(ddnetOriginalSeed))
	if err != nil || len(p.fields) != 6 {
		t.Fatalf("parse: %v %+v", err, p.fields)
	}
	for _, f := range p.fields {
		if f.kind == "readonly" || strings.Contains(f.value, "private") {
			t.Fatal("safe field locked or secret exposed")
		}
	}
	next, err := p.patch(map[string]string{"sv_name": "Edited", "sv_max_clients": "16"})
	expected := strings.Replace(strings.Replace(ddnetOriginalSeed, "\"Original\"", "\"Edited\"", 1), "sv_max_clients 64", "sv_max_clients 16", 1)
	if err != nil || string(next) != expected {
		t.Fatalf("prefix/unknown/secret byte preservation failed: %v", err)
	}
	again, _ := parseDDNetOriginalSettings(next)
	if _, err = again.patch(map[string]string{"sv_sixup": "0"}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"exec", "password", "sv_rcon_password", "sv_port"} {
		if _, err := p.patch(map[string]string{key: "unsafe"}); err == nil {
			t.Fatalf("protected %s writable", key)
		}
	}
}

func TestDDNetOriginalAmbiguousDocumentsReadOnly(t *testing.T) {
	for _, input := range []string{
		strings.Replace(ddnetOriginalSeed, "exec data/autoexec_server.cfg", "exec operator.cfg", 1),
		ddnetOriginalSeed + "exec data/autoexec_server.cfg\n",
		ddnetOriginalSeed + "exec operator.cfg\n",
		ddnetOriginalSeed + "sv_name duplicate\n",
		ddnetOriginalSeed + "unknown_setting 1\n",
		strings.Replace(ddnetOriginalSeed, "sv_sixup 1\r\n", "", 1),
		strings.Replace(ddnetOriginalSeed, "sv_name", "SV_NAME", 1),
		strings.Replace(ddnetOriginalSeed, "sv_map \"Sunny Side Up\"", "sv_map bad;shutdown", 1),
		strings.Replace(ddnetOriginalSeed, "exec data/autoexec_server.cfg", "exec data/autoexec_server.cfg;shutdown", 1),
		"sv_name before\n" + ddnetOriginalSeed,
	} {
		p, err := parseDDNetOriginalSettings([]byte(input))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := p.patch(map[string]string{"sv_name": "Edited"}); err == nil {
			t.Fatalf("ambiguous input writable: %q", input)
		}
		same, err := p.patch(nil)
		if err != nil || string(same) != input {
			t.Fatal("readonly no-op changed bytes")
		}
	}
}

func TestDDNetOriginalRegistrationBooleanAndIPv4(t *testing.T) {
	for _, value := range []string{"0", "1", "ipv4"} {
		input := strings.Replace(ddnetOriginalSeed, "sv_register 0", "sv_register "+value, 1)
		p, _ := parseDDNetOriginalSettings([]byte(input))
		for _, f := range p.fields {
			if f.key == "sv_register" {
				if value == "ipv4" && f.kind != "text" || value != "ipv4" && (f.kind != "boolean" || f.on != "1" || f.off != "0") {
					t.Fatalf("registration %s has wrong UI type: %+v", value, f)
				}
			}
		}
		next, err := p.patch(map[string]string{"sv_register": "1", "sv_name": "Edited"})
		if err != nil {
			t.Fatal(err)
		}
		again, _ := parseDDNetOriginalSettings(next)
		if _, err := again.patch(map[string]string{"sv_register": "0"}); err != nil {
			t.Fatal(err)
		}
		for _, bad := range []string{"1;shutdown", "2", "true", "ipv6", "1\nshutdown"} {
			if _, err := p.patch(map[string]string{"sv_register": bad}); err == nil {
				t.Fatalf("unsafe/unsupported registration accepted: %q", bad)
			}
		}
		if value != "ipv4" {
			if _, err := p.patch(map[string]string{"sv_register": "ipv4"}); err == nil {
				t.Fatal("boolean listing accepted a text-mode switch")
			}
		}
	}
}
