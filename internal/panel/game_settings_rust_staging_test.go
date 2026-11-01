package panel

import (
	"strings"
	"testing"
)

func TestRustStagingTagsPreserve(t *testing.T) {
	input := "// fixture\r\nserver.tags \"weekly,vanilla,EU\" // keep\r\nrcon.password \"fixture-secret\"\r\nserver.seed 9007199254740993\r\nunknown.precision 0.1234567890123456789"
	p, err := parseRustStagingSettings([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 1 || p.fields[0].key != "server.tags" {
		t.Fatal("protected values exposed")
	}
	next, err := p.patch(map[string]string{"server.tags": "monthly,roleplay,NA"})
	if err != nil {
		t.Fatal(err)
	}
	if string(next) != strings.Replace(input, "weekly,vanilla,EU", "monthly,roleplay,NA", 1) {
		t.Fatal("unrelated bytes changed")
	}
	for _, key := range []string{"rcon.password", "server.seed", "server.identity", "server.port", "server.hostname", "server_tags"} {
		if _, err := p.patch(map[string]string{key: "x"}); err == nil {
			t.Fatal("protected key accepted", key)
		}
	}
	for _, value := range []string{"weekly,monthly", "EU,NA", "hardcore,softcore", "unknown", "weekly;quit", "weekly\nquit", "weekly\\x", "weekly\"", "weekly,weekly"} {
		if _, err := p.patch(map[string]string{"server.tags": value}); err == nil {
			t.Fatal("unsafe tags accepted", value)
		}
	}
}

func TestRustStagingAmbiguityRefused(t *testing.T) {
	for _, tail := range []string{"server.tags monthly", "SERVER.TAGS monthly", "server_tags monthly", "exec other.cfg", "server.tags \"unterminated", "quit", "unknown.value 1;quit", "unknown.value \"a\\b\"", "unknown.value \"\u2028\"", "unknown.value \"\xff\""} {
		input := []byte("server.tags weekly\n" + tail)
		p, err := parseRustStagingSettings(input)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := p.patch(map[string]string{"server.tags": "monthly"}); err == nil {
			t.Fatal("ambiguous document accepted", tail)
		}
		next, err := p.patch(nil)
		if err != nil || string(next) != string(input) {
			t.Fatal("no-op did not preserve bytes")
		}
	}
	p, _ := parseRustStagingSettings([]byte("server.seed 42\n"))
	if _, err := p.patch(map[string]string{"server.tags": "weekly"}); err == nil {
		t.Fatal("missing setting invented")
	}
}

func TestRustStagingCurrentProfileContract(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if entry.Path != rustStagingSettingsRecipe {
			continue
		}
		if entry.Profile != "rust-native-v1" || entry.RequiredPorts != 4 {
			t.Fatal("review launcher authority before integration")
		}
		_, variables, err := parseEggDocument(entry.Egg)
		if err != nil {
			t.Fatal(err)
		}
		env := M{}
		for _, v := range variables {
			env[str(v["env_variable"])] = v["default_value"]
		}
		if env["SRCDS_BETAID"] != "staging" || env["SRCDS_APPID"] != "258550" {
			t.Fatal("staging acquisition contract changed")
		}
		if !strings.Contains(str(entry.Egg["startup"]), ".voltra/rust_runtime.py") {
			t.Fatal("managed startup changed")
		}
		return
	}
	t.Fatal("exact staging recipe absent")
}
