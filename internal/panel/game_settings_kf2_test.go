package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Synthetic byte fixtures exercise the four scalar identities declared by the
// current emitted kf2_plan. They are not native captures or schema defaults.
const kf2TestGame = "; retained\r\n[Engine.AccessControl]\r\nAdminPassword=fixture-private\r\n[Engine.GameReplicationInfo]\r\nServerName=Fixture\r\n[Operator]\r\nOpaque=(Unknown=9007199254740993.123456,Password=private)\r\n+Array=one\r\n+Array=two\r\n"
const kf2TestWeb = "[IpDrv.WebServer]\nbEnabled=false\nListenPort=8089\n"

func TestKF2SettingsSpanAndOpaque(t *testing.T) {
	p, e := parseKF2Settings(kf2SettingsGamePath, []byte(kf2TestGame))
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if f.key == "Engine.AccessControl/AdminPassword" && !f.secret {
			t.Fatal("password not secret")
		}
		if strings.HasPrefix(f.key, "Operator/") && (f.kind != "readonly" || !f.secret || f.structured) {
			t.Fatal("opaque value exposed")
		}
	}
	out, e := p.patch(map[string]string{"Engine.GameReplicationInfo/ServerName": "Changed"})
	if e != nil {
		t.Fatal(e)
	}
	if string(out) != strings.Replace(kf2TestGame, "ServerName=Fixture", "ServerName=Changed", 1) {
		t.Fatal("unrelated bytes changed")
	}
	for _, key := range []string{"Operator/Opaque", "Operator/Opaque/Unknown", "Operator/+Array", "Missing"} {
		if _, e := p.patch(map[string]string{key: "x"}); e == nil {
			t.Fatalf("accepted %s", key)
		}
	}
	if !bytes.Contains(out, []byte("AdminPassword=fixture-private")) {
		t.Fatal("omitted secret changed")
	}
}
func TestKF2SettingsAliasesAndInjection(t *testing.T) {
	for _, row := range []string{"adminpassword=shadow", "+AdminPassword=shadow", ".ADMINPASSWORD=shadow", "!AdminPassword=shadow", "-AdminPassword=shadow", "AdminPassword=shadow"} {
		data := strings.Replace(kf2TestGame, "AdminPassword=fixture-private", "AdminPassword=fixture-private\r\n"+row, 1)
		if _, e := parseKF2Settings(kf2SettingsGamePath, []byte(data)); e == nil {
			t.Fatalf("accepted %s", row)
		}
	}
	for _, data := range []string{strings.Replace(kf2TestGame, "Engine.AccessControl", "engine.accesscontrol", 1), strings.Replace(kf2TestGame, "fixture-private", "\"quoted\"", 1), strings.Replace(kf2TestGame, "fixture-private", "private;comment", 1), "\ufeff" + kf2TestGame} {
		if _, e := parseKF2Settings(kf2SettingsGamePath, []byte(data)); e == nil {
			t.Fatal("accepted ambiguous source")
		}
	}
	p, e := parseKF2Settings(kf2SettingsWebPath, []byte(kf2TestWeb))
	if e != nil {
		t.Fatal(e)
	}
	for _, change := range []map[string]string{{"IpDrv.WebServer/ListenPort": "8090"}, {"IpDrv.WebServer/bEnabled": "1"}, {"IpDrv.WebServer/bEnabled": "true\nInjected=x"}} {
		if _, e := p.patch(change); e == nil {
			t.Fatal("accepted unsafe change")
		}
	}
}
func TestKF2SettingsTuplePreflight(t *testing.T) {
	alloc := map[int]bool{7777: true, 20560: true, 27015: true, 8089: true}
	check := func(game, web string, port int, a map[int]bool) error {
		return validateKF2SettingsTuple([]byte(game), []byte(web), 7777, 27015, port, a)
	}
	if e := check(kf2TestGame, kf2TestWeb, 8089, alloc); e != nil {
		t.Fatal(e)
	}
	enabled := strings.Replace(kf2TestWeb, "false", "true", 1)
	if e := check(kf2TestGame, enabled, 8089, alloc); e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct {
		g, w string
		p    int
		a    map[int]bool
	}{
		{strings.Replace(kf2TestGame, "fixture-private", "", 1), enabled, 8089, alloc},
		{kf2TestGame, enabled, 8089, map[int]bool{7777: true, 20560: true, 27015: true}},
		{kf2TestGame, kf2TestWeb, 8090, alloc},
		{kf2TestGame, "", 8089, alloc},
		{kf2TestGame, kf2TestWeb, 8089, map[int]bool{7777: true, 27015: true}},
		{kf2TestGame, strings.Replace(enabled, "8089", "27015", 1), 27015, alloc},
	} {
		if e := check(tc.g, tc.w, tc.p, tc.a); e == nil {
			t.Fatal("unsafe tuple admitted")
		}
	}
}
func TestKF2SettingsAuthority(t *testing.T) {
	env := map[string]string{"SRCDS_APPID": "232130"}
	if e := kf2SettingsAuthority(kf2SettingsRecipe, kf2SettingsStartup, kf2SettingsStartup, env); e != nil {
		t.Fatal(e)
	}
	for _, k := range []string{"SRCDS_APPID", "EXTRA_FLAGS", "PYTHONPATH", "LD_PRELOAD"} {
		copyEnv := map[string]string{"SRCDS_APPID": "232130"}
		copyEnv[k] = "override"
		if e := kf2SettingsAuthority(kf2SettingsRecipe, kf2SettingsStartup, kf2SettingsStartup, copyEnv); e == nil {
			t.Fatal("override admitted")
		}
	}
	if e := kf2SettingsAuthority("other", kf2SettingsStartup, kf2SettingsStartup, env); e == nil {
		t.Fatal("recipe alias admitted")
	}
	if e := kf2SettingsAuthority(kf2SettingsRecipe, kf2SettingsStartup, "other", env); e == nil {
		t.Fatal("startup override admitted")
	}
	if kf2SettingsDocument("/KFGame/Config/KFGame.ini") {
		t.Fatal("inactive document selected")
	}
}

func TestKF2SettingsCurrentEmittedContract(t *testing.T) {
	data, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if e = json.Unmarshal(data, &profiles); e != nil {
		t.Fatal(e)
	}
	profile, ok := profiles[kf2SettingsRecipe]
	if !ok || profile.Egg.Startup != kf2SettingsStartup {
		t.Fatal("canonical authority changed")
	}
	script := profile.Egg.Scripts.Installation.Script
	// Inspect the actual emitted runtime body, not the unserved source adapter.
	_, tail, ok := strings.Cut(script, "cat > .voltra/session_servers_runtime.py <<'")
	if !ok {
		t.Fatal("runtime emission missing")
	}
	marker, tail, ok := strings.Cut(tail, "'\n")
	if !ok {
		t.Fatal("emission header changed")
	}
	body, _, ok := strings.Cut(tail, "\n"+marker+"\n")
	if !ok {
		t.Fatal("emission terminator missing")
	}
	for _, fragment := range []string{"def kf2_plan(", "KFGame/Config/LinuxServer-KFGame.ini", "KFGame/Config/KFWeb.ini", "'Engine.AccessControl':{'AdminPassword':password}", "'Engine.GameReplicationInfo':{'ServerName':name}", "'IpDrv.WebServer':{'bEnabled':web,'ListenPort':str(webport)}", "if not found or (section.casefold(),key.casefold()) in managed:", "primary+12783"} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("emitted contract changed: %s", fragment)
		}
	}
}
