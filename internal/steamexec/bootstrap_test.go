//go:build linux

package steamexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestRootOwnedBootstrapUsesTrustedUIDWithoutRecursiveChown(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root required for real descriptor ownership regression")
	}
	for _, scenario := range []string{"install", "check", "update", "verify", "existing-manifest", "missing-user", "running", "symlink"} {
		t.Run(scenario, func(t *testing.T) {
			e, f := fixture(t)
			e.owner = fileOwner
			_ = os.Remove(filepath.Join(f.dir, "steamapps/appmanifest_2394010.acf"))
			user := map[string]any{"uid": 988, "gid": 988}
			if scenario == "missing-user" {
				user = nil
			}
			raw, _ := yaml.Marshal(map[string]any{"system": map[string]any{"data": filepath.Dir(f.dir), "user": user}})
			if err := os.WriteFile(e.wingsConfig, raw, 0600); err != nil {
				t.Fatal(err)
			}
			r := req("install")
			if scenario == "check" || scenario == "update" || scenario == "verify" {
				r.Operation = scenario
			}
			if scenario == "existing-manifest" {
				_ = os.WriteFile(filepath.Join(f.dir, "steamapps/appmanifest_2394010.acf"), []byte(manifest("100")), 0600)
			}
			if scenario == "running" {
				f.running = true
			}
			if scenario == "symlink" {
				moved := f.dir + ".real"
				if err := os.Rename(f.dir, moved); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(moved, f.dir); err != nil {
					t.Fatal(err)
				}
			}
			err := e.prepareGameOwner(context.Background(), r, f.dir)
			if (err == nil) != (scenario == "install") {
				t.Fatalf("%s: %v", scenario, err)
			}
			info, statErr := os.Stat(f.dir)
			if statErr != nil {
				t.Fatal(statErr)
			}
			uid, gid, _ := fileOwner(info)
			want := uint32(0)
			if scenario == "install" {
				want = 988
			}
			if uid != want || gid != want {
				t.Fatalf("owner %d:%d want %d", uid, gid, want)
			}
			child, statErr := os.Stat(filepath.Join(f.dir, "world.sav"))
			if statErr != nil {
				t.Fatal(statErr)
			}
			uid, _, _ = fileOwner(child)
			if uid != 0 {
				t.Fatal("bootstrap recursively chowned game data")
			}
		})
	}
}

func TestInitialInstallWithoutGameContainer(t *testing.T) {
	e, f := fixture(t)
	f.missing = true
	raw, err := yaml.Marshal(map[string]any{"system": map[string]any{"data": filepath.Dir(f.dir)}})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(e.wingsConfig, raw, 0600); err != nil {
		t.Fatal(err)
	}
	e.owner = func(info os.FileInfo) (uint32, uint32, bool) {
		if info.Name() == serverID {
			return 1000, 1000, true
		}
		return 0, 0, true
	}
	result := terminal(t, execute(e, req("install")))
	if result.Type != "result" || result.InstalledBuild != "200" || !result.FilesChanged {
		t.Fatalf("first install failed: %+v", result)
	}
	found := false
	for _, args := range f.snapshot() {
		if contains(args, "+app_update") {
			found = true
			if !contains(args, mutationScript) || !contains(args, "type=bind,src="+f.dir+",dst=/data") {
				t.Fatalf("missing runtime wrapper or UUID mount: %v", args)
			}
		}
	}
	if !found {
		t.Fatal("no install helper")
	}
}
func TestInitialInstallRequiresTrustedLocalState(t *testing.T) {
	for _, scenario := range []string{"missing-config", "writable-config", "nonroot-config", "daemon-unavailable", "installer-active", "missing-volume", "root-owned-volume"} {
		t.Run(scenario, func(t *testing.T) {
			e, f := fixture(t)
			f.missing = true
			raw, _ := yaml.Marshal(map[string]any{"system": map[string]any{"data": filepath.Dir(f.dir)}})
			_ = os.WriteFile(e.wingsConfig, raw, 0600)
			e.owner = func(info os.FileInfo) (uint32, uint32, bool) {
				if info.Name() == serverID {
					return 1000, 1000, true
				}
				return 0, 0, true
			}
			switch scenario {
			case "missing-config":
				_ = os.Remove(e.wingsConfig)
			case "writable-config":
				if err := os.Chmod(e.wingsConfig, 0666); err != nil {
					t.Fatal(err)
				}
				if info, _ := os.Stat(e.wingsConfig); info.Mode().Perm()&0022 == 0 {
					t.Skip("filesystem does not represent Unix writable permission bits")
				}
			case "nonroot-config":
				e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 1000, 1000, true }
			case "daemon-unavailable":
				f.unavailable = true
			case "installer-active":
				f.installerActive = true
			case "missing-volume":
				if err := os.Rename(f.dir, f.dir+".moved"); err != nil {
					t.Fatal(err)
				}
			case "root-owned-volume":
				e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 0, 0, true }
			}
			result := terminal(t, execute(e, req("install")))
			if result.Type != "error" || result.FilesChanged {
				t.Fatal(result)
			}
			for _, args := range f.snapshot() {
				if args[0] == "run" {
					t.Fatalf("helper launched without trusted state: %s", strings.Join(args, " "))
				}
			}
		})
	}
}
