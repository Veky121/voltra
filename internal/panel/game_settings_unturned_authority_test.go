package panel

import (
	"os"
	"strings"
	"testing"
)

func TestUnturnedAuthority(t *testing.T) {
	var entry gameTemplate
	for _, e := range gameTemplates().Entries {
		if e.Path == unturnedSettingsRecipe {
			entry = e
		}
	}
	startup := str(entry.Egg["startup"])
	if entry.Profile != "unturned-native-v1" || startup != unturnedSettingsStartup {
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
	input := func() settingsAuthorityInput {
		return settingsAuthorityInput{Startup: startup, Env: map[string]string{"SRV_ID": "Operator_1"}, Files: map[string][]byte{".voltra/unturned-entry.sh": []byte(wrapper), ".voltra/unturned_runtime.py": runtime, "Servers/Operator_1/Server/Commands.dat": []byte("Chatrate 0.25\nCheats\npassword secret")}}
	}
	a, err := unturnedSettingsAuthority(unturnedSettingsRecipe, startup, input())
	if err != nil || a.Path != "/Servers/Operator_1/Server/Commands.dat" {
		t.Fatal(a, err)
	}
	for _, mutate := range []func(*settingsAuthorityInput){
		func(i *settingsAuthorityInput) { i.Startup += " -port 1234" },
		func(i *settingsAuthorityInput) { i.Env["SRV_ID"] = "../Default" },
		func(i *settingsAuthorityInput) { i.Env["SRV_ID"] = "" },
		func(i *settingsAuthorityInput) { i.Env["SRV_ID"] = "Other" },
		func(i *settingsAuthorityInput) { delete(i.Files, ".voltra/unturned-entry.sh") },
		func(i *settingsAuthorityInput) { i.Files[".voltra/unturned_runtime.py"] = []byte("custom") },
	} {
		i := input()
		mutate(&i)
		if _, err := unturnedSettingsAuthority(unturnedSettingsRecipe, startup, i); err == nil {
			t.Fatal("unsafe authority accepted")
		}
	}
	if _, err := unturnedSettingsAuthority("other/egg.json", startup, input()); err == nil {
		t.Fatal("recipe accepted")
	}
	i := input()
	delete(i.Env, "SRV_ID")
	i.Files["Servers/PterodactylUnturned/Server/Commands.dat"] = []byte("Cheats\n")
	b, err := unturnedSettingsAuthority(unturnedSettingsRecipe, startup, i)
	if err != nil || a.Revision == b.Revision {
		t.Fatal("identity revision not fenced", err)
	}
}
