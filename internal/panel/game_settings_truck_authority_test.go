package panel

import (
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
)

func truckTestBoot(t *testing.T, recipe string) TruckBootEvidence {
	t.Helper()
	raw, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Revision string
		Egg      struct {
			Startup string
			Scripts struct{ Installation struct{ Script string } }
		}
	}
	if e = json.Unmarshal(raw, &profiles); e != nil {
		t.Fatal(e)
	}
	p := profiles[recipe]
	c := truckReviewedContracts[recipe]
	helpers := map[string][]byte{}
	// Heredoc delimiters differ by profile. Preserve precisely the emitted LF bytes.
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
		helpers[m[1]] = []byte(strings.Join(lines[start:i], "\n") + "\n")
	}
	return TruckBootEvidence{Recipe: recipe, ProfileRevision: p.Revision, Startup: p.Egg.Startup, Platform: "linux/amd64", Root: "/home/container", CWD: "/home/container", Home: "/home/container", XDGDataHome: "/home/container/.local/share", Argv: []string{"/home/container/bin/linux_x64/" + c.Binary}, Helpers: helpers}
}
func TestTruckAuthorityRecipes(t *testing.T) {
	for recipe, c := range truckReviewedContracts {
		t.Run(c.Binary, func(t *testing.T) {
			b := truckTestBoot(t, recipe)
			reads := 0
			read := func(p string, limit int64) ([]byte, error) {
				reads++
				if p != ".local/share/"+c.Folder+"/server_config.sii" || limit != 4<<20 {
					t.Fatal(p, limit)
				}
				return []byte(truckFixture), nil
			}
			a, e := ResolveTruckSettingsAuthority(b, read)
			if e != nil {
				t.Fatal(e)
			}
			a2, e := ResolveTruckSettingsAuthority(b, read)
			if e != nil || a != a2 || a.Revision == "" {
				t.Fatal(a, a2, e)
			}
			mutations := []func(*TruckBootEvidence){func(b *TruckBootEvidence) { b.Home = "/other" }, func(b *TruckBootEvidence) { b.XDGDataHome = "/other" }, func(b *TruckBootEvidence) { b.Root = "/tmp/root" }, func(b *TruckBootEvidence) { b.CWD = "/tmp" }, func(b *TruckBootEvidence) { b.Platform = "windows/amd64" }, func(b *TruckBootEvidence) { b.ProfileRevision += "x" }, func(b *TruckBootEvidence) { b.Startup += " -homedir /other" }, func(b *TruckBootEvidence) { b.Argv = append(b.Argv, "-server_cfg=other.sii") }, func(b *TruckBootEvidence) { b.Argv = append(b.Argv, "-homedir", "/other") }, func(b *TruckBootEvidence) { b.Argv = []string{"bin/linux_x64/" + c.Binary} }, func(b *TruckBootEvidence) { b.Helpers = map[string][]byte{} }, func(b *TruckBootEvidence) { b.Recipe = "candidate/server_config.sii" }}
			for i, mutate := range mutations {
				bad := b
				mutate(&bad)
				before := reads
				if got, e := ResolveTruckSettingsAuthority(bad, read); e == nil || got.Path != "" || reads != before {
					t.Fatalf("mutation %d authorized/read: %v %v", i, got, e)
				}
			}
			sentinel := errors.New("not regular or symlink component")
			if _, e := ResolveTruckSettingsAuthority(b, func(string, int64) ([]byte, error) { return nil, sentinel }); !errors.Is(e, sentinel) {
				t.Fatal(e)
			}
			for _, data := range [][]byte{nil, []byte("invalid"), make([]byte, (4<<20)+1)} {
				if _, e := ResolveTruckSettingsAuthority(b, func(string, int64) ([]byte, error) { return data, nil }); e == nil {
					t.Fatal("invalid accepted")
				}
			}
			changed, e := ResolveTruckSettingsAuthority(b, func(string, int64) ([]byte, error) {
				return []byte(strings.Replace(truckFixture, "unknown: 42", "unknown: 43", 1)), nil
			})
			if e != nil || changed.Revision == a.Revision {
				t.Fatal("file revision unbound", e)
			}
			for name, data := range b.Helpers {
				b.Helpers[name] = append(append([]byte{}, data...), byte(' '))
				before := reads
				if _, e := ResolveTruckSettingsAuthority(b, read); e == nil || reads != before {
					t.Fatal("helper drift accepted", name)
				}
				b.Helpers[name] = data
			}
		})
	}
}
