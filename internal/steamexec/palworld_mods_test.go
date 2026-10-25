package steamexec

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestPalworldCustomPAKStreamsBeyondGenericConfigLimit(t *testing.T) {
	game, journal := t.TempDir(), t.TempDir()
	name := "Pal/Content/Paks/~mods/large-operator.pak"
	file := filepath.Join(game, name)
	os.MkdirAll(filepath.Dir(file), 0700)
	out, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	block := bytes.Repeat([]byte{0x53}, 1<<20)
	for range 24 {
		if _, err = out.Write(block); err != nil {
			t.Fatal(err)
		}
	}
	out.Close()
	os.Chmod(file, 0600)
	hashFile := func(path string) [32]byte {
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		h := sha256.New()
		io.Copy(h, f)
		var digest [32]byte
		copy(digest[:], h.Sum(nil))
		return digest
	}
	modeBefore, _ := os.Stat(file)
	before := hashFile(file)
	dest := filepath.Join(journal, "owned.palworld-mods")
	free := func(string) (uint64, error) { return 64 << 20, nil }
	if err = backupPalworldMods(game, dest, palworldProtectedPaths{}, free); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(file, []byte("changed"), 0644)
	if err = restorePalworldMods(game, dest); err != nil {
		t.Fatal(err)
	}
	if hashFile(file) != before {
		t.Fatal("Large custom PAK was not restored")
	}
	info, _ := os.Stat(file)
	if info.Mode().Perm() != modeBefore.Mode().Perm() {
		t.Fatal("Large custom PAK mode changed")
	}
}
func TestPalworldModDiskAdmissionAndUnsafeRootsBeforeWrites(t *testing.T) {
	game, journal := t.TempDir(), t.TempDir()
	dest := filepath.Join(journal, "owned.palworld-mods")
	for _, free := range []func(string) (uint64, error){func(string) (uint64, error) { return 0, nil }, func(string) (uint64, error) { return 0, errors.New("unavailable") }} {
		if backupPalworldMods(game, dest, palworldProtectedPaths{}, free) == nil {
			t.Fatal("Missing disk admission accepted")
		}
		if _, err := os.Stat(dest); !os.IsNotExist(err) {
			t.Fatal("Insufficient disk partially created backup")
		}
	}
	free := func(string) (uint64, error) { return 1 << 30, nil }
	for _, name := range []string{"../outside", "operator/../elsewhere", "operator//nested", "Pal/Content/Paks", "Pal/Content", "/absolute", "C:/external"} {
		if backupPalworldMods(game, dest, palworldProtectedPaths{Mods: []string{name}}, free) == nil {
			t.Fatal("Unsafe/broad root accepted: " + name)
		}
	}
}

func TestPalworldDeletedModDirectoryAndInterruptedReceiptRecovery(t *testing.T) {
	for _, samePhase := range []bool{true, false} {
		t.Run(map[bool]string{true: "same-phase", false: "new-phase"}[samePhase], func(t *testing.T) {
			e, game := fixture(t)
			r := req("update")
			r.Platform = "windows"
			os.MkdirAll(e.journal, 0700)
			mods := filepath.Join(game.dir, "Pal/Binaries/Win64/ue4ss/Mods")
			file := filepath.Join(mods, "Operator/Scripts/main.lua")
			os.MkdirAll(filepath.Dir(file), 0700)
			os.WriteFile(file, []byte("private operator script"), 0600)
			backup := filepath.Join(e.journal, phaseID(r)+".palworld-mods")
			if err := backupConfigs(game.dir, filepath.Join(e.journal, phaseID(r)+".configs"), r.AppID); err != nil {
				t.Fatal(err)
			}
			if err := backupPalworldMods(game.dir, backup, palworldProtectedPaths{Mods: []string{"Pal/Binaries/Win64/ue4ss/Mods"}}, func(string) (uint64, error) { return 1 << 30, nil }); err != nil {
				t.Fatal(err)
			}
			// Only this temporary fixture's exact mod root is removed, simulating
			// a publisher deleting custom directories during an interrupted update.
			if err := os.RemoveAll(mods); err != nil {
				t.Fatal(err)
			}
			if err := writePrivate(filepath.Join(e.journal, phaseID(r)+".json"), record{Request: r, Mutating: true, RecoveryNeeded: true, PalworldMods: true}); err != nil {
				t.Fatal(err)
			}
			if samePhase {
				if result := terminal(t, execute(e, r)); result.Type != "error" || !result.FilesChanged {
					t.Fatal(result)
				}
			} else {
				next := r
				next.JobID = "33333333-3333-3333-3333-333333333333"
				if err := e.recoverServer(context.Background(), next); err != nil {
					t.Fatal(err)
				}
			}
			data, err := os.ReadFile(file)
			if err != nil || string(data) != "private operator script" {
				t.Fatal("Deleted custom directory not restored")
			}
			if _, err = os.Stat(backup); !os.IsNotExist(err) {
				t.Fatal("Durably recovered private streams were retained")
			}
			for _, args := range game.snapshot() {
				if contains(args, "+app_update") {
					t.Fatal("Interrupted recovery reran Steam")
				}
			}
		})
	}
}
func TestPalworldCorruptBackupFailsBeforeRestoration(t *testing.T) {
	game, journal := t.TempDir(), t.TempDir()
	file := filepath.Join(game, "Pal/Content/Paks/~mods/operator.pak")
	os.MkdirAll(filepath.Dir(file), 0700)
	os.WriteFile(file, []byte("original"), 0600)
	dest := filepath.Join(journal, "owned.palworld-mods")
	if err := backupPalworldMods(game, dest, palworldProtectedPaths{}, func(string) (uint64, error) { return 1 << 30, nil }); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(file, []byte("current"), 0600)
	os.WriteFile(filepath.Join(dest, "blob-000000"), []byte("tampered"), 0600)
	if restorePalworldMods(game, dest) == nil {
		t.Fatal("Corrupt mod backup restored")
	}
	data, _ := os.ReadFile(file)
	if string(data) != "current" {
		t.Fatal("Corrupt backup partially mutated game")
	}
}
