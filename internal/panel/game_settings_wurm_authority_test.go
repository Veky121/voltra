package panel

import (
	"testing"
	"voltra/internal/gamesettings"
)

func TestWurmAuthority(t *testing.T) {
	in := gamesettings.SettingsAuthorityInput{Startup: gamesettings.WurmOwnerStartup, Env: map[string]string{"VOLTRA_NATIVE_FAMILY": "wurm"}, Files: map[string][]byte{"LaunchConfig.ini": []byte("CleanLogsOnStart=false\n")}}
	for name, data := range wave53Emissions(t, gamesettings.WurmSettingsRecipe) {
		in.Files[name] = data
	}
	if a, e := gamesettings.WurmSettingsAuthority(gamesettings.WurmSettingsRecipe, gamesettings.WurmOwnerStartup, in); e != nil || a.Path != gamesettings.WurmSettingsPath {
		t.Fatal(a, e)
	}
	for _, startup := range []string{"exec ./WurmServerLauncher", gamesettings.WurmOwnerStartup + " extra"} {
		in.Startup = startup
		if _, e := gamesettings.WurmSettingsAuthority(gamesettings.WurmSettingsRecipe, gamesettings.WurmOwnerStartup, in); e == nil {
			t.Fatal("custom startup accepted")
		}
	}
	in.Startup = gamesettings.WurmOwnerStartup
	in.Files[".voltra/wurm_owner.py"] = []byte("changed")
	if _, e := gamesettings.WurmSettingsAuthority(gamesettings.WurmSettingsRecipe, gamesettings.WurmOwnerStartup, in); e == nil {
		t.Fatal("changed helper accepted")
	}
}
