package panel

import (
	"os"
	"path/filepath"
	"testing"
	"voltra/internal/gamesettings"
)

func iw4xAuthorityFixture(t *testing.T) gamesettings.SettingsAuthorityInput {
	t.Helper()
	in := gamesettings.SettingsAuthorityInput{Startup: gamesettings.Iw4xAuthorityStartup, Env: map[string]string{"INSTALL_MODE": "existing", "SRCDS_APPID": "10190", "WINDOWS_INSTALL": "1", "WINETRICKS_RUN": "vcrun2022", "AUTO_UPDATE": "0"}, Files: map[string][]byte{"userraw/server.cfg": []byte("set sv_motd hello\nset g_allowvote 0\n")}}
	for name := range gamesettings.Iw4xAuthoritySources {
		file := filepath.Base(name)
		if file == "steam_template.py" {
			file = "steam-template.py"
		}
		data, err := os.ReadFile(filepath.Join("game_library", "scripts", file))
		if err != nil {
			t.Fatal(err)
		}
		// This pure contract fixture uses its reviewed v1 source, not the newer loose Stationeers adapter.
		if file == "native-console.py" {
			data = reviewedConsoleV1(t)
		}
		in.Files[name] = data
	}
	return in
}
func TestIW4xAuthority(t *testing.T) {
	in := iw4xAuthorityFixture(t)
	a, err := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in)
	if err != nil || a.Path != gamesettings.Iw4xSettingsPath {
		t.Fatal(a, err)
	}
	for _, shadow := range []string{"server.cfg", "main/server.cfg", "userraw/autoexec.cfg", "mods/test/server.cfg"} {
		in := iw4xAuthorityFixture(t)
		in.Env["MOD_DIR"] = "mods/test"
		in.Files[shadow] = []byte("opaque")
		if _, e := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); e == nil {
			t.Fatal(shadow)
		}
	}
	for _, tail := range []string{"exec other.cfg", "vstr rotation", "set fs_game mods/other", "set x 1; quit"} {
		in := iw4xAuthorityFixture(t)
		in.Files["userraw/server.cfg"] = []byte("set sv_motd hello\n" + tail + "\n")
		if _, e := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); e == nil {
			t.Fatal(tail)
		}
	}
	in.Env["VOLTRA_STEAM_AUTO_UPDATE"] = "1"
	if _, e := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); e == nil {
		t.Fatal("update override")
	}
	in = iw4xAuthorityFixture(t)
	in.Startup += " +exec other.cfg"
	if _, e := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); e == nil {
		t.Fatal("startup drift")
	}
	in = iw4xAuthorityFixture(t)
	in.Files[".voltra/arena-native.py"] = []byte("drift")
	if _, e := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); e == nil {
		t.Fatal("helper drift")
	}
}

// Canonical bytes include their actual checkout/heredoc line endings. The pure
// authority contract normalizes those endings and must still reject byte drift.
// This does not prove packed CFG precedence or enable native typed editing.
func TestIW4xAuthorityCanonicalHelperBytes(t *testing.T) {
	in := iw4xAuthorityFixture(t)
	emitted := wave53Emissions(t, gamesettings.Iw4xSettingsRecipe)
	for name := range gamesettings.Iw4xAuthoritySources {
		data, ok := emitted[name]
		if !ok {
			t.Fatalf("missing canonical helper: %s", name)
		}
		in.Files[name] = data
	}
	if authority, err := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); err != nil || authority.Path != gamesettings.Iw4xSettingsPath {
		t.Fatal("canonical source contract", authority, err)
	}
	in.Files[".voltra/native-console.py"] = append(append([]byte{}, in.Files[".voltra/native-console.py"]...), byte('x'))
	if _, err := gamesettings.Iw4xSettingsAuthority(gamesettings.Iw4xSettingsRecipe, gamesettings.Iw4xAuthorityStartup, in); err == nil {
		t.Fatal("canonical console byte drift accepted")
	}
}
