package panel

import (
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

// Read actual canonical heredoc bytes, including the emitted final newline.
func wave53Emissions(t *testing.T, recipe string) map[string][]byte {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path != recipe {
			continue
		}
		script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
		files := map[string][]byte{}
		for _, chunk := range strings.Split(script, "cat > ")[1:] {
			head, body, ok := strings.Cut(chunk, "\n")
			if !ok {
				continue
			}
			name, marker, ok := strings.Cut(head, " <<'")
			if !ok || !strings.HasPrefix(name, ".voltra/") {
				continue
			}
			expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
			if !ok {
				t.Fatal("missing heredoc", name)
			}
			files[name] = []byte(expected + "\n")
		}
		return files
	}
	t.Fatal("missing recipe", recipe)
	return nil
}

func TestWave53AuthorityOneByteRefusal(t *testing.T) {
	for _, recipe := range []string{gamesettings.StationeersBepinexRecipe, gamesettings.WurmSettingsRecipe} {
		t.Run(recipe, func(t *testing.T) {
			in := stationeersAuthorityFixture(t)
			check := func() error {
				_, e := gamesettings.StationeersBepinexSettingsAuthority(recipe, gamesettings.StationeersBepinexAuthorityStartup, in)
				return e
			}
			names := []string{".voltra/stationeers_bepinex_owner.py", ".voltra/stationeers_wurm_starbound_runtime.py"}
			if recipe == gamesettings.WurmSettingsRecipe {
				in = gamesettings.SettingsAuthorityInput{Startup: gamesettings.WurmOwnerStartup, Env: map[string]string{"VOLTRA_NATIVE_FAMILY": "wurm"}, Files: wave53Emissions(t, recipe)}
				in.Files["LaunchConfig.ini"] = []byte("CleanLogsOnStart=false\n")
				names = []string{".voltra/wurm_owner.py", ".voltra/stationeers_wurm_starbound_install.py", ".voltra/native_config.py", ".voltra/native_console.py", ".voltra/steam_template.py", ".voltra/valheim_vrising_install.py"}
				check = func() error {
					_, e := gamesettings.WurmSettingsAuthority(recipe, gamesettings.WurmOwnerStartup, in)
					return e
				}
			}
			if e := check(); e != nil {
				t.Fatal(e)
			}
			for _, name := range names {
				original := in.Files[name]
				changed := append([]byte(nil), original...)
				changed[0] ^= 1
				in.Files[name] = changed
				if check() == nil {
					t.Fatal("one byte drift accepted", name)
				}
				in.Files[name] = original
			}
			path := "setting.xml"
			if recipe == gamesettings.WurmSettingsRecipe {
				path = "LaunchConfig.ini"
			}
			in.Files["other/"+path] = in.Files[path]
			delete(in.Files, path)
			if check() == nil {
				t.Fatal("wrong path accepted")
			}
		})
	}
}
