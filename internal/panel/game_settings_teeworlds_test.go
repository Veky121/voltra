package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestTeeworldsSettingsPreservation(t *testing.T) {
	data := []byte("# operator\r\nsv_name \"Native server\" # name\r\nsv_motd \"old\"\r\nsv_max_clients 16\r\nsv_register 0\r\nsv_port 29108\r\npassword \"private\"\r\nsv_rcon_password \"private-admin\"\r\nadd_vote \"reset\" \"restart\"\r\ntune gravity 0.25\r\n")
	p, err := parseTeeworldsSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range p.fields {
		if strings.Contains(f.key, "password") && !f.secret {
			t.Fatal("secret not marked")
		}
		if f.key == "sv_register" && (f.kind != "boolean" || f.on != "1" || f.off != "0") {
			t.Fatal("listing not native boolean")
		}
	}
	c, err := gameSettingsChanges(p.fields, M{"sv_name": "Edited server", "sv_motd": strings.Repeat("a", 899), "sv_max_clients": "64", "sv_register": true}, nil, teeworldsSettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	out, err := p.patch(c)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(string(data), "Native server", "Edited server", 1)
	want = strings.Replace(want, "\"old\"", "\""+strings.Repeat("a", 899)+"\"", 1)
	want = strings.Replace(want, "sv_max_clients 16", "sv_max_clients 64", 1)
	want = strings.Replace(want, "sv_register 0", "sv_register 1", 1)
	if !bytes.Equal(out, []byte(want)) {
		t.Fatal("unrelated bytes changed")
	}
	if _, err := p.patch(map[string]string{"sv_port": "29109"}); err == nil {
		t.Fatal("listener editable")
	}
	if _, err := p.patch(map[string]string{"sv_name": "injected; shutdown"}); err == nil {
		t.Fatal("command injection accepted")
	}
}

func TestTeeworldsSettingsBoundaries(t *testing.T) {
	for _, tc := range []struct {
		key, value string
		valid      bool
	}{{"sv_name", strings.Repeat("a", 127), true}, {"sv_name", strings.Repeat("a", 128), false}, {"sv_motd", strings.Repeat("a", 899), true}, {"sv_motd", strings.Repeat("a", 900), false}, {"sv_max_clients", "64", true}, {"sv_max_clients", "65", false}, {"sv_max_clients", "0", false}, {"sv_register", "ipv4", false}, {"password", strings.Repeat("a", 31), true}, {"password", strings.Repeat("a", 32), false}, {"sv_rcon_password", "", false}, {"sv_map", "../dm1", false}, {"sv_map", "dm1", true}, {"sv_gametype", "dm", true}, {"sv_gametype", "unknown", false}} {
		if got := teeworldsSettingValue(tc.key, tc.value); got != tc.valid {
			t.Fatalf("%s value valid=%v want=%v", tc.key, got, tc.valid)
		}
	}
}

func TestTeeworldsSettingsAmbiguity(t *testing.T) {
	for _, data := range []string{"sv_name \"one\"\nSV_NAME \"two\"\n", "sv_name \"one\"; shutdown\n", "sv_name \"one\"\nexec nested.cfg\n", "sv_name \"escaped \\\" quote\"\n"} {
		p, err := parseTeeworldsSettings([]byte(data))
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range p.fields {
			if f.kind != "readonly" {
				t.Fatal("ambiguous document editable")
			}
		}
		if _, err := p.patch(map[string]string{"sv_name": "change"}); err == nil {
			t.Fatal("ambiguous patch accepted")
		}
	}
}
