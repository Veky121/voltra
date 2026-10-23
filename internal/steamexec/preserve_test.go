package steamexec

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPreserveRuntimeSettingsWithoutUndoingDepotDefaults(t *testing.T) {
	for app, paths := range map[int64][]string{294420: {"serverconfig.xml", "saves/Saves/serveradmin.xml"}, 896660: {".voltra/valheim.properties", "saves/adminlist.txt"}, 2394010: {"Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"}, 1690800: {"FactoryGame/Saved/Config/LinuxServer/Engine.ini", ".config/Epic/FactoryGame/Saved/Config/LinuxServer/Game.ini"}} {
		t.Run(filepath.Base(paths[0]), func(t *testing.T) {
			dir := t.TempDir()
			protected := map[string]bool{}
			for _, path := range paths {
				protected[path] = true
			}
			all := append(append([]string{}, paths...), "DefaultPalWorldSettings.ini", "Engine/Config/BaseEngine.ini", "FactoryGame/Config/DefaultGame.ini")
			for _, path := range all {
				target := filepath.Join(dir, filepath.FromSlash(path))
				if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(target, []byte("before"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			backup := filepath.Join(t.TempDir(), "configs")
			if err := backupConfigs(dir, backup, app); err != nil {
				t.Fatal(err)
			}
			for _, path := range all {
				if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(path)), []byte("upstream update"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := restoreConfigs(dir, backup); err != nil {
				t.Fatal(err)
			}
			for _, path := range all {
				got, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(path)))
				if err != nil {
					t.Fatal(err)
				}
				want := "upstream update"
				if protected[path] {
					want = "before"
				}
				if string(got) != want {
					t.Fatalf("%s: %q want %q", path, got, want)
				}
			}
		})
	}
	if err := backupConfigs(t.TempDir(), filepath.Join(t.TempDir(), "configs"), 999); err == nil {
		t.Fatal("unknown app mutated without preservation policy")
	}
}
