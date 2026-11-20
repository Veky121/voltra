package panel

import (
	"os"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func TestUnturnedAuthority(t *testing.T) {
	var entry gameTemplate
	for _, e := range gameTemplates().Entries {
		if e.Path == gamesettings.UnturnedSettingsRecipe {
			entry = e
		}
	}
	startup := str(entry.Egg["startup"])
	if entry.Profile != "unturned-native-v1" || startup != gamesettings.UnturnedSettingsStartup {
		t.Fatal("canonical profile drift")
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	script = strings.ReplaceAll(script, "\r\n", "\n")
	parts := strings.Split(script, "cat > .voltra/unturned-entry.sh <<'VOLTRA_ENTRY'\n")
	if len(parts) != 2 {
		t.Fatal("wrapper absent")
	}
	wrapper := strings.Split(parts[1], "\nVOLTRA_ENTRY")[0] + "\n"
	runtime, err := os.ReadFile("game_library/scripts/unturned-runtime.py")
	if err != nil {
		t.Fatal(err)
	}
	input := func() gamesettings.SettingsAuthorityInput {
		return gamesettings.SettingsAuthorityInput{Startup: startup, Env: map[string]string{"SRV_ID": "Operator_1"}, Files: map[string][]byte{".voltra/unturned-entry.sh": []byte(wrapper), ".voltra/unturned_runtime.py": runtime, "Servers/Operator_1/Server/Commands.dat": []byte("Chatrate 0.25\nCheats\npassword secret")}}
	}
	a, err := gamesettings.UnturnedSettingsAuthority(gamesettings.UnturnedSettingsRecipe, startup, input())
	if err != nil || a.Path != "/Servers/Operator_1/Server/Commands.dat" {
		t.Fatal(a, err)
	}
	for _, mutate := range []func(*gamesettings.SettingsAuthorityInput){
		func(i *gamesettings.SettingsAuthorityInput) { i.Startup += " -port 1234" },
		func(i *gamesettings.SettingsAuthorityInput) { i.Env["SRV_ID"] = "../Default" },
		func(i *gamesettings.SettingsAuthorityInput) { i.Env["SRV_ID"] = "" },
		func(i *gamesettings.SettingsAuthorityInput) { i.Env["SRV_ID"] = "Other" },
		func(i *gamesettings.SettingsAuthorityInput) { delete(i.Files, ".voltra/unturned-entry.sh") },
		func(i *gamesettings.SettingsAuthorityInput) {
			i.Files[".voltra/unturned_runtime.py"] = []byte("custom")
		},
	} {
		i := input()
		mutate(&i)
		if _, err := gamesettings.UnturnedSettingsAuthority(gamesettings.UnturnedSettingsRecipe, startup, i); err == nil {
			t.Fatal("unsafe authority accepted")
		}
	}
	if _, err := gamesettings.UnturnedSettingsAuthority("other/egg.json", startup, input()); err == nil {
		t.Fatal("recipe accepted")
	}
	i := input()
	delete(i.Env, "SRV_ID")
	i.Files["Servers/PterodactylUnturned/Server/Commands.dat"] = []byte("Cheats\n")
	b, err := gamesettings.UnturnedSettingsAuthority(gamesettings.UnturnedSettingsRecipe, startup, i)
	if err != nil || a.Revision == b.Revision {
		t.Fatal("identity revision not fenced", err)
	}
}
