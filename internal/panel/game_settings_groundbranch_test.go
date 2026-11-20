package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func TestGroundBranchPublisherScalars(t *testing.T) {
	data, e := os.ReadFile("game_library/scripts/groundbranch-original-server.ini")
	if e != nil {
		t.Fatal(e)
	}
	data = append(data, []byte("\n[Unknown]\nPrecision=0.123456789123456789\nSecret=keep\n+Array=one\n+Array=two\n")...)
	p, e := gamesettings.ParseGroundBranchSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Fields) != 4 {
		t.Fatalf("fields %v", p.Fields)
	}
	key := gamesettings.GroundBranchSettingsSection + "ServerName"
	out, e := p.Patch(map[string]string{key: "Operator server"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("ServerName=Unnamed Ground Branch Server"), []byte("ServerName=Operator server"), 1)
	if !bytes.Equal(out, want) {
		t.Fatal("unrelated bytes changed")
	}
	for _, changes := range []map[string]string{{key: "bad\nPort=3"}, {key: "bad;comment"}, {gamesettings.GroundBranchSettingsSection + "ServerPassword": "secret"}, {gamesettings.GroundBranchSettingsSection + "MaxPlayers": "0"}, {"Port": "27015"}} {
		if _, e = p.Patch(changes); e == nil {
			t.Fatal("unsafe patch accepted")
		}
	}
	for _, suffix := range []string{"ServerName=duplicate\n", "servername=alias\n", "+ServerName=array\n"} {
		if _, e = gamesettings.ParseGroundBranchSettings([]byte("[/Script/RBZooKeeper.ZKServer]\nServerName=Original\n" + suffix)); e == nil {
			t.Fatal("ambiguity accepted")
		}
	}
	p, e = gamesettings.ParseGroundBranchSettings([]byte("[Unknown]\nSecret=keep\n"))
	if e != nil || len(p.Fields) != 0 {
		t.Fatal("missing fields synthesized")
	}
}
func TestGroundBranchEmittedAuthority(t *testing.T) {
	raw, e := os.ReadFile("../gamesettings/testdata/game-settings/game-parity-20261029/wave38-groundbranch/unapplied-profile-fragment.json")
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
	if e = json.Unmarshal(raw, &profiles); e != nil {
		t.Fatal(e)
	}
	egg := profiles[gamesettings.GroundBranchSettingsRecipe].Egg
	files := map[string][]byte{}
	for _, m := range regexp.MustCompile(`(?s)cat > (\S+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE`).FindAllStringSubmatch(egg.Scripts.Installation.Script, -1) {
		files[m[1]] = []byte(m[2] + "\n")
	}
	files = wave46CanonicalHelpers(t, gamesettings.GroundBranchSettingsRecipe)
	files[strings.TrimPrefix(gamesettings.GroundBranchSettingsPath, "/")] = []byte("[/Script/RBZooKeeper.ZKServer]\nServerName=Owned\n")
	in := gamesettings.SettingsAuthorityInput{Startup: egg.Startup, Env: map[string]string{"VOLTRA_TACTICAL_NEXT": "groundbranch"}, Files: files}
	if len(gamesettings.GroundBranchSettingsSources) != 11 {
		t.Fatal("missing helper closure")
	}
	if _, e := gamesettings.GroundBranchSettingsAuthority(gamesettings.GroundBranchSettingsRecipe, egg.Startup, []byte("{}"), in); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{".voltra/tactical_next_runtime.py", ".voltra/tactical_next_install.py"} {
		old := files[name]
		files[name] = []byte("changed")
		if _, e := gamesettings.GroundBranchSettingsAuthority(gamesettings.GroundBranchSettingsRecipe, egg.Startup, []byte("{}"), in); e == nil {
			t.Fatal("modified helper accepted")
		}
		files[name] = old
	}
	if _, e := gamesettings.GroundBranchSettingsAuthority(gamesettings.GroundBranchSettingsRecipe, egg.Startup, []byte(`{"Server.ini":{}}`), in); e == nil {
		t.Fatal("Wings mapping accepted")
	}
	in.Startup += "; echo injected"
	if _, e := gamesettings.GroundBranchSettingsAuthority(gamesettings.GroundBranchSettingsRecipe, egg.Startup, []byte("{}"), in); e == nil {
		t.Fatal("override accepted")
	}
}
