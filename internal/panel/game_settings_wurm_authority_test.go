package panel

import (
	"testing"
)

func TestWurmAuthority(t *testing.T) {
	in := settingsAuthorityInput{Startup: wurmOwnerStartup, Env: map[string]string{"VOLTRA_NATIVE_FAMILY": "wurm"}, Files: map[string][]byte{"LaunchConfig.ini": []byte("CleanLogsOnStart=false\n")}}
	for name, data := range wave53Emissions(t, wurmSettingsRecipe) {
		in.Files[name] = data
	}
	if a, e := wurmSettingsAuthority(wurmSettingsRecipe, wurmOwnerStartup, in); e != nil || a.Path != wurmSettingsPath {
		t.Fatal(a, e)
	}
	for _, startup := range []string{"exec ./WurmServerLauncher", wurmOwnerStartup + " extra"} {
		in.Startup = startup
		if _, e := wurmSettingsAuthority(wurmSettingsRecipe, wurmOwnerStartup, in); e == nil {
			t.Fatal("custom startup accepted")
		}
	}
	in.Startup = wurmOwnerStartup
	in.Files[".voltra/wurm_owner.py"] = []byte("changed")
	if _, e := wurmSettingsAuthority(wurmSettingsRecipe, wurmOwnerStartup, in); e == nil {
		t.Fatal("changed helper accepted")
	}
}
