package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectZomboidExistingOnly(t *testing.T) {
	data := []byte("# operator\r\nPublicName=Existing\r\nMaxPlayers=8\r\nPublic=false\r\nPassword=hidden\r\nDefaultPort=23560\r\nUDPPort=23561\r\nMods=\\VoltraAcceptance\r\nUnknown=0.123456789012345678901\r\nUnknown=second\r\n")
	p, e := parseProjectZomboidSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"PublicName": "New", "Public": "true", "MaxPlayers": "12"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("PublicName=Existing"), []byte("PublicName=New"), 1)
	want = bytes.Replace(want, []byte("Public=false"), []byte("Public=true"), 1)
	want = bytes.Replace(want, []byte("MaxPlayers=8"), []byte("MaxPlayers=12"), 1)
	if !bytes.Equal(got, want) {
		t.Fatalf("unexpected byte changes: %q", got)
	}
	for _, changes := range []map[string]string{{"DefaultPort": "1234"}, {"UDPPort": "1235"}, {"PVP": "true"}, {"Mods": "bad"}, {"MaxPlayers": "101"}, {"Public": "1"}, {"PublicName": "x\nPassword=oops"}, {"Password": "x;bad"}} {
		if _, e := p.patch(changes); e == nil {
			t.Fatalf("accepted %v", changes)
		}
	}
	unchanged, e := p.patch(nil)
	if e != nil || !bytes.Equal(unchanged, data) {
		t.Fatal("no-op changed bytes")
	}
	for _, data := range []string{"Public=true\nPublic=false\n", "Public=true\npublic=false\n"} {
		if _, e := parseProjectZomboidSettings([]byte(data)); e == nil {
			t.Fatal("accepted ambiguous keys")
		}
	}
}

func TestProjectZomboidEmittedAuthority(t *testing.T) {
	// Use actual frozen pending installer output, without executing its shell/Python.
	root := "testdata/game-settings"
	b, e := os.ReadFile(filepath.Join(root, "game-parity-20261029/wave38-project_zomboid/profile.pending.json"))
	if e != nil {
		t.Fatal(e)
	}
	var profile map[string]struct {
		Egg struct {
			Startup string
			Scripts struct{ Installation struct{ Script string } }
		}
	}
	if e = json.Unmarshal(b, &profile); e != nil {
		t.Fatal(e)
	}
	egg := profile[projectZomboidSettingsRecipe].Egg
	files := map[string][]byte{}
	for _, chunk := range strings.Split(egg.Scripts.Installation.Script, "cat > ")[1:] {
		header, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(header, " <<'")
		if !ok {
			continue
		}
		marker = strings.TrimSuffix(marker, "'")
		content, _, ok := strings.Cut(body, "\n"+marker+"\n")
		if !ok {
			t.Fatal("missing heredoc terminator")
		}
		files[name] = []byte(content + "\n")
	}
	fixed, e := os.ReadFile("game_library/scripts/project-zomboid-runtime.py")
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal([]byte(strings.TrimRight(strings.ReplaceAll(string(fixed), "\r\n", "\n"), "\n")+"\n"), []byte(strings.TrimRight(string(files[".voltra/project_zomboid_runtime.py"]), "\n")+"\n")) {
		t.Fatal("pending helper differs from current fixed helper")
	}
	files = wave46CanonicalHelpers(t, projectZomboidSettingsRecipe)
	files[".cache/Server/VoltraAcceptance.ini"] = []byte("PublicName=Observed\nMaxPlayers=8\n")
	in := settingsAuthorityInput{Startup: egg.Startup, Env: map[string]string{"SERVER_NAME": "VoltraAcceptance"}, Files: files}
	result, e := projectZomboidSettingsAuthority(projectZomboidSettingsRecipe, egg.Startup, in)
	if e != nil || result.Path != "/.cache/Server/VoltraAcceptance.ini" {
		t.Fatalf("%+v %v", result, e)
	}
	for _, name := range []string{"", "../escape", "other", "x;id"} {
		in.Env["SERVER_NAME"] = name
		if _, e := projectZomboidSettingsAuthority(projectZomboidSettingsRecipe, egg.Startup, in); e == nil {
			t.Fatal("accepted invalid/missing selected identity")
		}
	}
	in.Env["SERVER_NAME"] = "VoltraAcceptance"
	in.Env["JAVA_TOOL_OPTIONS"] = "-javaagent:other"
	if _, e := projectZomboidSettingsAuthority(projectZomboidSettingsRecipe, egg.Startup, in); e == nil {
		t.Fatal("accepted java override")
	}
	delete(in.Env, "JAVA_TOOL_OPTIONS")
	in.Startup += " --alternate"
	if _, e := projectZomboidSettingsAuthority(projectZomboidSettingsRecipe, egg.Startup, in); e == nil {
		t.Fatal("accepted alternate startup")
	}
	in.Startup = egg.Startup
	files[".voltra/project_zomboid_runtime.py"] = append(files[".voltra/project_zomboid_runtime.py"], ' ')
	if _, e := projectZomboidSettingsAuthority(projectZomboidSettingsRecipe, egg.Startup, in); e == nil {
		t.Fatal("accepted altered helper")
	}
}
