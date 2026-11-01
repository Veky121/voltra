package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func rustStagingAuthorityFixture(t *testing.T) rustStagingAuthorityInput {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path != rustStagingSettingsRecipe {
			continue
		}
		in := rustStagingAuthorityInput{Recipe: entry.Path, Startup: str(entry.Egg["startup"]), EggStartup: str(entry.Egg["startup"]), Path: "/server/rust/cfg/server.cfg", ConfigFiles: json.RawMessage(`{}`), Env: map[string]string{}, Files: map[string][]byte{}}
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
			content, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
			if !ok {
				t.Fatal("invalid installer block")
			}
			in.Files[name] = []byte(content + "\n")
		}
		in.Files[in.Path] = []byte("// operator\r\nserver.tags \"weekly,EU\" // keep\r\nserver.seed 9007199254740993\r\n")
		return in
	}
	t.Fatal("missing canonical recipe")
	return rustStagingAuthorityInput{}
}

func TestRustStagingAuthorityCanonicalPatch(t *testing.T) {
	in := rustStagingAuthorityFixture(t)
	for _, id := range []string{"rust", "owned_24-A"} {
		in.Env["SERVER_ID"] = id
		old := in.Files[in.Path]
		delete(in.Files, in.Path)
		in.Path = "/server/" + id + "/cfg/server.cfg"
		in.Files[in.Path] = old
		got, err := resolveRustStagingAuthority(in)
		if err != nil || got.Path != in.Path || got.Revision == "" {
			t.Fatalf("authority: %+v %v", got, err)
		}
		p, err := parseRustStagingSettings(in.Files[got.Path])
		if err != nil {
			t.Fatal(err)
		}
		next, err := p.patch(map[string]string{"server.tags": "monthly,NA"})
		if err != nil || string(next) != strings.Replace(string(old), "weekly,EU", "monthly,NA", 1) {
			t.Fatalf("patch: %q %v", next, err)
		}
	}
}

func TestRustStagingAuthorityRefusals(t *testing.T) {
	cases := map[string]func(*rustStagingAuthorityInput){
		"recipe":         func(i *rustStagingAuthorityInput) { i.Recipe = "rust/rust/egg-rust.json" },
		"startup":        func(i *rustStagingAuthorityInput) { i.Startup += " +server.tags monthly" },
		"egg startup":    func(i *rustStagingAuthorityInput) { i.EggStartup = "./RustDedicated" },
		"mapping":        func(i *rustStagingAuthorityInput) { i.ConfigFiles = json.RawMessage(`{"server.cfg":{}}`) },
		"null mappings":  func(i *rustStagingAuthorityInput) { i.ConfigFiles = json.RawMessage(`null`) },
		"missing config": func(i *rustStagingAuthorityInput) { delete(i.Files, i.Path) },
		"inactive path":  func(i *rustStagingAuthorityInput) { i.Path = "/server/other/cfg/server.cfg" },
	}
	for _, key := range []string{"ADDITIONAL_ARGS", "PYTHONPATH", "LD_PRELOAD", "FRAMEWORK"} {
		k := key
		cases[k] = func(i *rustStagingAuthorityInput) { i.Env[k] = "override" }
	}
	for _, value := range []string{"", "../escape", "/rust", "a/b", "a\\b", strings.Repeat("a", 65), "rust\n"} {
		v := value
		cases["identity:"+v] = func(i *rustStagingAuthorityInput) { i.Env["SERVER_ID"] = v }
	}
	for name := range rustStagingAuthorityHelpers {
		n := name
		cases["altered:"+n] = func(i *rustStagingAuthorityInput) { i.Files[n] = append(i.Files[n], '\n') }
		cases["missing:"+n] = func(i *rustStagingAuthorityInput) { delete(i.Files, n) }
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			in := rustStagingAuthorityFixture(t)
			mutate(&in)
			got, err := resolveRustStagingAuthority(in)
			if err == nil || got.Path != "" {
				t.Fatal("ambiguous authority accepted")
			}
		})
	}
}
