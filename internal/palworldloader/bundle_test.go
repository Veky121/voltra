package palworldloader

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalPublicSourceBundle(t *testing.T) {
	files, err := Files()
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string]string{"palworld-loader-install.py": "palworld-loader-install.py", "palworld-loader-pins.json": "palworld-loader-pins.json", "steam_template.py": "steam-template.py"} {
		expected, err := os.ReadFile(filepath.Join("..", "panel", "game_library", "scripts", source))
		if err != nil || !bytes.Equal(expected, files[name]) {
			t.Fatal("Canonical loader source drift: " + name)
		}
	}
	var pin struct {
		Archive struct {
			SHA   string `json:"sha256"`
			Bytes int    `json:"bytes"`
		} `json:"archive"`
	}
	if json.Unmarshal(files["palworld-loader-pins.json"], &pin) != nil || pin.Archive.SHA != "f7543d57f8fdf5eab3731ac52121e6e7ff142fb3bfa17156e931037d0e44875b" || pin.Archive.Bytes != 8631290 {
		t.Fatal("Reviewed public archive pin differs")
	}
	exe := files["runtime-probe.exe"]
	if len(exe) < 64 || string(exe[:2]) != "MZ" {
		t.Fatal("Missing harmless Windows probe")
	}
	shell, err := PreflightShell()
	if err != nil || !strings.Contains(shell, "runtime.py verify") || strings.Contains(shell, "-p ") {
		t.Fatal("Unsafe/missing native preflight")
	}
}
func TestImmutableStageRejectsCorruptionAndUnknownMembers(t *testing.T) {
	parent := t.TempDir()
	first, err := Stage(parent)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Stage(parent)
	if err != nil || first != second {
		t.Fatal("Public bundle not reused")
	}
	target := filepath.Join(first, "runtime.py")
	os.Chmod(first, 0o755)
	os.Chmod(target, 0o644)
	os.WriteFile(target, []byte("corrupt"), 0o644)
	if _, err = Stage(parent); err == nil {
		t.Fatal("Corrupt published bundle accepted")
	}
	if _, err = Stage("relative"); err == nil {
		t.Fatal("Unconfined public bundle accepted")
	}
}

func TestProbeSourceProvenanceAndIndependentDebugOutput(t *testing.T) {
	files, err := Files()
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Probe struct {
			SourceFiles map[string]string `json:"source_files"`
		} `json:"probe"`
	}
	if json.Unmarshal(files["bundle.json"], &manifest) != nil || len(manifest.Probe.SourceFiles) != 5 {
		t.Fatal("Probe source provenance missing")
	}
	for name, expected := range manifest.Probe.SourceFiles {
		if filepath.Base(name) != name {
			t.Fatal("Unconfined probe source name")
		}
		data, err := os.ReadFile(filepath.Join("..", "..", "tools", "runtime", "palworld-runtime-probe", name))
		if err != nil || sum(data) != expected {
			t.Fatal("Probe source differs from deterministic build provenance: " + name)
		}
	}
	for _, required := range []string{"OutputDebugStringW", "VOLTRA_PALWORLD_PROBE_MAIN_ENTERED", "VOLTRA_PALWORLD_RUNTIME_IMPORTS_READY", "MISSING_RUNTIME_EXPORT"} {
		if !bytes.Contains(files["runtime-probe.exe"], []byte(required)) {
			t.Fatal("Probe lost public diagnostic channel/marker: " + required)
		}
	}
}
