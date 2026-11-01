package panel

import (
	"strings"
	"testing"
)

func authorityFixture(t *testing.T, forest bool) settingsAuthorityInput {
	t.Helper()
	in := settingsAuthorityInput{Startup: nitroxAuthorityStartup, Env: map[string]string{"INSTALL_MODE": "operator_files"}, Files: map[string][]byte{}}

	recipe := "subnautica_nitrox_mod/egg-subnautica.json"
	if forest {
		recipe = "the_forest/egg-the-forest.json"
		in.Startup = forestAuthorityStartup
	}
	for _, entry := range gameTemplates().Entries {
		if entry.Path != recipe {
			continue
		}
		script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
		for _, chunk := range strings.Split(script, "cat > ")[1:] {
			head, body, ok := strings.Cut(chunk, "\n")
			if !ok {
				continue
			}
			name, marker, ok := strings.Cut(head, " <<'")
			if !ok {
				continue
			}
			marker = strings.TrimSuffix(marker, "'")
			data, _, ok := strings.Cut(body, "\n"+marker+"\n")
			if !ok {
				t.Fatal(name)
			}
			in.Files[name] = []byte(data + "\n")
		}
	}

	return in
}
func TestNitroxAuthority(t *testing.T) {
	in := authorityFixture(t, false)
	a, err := nitroxSettingsAuthority(in)
	if err != nil || a.Path != "/NitroxData/saves/nitrox_world/server.cfg" {
		t.Fatalf("%+v %v", a, err)
	}
	in.Env["SAVE_NAME"] = "Own_save-2"
	b, err := nitroxSettingsAuthority(in)
	if err != nil || a.Revision == b.Revision {
		t.Fatal("save authority did not change", err)
	}
	in.Env["SUBNAUTICA_PASSWORD"] = "private-one"
	c, _ := nitroxSettingsAuthority(in)
	in.Env["SUBNAUTICA_PASSWORD"] = "private-two"
	d, _ := nitroxSettingsAuthority(in)
	if c != d || strings.Contains(c.Revision, "private") {
		t.Fatal("secret affects authority")
	}
	for _, raw := range []string{`{}`, `{"SavesFolderDir":"/home/container/NitroxData/saves"}`, `{"OtherSecret":"private"}`} {
		in.Files["NitroxData/nitrox.cfg"] = []byte(raw)
		if _, err := nitroxSettingsAuthority(in); err != nil {
			t.Fatal(raw, err)
		}
	}
	for _, raw := range []string{`null`, `[]`, `{"SavesFolderDir":null}`, `{"SavesFolderDir":"../escape"}`, `{"SavesFolderDir":"/other"}`, `{"savesfolderdir":"/home/container/NitroxData/saves"}`, `{"x":1,"x":2}`, `{} {}`} {
		in.Files["NitroxData/nitrox.cfg"] = []byte(raw)
		if _, err := nitroxSettingsAuthority(in); err == nil {
			t.Fatal("accepted", raw)
		}
	}
	delete(in.Files, "NitroxData/nitrox.cfg")
	for _, save := range []string{"", "../escape", "a/b", "a\\b", "-flag ", "x;quit", strings.Repeat("x", 101)} {
		in.Env["SAVE_NAME"] = save
		if _, err := nitroxSettingsAuthority(in); err == nil {
			t.Fatal("accepted", save)
		}
	}
	in = authorityFixture(t, false)
	in.Startup += " --save other"
	if _, err := nitroxSettingsAuthority(in); err == nil {
		t.Fatal("custom startup")
	}
	in = authorityFixture(t, false)
	in.Files[".voltra/nitrox-update.py"] = []byte("changed")
	if _, err := nitroxSettingsAuthority(in); err == nil {
		t.Fatal("changed helper")
	}
	for _, key := range []string{"SAVE_PATH", "DATA_PATH", "WINEHOMEDIR", "NITROX_VERSION"} {
		in = authorityFixture(t, false)
		in.Env[key] = "unsupported"
		if _, err := nitroxSettingsAuthority(in); err == nil {
			t.Fatal(key)
		}
	}
}
