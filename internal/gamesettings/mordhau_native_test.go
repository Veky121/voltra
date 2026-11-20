package gamesettings

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// Values are a bounded source fixture, not a native capture or schema defaults.
// Field identities follow current emitted mordhau_plan; unknown rows exercise
// preservation only and never establish support for additional controls.
func TestMordhauLinuxSettings(t *testing.T) {
	source := []byte("; operator\r\n[" + strings.TrimSuffix(MordhauLinuxSession, "/") + "]\r\nServerName=Before\r\nServerPassword=private\r\nAdminPassword=admin\r\nMaxSlots=16\r\n+Mods=1\r\n+Mods=2\r\nRconPassword=hidden\r\nPrecision=9007199254740993.123456789\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=48\r\n")
	p, err := parseMordhauLinuxSettings(MordhauLinuxSettingsPath, source)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range p.Fields {
		kind, secret := mordhauLinuxSetting(f.Key)
		if kind == "" && f.Kind != "readonly" {
			t.Fatalf("unknown editable: %s", f.Key)
		}
		if secret && !f.Secret {
			t.Fatal("unmasked secret")
		}
		if strings.HasSuffix(f.Key, "RconPassword") && (f.Value != "" || !f.Secret) {
			t.Fatal("unreviewed secret exposed")
		}
	}
	got, err := p.Patch(map[string]string{MordhauLinuxSession + "ServerName": "After"})
	if err != nil || !bytes.Equal(got, bytes.Replace(source, []byte("Before"), []byte("After"), 1)) {
		t.Fatalf("span preservation: %s %v", got, err)
	}
	for key, values := range map[string][]string{
		MordhauLinuxSession + "MaxSlots":        {"0", "61", "1.5", "1e1", "+2", "9007199254740993"},
		MordhauLinuxSession + "ServerName":      {"bad\nrow", "bad\x00row"},
		MordhauLinuxSession + "RconPassword":    {"replace"},
		MordhauLinuxSession + "maxslots":        {"20"},
		"/Script/Engine.GameSession/MaxPlayers": {"20"},
	} {
		for _, v := range values {
			if _, e := p.Patch(map[string]string{key: v}); e == nil {
				t.Fatalf("accepted %s=%q", key, v)
			}
		}
	}
	for _, v := range []string{"1", "60", "016"} {
		if _, e := p.Patch(map[string]string{MordhauLinuxSession + "MaxSlots": v}); e != nil {
			t.Fatal(e)
		}
	}
	got, err = p.Patch(nil)
	if err != nil || !bytes.Equal(got, source) {
		t.Fatal("refusal/no-op mutated source")
	}
}

func TestMordhauLinuxAliases(t *testing.T) {
	for _, tail := range []string{"ServerPassword=one\nserverpassword=two\n", "ServerPassword=one\n[/script/mordhau.mordhaugamesession]\nSERVERPASSWORD=two\n"} {
		p, e := parseMordhauLinuxSettings(MordhauLinuxSettingsPath, []byte("[/Script/Mordhau.MordhauGameSession]\n"+tail))
		if e != nil {
			t.Fatal(e)
		}
		for _, f := range p.Fields {
			if f.Kind != "readonly" || f.Value != "" || !f.Secret {
				t.Fatalf("ambiguous secret: %+v", f)
			}
			if _, e := p.Patch(map[string]string{f.Key: "new"}); e == nil {
				t.Fatal("alias writable")
			}
		}
	}
	p, e := parseMordhauLinuxSettings(MordhauLinuxSettingsPath, []byte("[/script/mordhau.mordhaugamesession]\nmaxslots=16\n"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.Patch(map[string]string{"/script/mordhau.mordhaugamesession/maxslots": "20"}); e != nil {
		t.Fatal(e)
	}
	if mordhauLinuxSettingsDocument("mordhau/egg-mordhau-wine.json", MordhauLinuxSettingsPath) {
		t.Fatal("Wine admitted")
	}
	if _, e = parseMordhauLinuxSettings("/Mordhau/Saved/Config/WindowsServer/Game.ini", nil); e == nil {
		t.Fatal("inactive file admitted")
	}
}

func TestMordhauLinuxCurrentEmittedContract(t *testing.T) {
	b, e := os.ReadFile("../panel/game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	// Canonical emission uses JSON escapes; check both current emitted contract
	// and the current source, without importing or executing Python/runtime.
	for _, token := range []string{"def mordhau_plan(", "effective.get(key,keys[key])", "missing={key:value", "'-MaxSlots='+mapping['MaxSlots']"} {
		if !bytes.Contains(b, []byte(token)) {
			t.Fatalf("emitted contract changed: %s", token)
		}
	}
}

func TestMordhauLinuxAdmission(t *testing.T) {
	admit := func(startup string, q int, ports []int) bool {
		return mordhauLinuxSettingsAdmission(MordhauLinuxSettingsRecipe, MordhauLinuxSettingsPath, startup, mordhauLinuxSettingsStartup, 28002, q, 28004, ports)
	}
	if !admit(mordhauLinuxSettingsStartup, 28003, []int{28002, 28003, 28004}) {
		t.Fatal("canonical admission refused")
	}
	for _, s := range []string{"", mordhauLinuxSettingsStartup + " -GAMEINI=other", strings.ReplaceAll(mordhauLinuxSettingsStartup, "run mordhau", "run mordhau-wine")} {
		if admit(s, 28003, []int{28002, 28003, 28004}) {
			t.Fatal("alternate startup admitted")
		}
	}
	if admit(mordhauLinuxSettingsStartup, 28002, []int{28002, 28003, 28004}) || admit(mordhauLinuxSettingsStartup, 28003, []int{28002, 28004}) {
		t.Fatal("allocation fence bypassed")
	}
}
