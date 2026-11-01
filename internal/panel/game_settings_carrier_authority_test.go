package panel

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

func carrierEmittedBoot(t *testing.T) CarrierBootEvidence {
	t.Helper()
	raw, err := os.ReadFile("game_library/overrides.json")
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]struct {
		Revision string
		Egg      struct {
			Startup string
			Config  struct{ Files string }
			Scripts struct{ Installation struct{ Script string } }
		}
	}
	if err = json.Unmarshal(raw, &profiles); err != nil {
		t.Fatal(err)
	}
	p := profiles[carrierAuthorityRecipe]
	b := CarrierBootEvidence{Recipe: carrierAuthorityRecipe, ProfileRevision: p.Revision, Startup: p.Egg.Startup, Root: "/home/container", CWD: "/home/container", Platform: "linux/amd64", Argv: []string{"wine", "/home/container/dedicated_server.exe"}, Helpers: map[string][]byte{}, ConfigFiles: []byte(p.Egg.Config.Files)}
	lines := strings.Split(p.Egg.Scripts.Installation.Script, "\n")
	head := regexp.MustCompile(`^cat > (\S+) <<'([^']+)'$`)
	for i := 0; i < len(lines); i++ {
		m := head.FindStringSubmatch(lines[i])
		if m == nil {
			continue
		}
		start := i + 1
		for i++; i < len(lines) && lines[i] != m[2]; i++ {
		}
		b.Helpers[m[1]] = []byte(strings.Join(lines[start:i], "\n") + "\n")
	}
	return b
}
func TestCarrierAuthorityEmittedLayout(t *testing.T) {
	b := carrierEmittedBoot(t)
	data := []byte(`<data server_name="Native" password="" max_players="04" blueprints="01" port="28020"><permissions/><active_mod_folders/></data>`)
	reads := 0
	read := func(p string, limit int64) ([]byte, error) {
		reads++
		if p != "server_config.xml" || limit != 8<<20 {
			t.Fatal(p, limit)
		}
		return data, nil
	}
	a, err := ResolveCarrierSettingsAuthority(b, read)
	if err != nil || a.Path != carrierSettingsPath || a.Revision == "" {
		t.Fatal(a, err)
	}
	same, err := ResolveCarrierSettingsAuthority(b, read)
	if err != nil || a != same {
		t.Fatal(same, err)
	}
	// An ordinary opaque plugin subtree alone does not revoke native editing.
	data = []byte(strings.Replace(string(data), "<active_mod_folders/>", `<active_mod_folders><mod value="operator-mod"/></active_mod_folders>`, 1))
	changed, err := ResolveCarrierSettingsAuthority(b, read)
	if err != nil || changed.Revision == a.Revision {
		t.Fatal("native bytes not bound", err)
	}
	for i, mutate := range []func(*CarrierBootEvidence){
		func(b *CarrierBootEvidence) { b.Startup += " --config other.xml" },
		func(b *CarrierBootEvidence) { b.ProfileRevision += "changed" },
		func(b *CarrierBootEvidence) { b.Recipe = "other/egg-carrier-command2.json" },
		func(b *CarrierBootEvidence) { b.Root = "/tmp" },
		func(b *CarrierBootEvidence) { b.CWD = "/tmp" },
		func(b *CarrierBootEvidence) { b.Platform = "windows/amd64" },
		func(b *CarrierBootEvidence) {
			b.Argv = []string{"wine", "/home/container/dedicated_server.exe", "other.xml"}
		},
		func(b *CarrierBootEvidence) { b.ConfigFiles = []byte(`{"server_config.xml":{}}`) },
		func(b *CarrierBootEvidence) { b.ConfigFiles = []byte(`{"/folder/../server_config.xml":{}}`) },
		func(b *CarrierBootEvidence) { b.ConfigFiles = []byte(`null`) },
		func(b *CarrierBootEvidence) { b.ConfigFiles = nil },
		func(b *CarrierBootEvidence) { b.Helpers = map[string][]byte{} },
	} {
		bad := b
		mutate(&bad)
		before := reads
		if got, err := ResolveCarrierSettingsAuthority(bad, read); err == nil || got.Path != "" || reads != before {
			t.Fatalf("mutation %d authorized/read: %v %v", i, got, err)
		}
	}
	for name := range carrierAuthorityHelpers {
		original := b.Helpers[name]
		b.Helpers[name] = append([]byte{}, original...)
		b.Helpers[name][0] ^= 1
		before := reads
		if _, err := ResolveCarrierSettingsAuthority(b, read); err == nil || reads != before {
			t.Fatal("helper drift accepted", name)
		}
		b.Helpers[name] = original
	}
	for _, invalid := range [][]byte{nil, []byte(`<data password="a" password="b"/>`), make([]byte, (8<<20)+1)} {
		data = invalid
		if _, err := ResolveCarrierSettingsAuthority(b, read); err == nil {
			t.Fatal("invalid native config authorized")
		}
	}
}
