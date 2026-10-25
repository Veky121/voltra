package steamexec

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"voltra/internal/palworldloader"
)

type palworldDockerFixture struct {
	base   *fakeDocker
	stages []string
	fail   string
}

func (f *palworldDockerFixture) Run(ctx context.Context, args []string, out io.Writer) error {
	if args[0] == "run" && contains(args, palworldloader.PythonImage) {
		stage := args[len(args)-1]
		f.stages = append(f.stages, stage)
		if stage == f.fail {
			if stage == "install" {
				// The loader's own rollback is separately tested; the executor
				// must still protect operator content if a helper fails late.
				os.WriteFile(filepath.Join(f.base.dir, "Pal/Binaries/Win64/ue4ss/Mods/Operator/Scripts/main.lua"), []byte("failed helper changed operator file"), 0644)
			}
			io.WriteString(out, "Legacy/competing loader private-fixture-value")
			return errors.New("blocked")
		}
		return json.NewEncoder(out).Encode(map[string]any{"mod_roots": []string{"Pal/Binaries/Win64/ue4ss/Mods"}, "order_files": []string{"Pal/Binaries/Win64/ue4ss/Mods/mods.txt"}})
	}
	return f.base.Run(ctx, args, out)
}
func windowsPayload(dir string) error {
	file := filepath.Join(dir, "Pal/Binaries/Win64/PalServer-Win64-Shipping.exe")
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	data := make([]byte, 128)
	copy(data, "MZ")
	binary.LittleEndian.PutUint32(data[60:], 64)
	copy(data[64:], "PE\x00\x00")
	binary.LittleEndian.PutUint16(data[68:], 0x8664)
	return os.WriteFile(file, data, 0600)
}
func TestWindowsPalworldHooksAndFailedSteamPreserveOperatorMods(t *testing.T) {
	for _, failure := range []string{"", "preflight", "steam", "install"} {
		t.Run(failure, func(t *testing.T) {
			executor, base := fixture(t)
			gameOwner := executor.owner
			executor.owner = func(info os.FileInfo) (uint32, uint32, bool) {
				if info.Name() == filepath.Base(base.dir) {
					return gameOwner(info)
				}
				return 0, 0, true
			}
			docker := &palworldDockerFixture{base: base, fail: failure}
			executor.docker = docker
			executor.modSpace = func(string) (uint64, error) { return 1 << 30, nil }
			mod := filepath.Join(base.dir, "Pal/Binaries/Win64/ue4ss/Mods/Operator/Scripts/main.lua")
			pak := filepath.Join(base.dir, "Pal/Content/Paks/~mods/operator.pak")
			for _, file := range []string{mod, pak} {
				os.MkdirAll(filepath.Dir(file), 0700)
				os.WriteFile(file, []byte("operator-original"), 0600)
			}
			originalMode, _ := os.Stat(mod)
			base.mutate = func(ctx context.Context, out io.Writer) error {
				for _, file := range []string{mod, pak} {
					os.WriteFile(file, []byte("publisher-replaced"), 0644)
				}
				if failure == "steam" {
					return errors.New("publisher-failed")
				}
				if err := windowsPayload(base.dir); err != nil {
					return err
				}
				return os.WriteFile(filepath.Join(base.dir, "steamapps/appmanifest_2394010.acf"), []byte(manifest("200")), 0600)
			}
			request := req("install")
			request.Platform = "windows"
			result := terminal(t, execute(executor, request))
			if (failure == "") != (result.Type == "result") {
				t.Fatalf("unexpected result type %s: %s", result.Type, result.Error)
			}
			for _, file := range []string{mod, pak} {
				data, err := os.ReadFile(file)
				info, _ := os.Stat(file)
				if err != nil || string(data) != "operator-original" || info.Mode().Perm() != originalMode.Mode().Perm() {
					t.Fatal("Successful/failed maintenance lost operator Lua/PAK bytes or modes")
				}
			}
			if failure == "preflight" {
				for _, args := range base.snapshot() {
					if contains(args, "+app_update") {
						t.Fatal("Conflict reached Steam mutation")
					}
				}
				if strings.Contains(result.Error, "private-fixture-value") {
					t.Fatal("Raw helper diagnostics exposed")
				}
			}
			if failure == "" && (len(docker.stages) != 2 || docker.stages[0] != "preflight" || docker.stages[1] != "install") {
				t.Fatal("Missing stopped preflight/install sequence")
			}
		})
	}
}
func TestLinuxMaintenanceNeverStagesPalworldLoader(t *testing.T) {
	executor, base := fixture(t)
	docker := &palworldDockerFixture{base: base}
	executor.docker = docker
	if result := terminal(t, execute(executor, req("install"))); result.Type != "result" {
		t.Fatal(result.Error)
	}
	if len(docker.stages) != 0 {
		t.Fatal("Native Linux acquired Proton loader")
	}
}

func TestPalworldPublicBundleUsesHostVisibleVolumeParent(t *testing.T) {
	e, base := fixture(t)
	e.journal = filepath.Join(t.TempDir(), "remapped-private-journal")
	e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 0, 0, true }
	before, err := os.ReadFile(filepath.Join(base.dir, "world.sav"))
	if err != nil {
		t.Fatal(err)
	}
	one, err := e.palworldPublicBundle(base.dir)
	if err != nil {
		t.Fatal(err)
	}
	twoGame := filepath.Join(filepath.Dir(base.dir), "12345678-1234-1234-1234-123456789abc")
	if err = os.Mkdir(twoGame, 0700); err != nil {
		t.Fatal(err)
	}
	two, err := e.palworldPublicBundle(twoGame)
	if err != nil || one != two || filepath.Dir(one) != filepath.Join(filepath.Dir(base.dir), ".voltra-public-tools") {
		t.Fatalf("Independent games did not reuse host-visible immutable public tools: %v", err)
	}
	if _, err = os.Stat(e.journal); !os.IsNotExist(err) {
		t.Fatal("Public tool staging touched remapped private journal")
	}
	after, _ := os.ReadFile(filepath.Join(base.dir, "world.sav"))
	if string(before) != string(after) {
		t.Fatal("Staging changed game files")
	}
	if entries, _ := os.ReadDir(twoGame); len(entries) != 0 {
		t.Fatal("Staging wrote into second game")
	}
	file := filepath.Join(one, "runtime.py")
	if err = os.Chmod(file, 0644); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, []byte("modified"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = e.palworldPublicBundle(base.dir); err == nil {
		t.Fatal("Tampered immutable bundle was accepted")
	}
}

func TestPalworldPublicBundleRefusesUntrustedParentAndConflicts(t *testing.T) {
	for _, kind := range []string{"unknown-owner", "game-owned-parent", "file-conflict", "symlink", "writable-parent"} {
		t.Run(kind, func(t *testing.T) {
			e, base := fixture(t)
			e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 0, 0, true }
			root := filepath.Join(filepath.Dir(base.dir), ".voltra-public-tools")
			switch kind {
			case "unknown-owner":
				e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 0, 0, false }
			case "game-owned-parent":
				e.owner = func(os.FileInfo) (uint32, uint32, bool) { return 1000, 1000, true }
			case "file-conflict":
				if err := os.WriteFile(root, []byte("operator"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(t.TempDir(), root); err != nil {
					t.Skip("Symlink unavailable:", err)
				}
			case "writable-parent":
				if runtime.GOOS != "linux" {
					t.Skip("POSIX mode validation requires native Linux")
				}
				if err := os.Chmod(filepath.Dir(base.dir), 0777); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := e.palworldPublicBundle(base.dir); err == nil {
				t.Fatal("Unsafe public bundle staging accepted")
			}
		})
	}
}
