package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func riskAuthority() riskOfRainSettingsAuthority {
	return riskOfRainSettingsAuthority{riskOfRainSettingsPath, true, true, true}
}

func TestRiskOfRainSpanPreservation(t *testing.T) {
	input := []byte("\xef\xbb\xbf// operator\r\n sv_password \"private-fixture\"; // keep\r\nsv_hostname \"Old; name\"; steam_server_heartbeat_enabled 1;\r\nsv_maxplayers 99999; sv_port 27015; steam_server_query_port 27016; steam_server_steam_port 0;")
	p, err := parseRiskOfRainSettings(input, riskAuthority())
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range p.fields {
		if f.key == "sv_password" && (!f.secret || f.value != "") {
			t.Fatal("plaintext exposed")
		}
	}
	got, err := p.patch(map[string]string{"sv_hostname": "New name", "steam_server_heartbeat_enabled": "0"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(input, []byte("Old; name"), []byte("New name"), 1)
	want = bytes.Replace(want, []byte("enabled 1"), []byte("enabled 0"), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("unrelated bytes changed")
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(same, input) {
		t.Fatal("no-op changed bytes")
	}
	input[0] = 0 // caller mutation must not affect the captured snapshot
	same, _ = p.patch(nil)
	if same[0] != 0xef {
		t.Fatal("snapshot aliases caller")
	}
}

func TestRiskOfRainRefusesAmbiguousOrExecutableCFG(t *testing.T) {
	for _, s := range []string{
		"sv_hostname \"a\"; SV_HOSTNAME \"b\";", "sv_hostname \"a\"; sv_hostname \"b\";",
		"sv_hostname \"a\"; exec server_pregame;", "alias foo \"sv_hostname x\";", "host;", "echo \"hello\";", "unknown_scalar 1;",
		"sv_hostname \"unterminated", "sv_hostname \"a\"; /* comment */", "steam_server_heartbeat_enabled true;",
		"sv_hostname a;", "sv_hostname \"a\"\x00", "\xff",
	} {
		t.Run(s, func(t *testing.T) {
			original := []byte(s)
			before := bytes.Clone(original)
			_, err := parseRiskOfRainSettings(original, riskAuthority())
			if err == nil {
				t.Fatal("accepted unsafe CFG")
			}
			if !bytes.Equal(original, before) {
				t.Fatal("mutated refusal")
			}
		})
	}
}

func TestRiskOfRainPatchRefusalAndSecrets(t *testing.T) {
	p, err := parseRiskOfRainSettings([]byte("sv_password \"fixture\"; sv_hostname \"name\"; sv_port 27015; sv_maxplayers 4; steam_server_heartbeat_enabled 1;"), riskAuthority())
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"sv_port": "27016"}, {"sv_maxplayers": "8"}, {"exec": "x"}, {"SV_HOSTNAME": "x"}, {"missing": "x"},
		{"sv_hostname": "x\nexec a"}, {"steam_server_heartbeat_enabled": "2"},
		{"sv_hostname": "valid", "sv_port": "27016"},
	} {
		if b, e := p.patch(changes); e == nil || b != nil {
			t.Fatal("invalid patch accepted")
		}
	}
	b, e := p.patch(map[string]string{"sv_password": ""})
	if e != nil || !strings.Contains(string(b), "sv_password \"\";") {
		t.Fatal("explicit password clear failed")
	}
}

func TestRiskOfRainRequiresAuthority(t *testing.T) {
	for i := 0; i < 5; i++ {
		a := riskAuthority()
		switch i {
		case 0:
			a.ActivePath = "server.cfg"
		case 1:
			a.StartupReviewed = false
		case 2:
			a.ScriptsReviewed = false
		case 3:
			a.NativeSchemaReviewed = false
		case 4:
			a = riskOfRainSettingsAuthority{}
		}
		if _, e := parseRiskOfRainSettings([]byte("sv_hostname \"x\";"), a); e == nil {
			t.Fatal("missing authority accepted")
		}
	}
}

func TestRiskOfRainCanonicalSeedFixture(t *testing.T) {
	data, err := os.ReadFile("../../artifacts/game-parity-20261029/riskofrain-settings/canonical-emitted.fixture.cfg")
	if err != nil {
		t.Fatal(err)
	}
	before := bytes.Clone(data)
	p, err := parseRiskOfRainSettings(data, riskAuthority())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range p.fields {
		if f.key == "sv_hostname" {
			found = true
			if f.value != `"Risk of Rain 2 Dedicated Server"` {
				t.Fatalf("hostname decoded incorrectly: %q", f.value)
			}
		}
	}
	if !found {
		t.Fatal("hostname missing")
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(same, before) {
		t.Fatal("canonical bytes changed")
	}
	changed, err := p.patch(map[string]string{"sv_hostname": `new "name" \ path; // data`})
	if err != nil {
		t.Fatal(err)
	}
	q, err := parseRiskOfRainSettings(changed, riskAuthority())
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range q.fields {
		if f.key == "sv_hostname" && f.value != `new "name" \ path; // data` {
			t.Fatal("round trip failed")
		}
	}
}

func TestRiskOfRainEscapesAndInjection(t *testing.T) {
	for _, input := range []string{
		`sv_hostname "bad\q";`, `sv_hostname "bad\n";`, `sv_hostname "bad\";`,
		`sv_hostname "x";exec server;`, `sv_hostname "x" | host;`,
		`sv_hostname "x";alias x "host";`, `SV_HOSTNAME "x";`,
		`sv_hostname "x";sv_hostname "y";`, `sv_hostname "x";SV_HOSTNAME "y";`,
		`sv_hostname "x" host;`, `sv_hostname "x"\;host;`,
	} {
		if _, err := parseRiskOfRainSettings([]byte(input), riskAuthority()); err == nil {
			t.Fatalf("accepted %q", input)
		}
	}
	for _, value := range []string{`a"b`, `a\b`, `a\"b`, `;exec evil;//`, `{} 'x'`, "Unicode \u96e8"} {
		input := []byte("// untouched\r\nsv_hostname \"old\"; // tail\r\nsv_password \"private\";")
		p, err := parseRiskOfRainSettings(input, riskAuthority())
		if err != nil {
			t.Fatal(err)
		}
		changed, err := p.patch(map[string]string{"sv_hostname": value})
		if err != nil {
			t.Fatal(err)
		}
		q, err := parseRiskOfRainSettings(changed, riskAuthority())
		if err != nil {
			t.Fatal(err)
		}
		if q.fields[0].value != value || q.fields[1].value != "" || !q.fields[1].secret {
			t.Fatal("roundtrip or masking failed")
		}
		if !bytes.HasSuffix(changed, []byte("; // tail\r\nsv_password \"private\";")) {
			t.Fatal("unrelated bytes changed")
		}
	}
}
