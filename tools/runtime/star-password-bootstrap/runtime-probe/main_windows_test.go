//go:build windows

package main

import (
	"encoding/json"
	"testing"
)

// Pure search-policy fixtures; never load a Windows library or run main.
func TestSystemLibrarySearchPolicy(t *testing.T) {
	for _, name := range []string{"api-ms-win-crt-string-l1-1-0.dll", "ext-ms-win-sample-l1-1-0.dll"} {
		path, flags, err := systemLibraryRequest(name)
		if err != nil || path != name || flags != 0x800 {
			t.Fatal("API-set contracts must use only the System32 loader namespace")
		}
	}
	for _, name := range []string{"kernel32.dll", "msvcp140.dll"} {
		path, flags, err := systemLibraryRequest(name)
		if err != nil || path != `C:\windows\system32\`+name || flags != 0x800 {
			t.Fatal("Real DLL lost absolute System32 confinement")
		}
	}
	for _, name := range []string{"../game.dll", `C:\game.dll`, "api-../escape.dll", "operator/name.dll", "missing", "bad\x00.dll"} {
		if _, _, err := systemLibraryRequest(name); err == nil {
			t.Fatal("Unsafe library name accepted")
		}
	}
}

func TestEmbeddedManifestIsOnlyReviewedSystemImports(t *testing.T) {
	var manifest struct {
		Imports    map[string][]string `json:"imports"`
		ArchiveSHA string              `json:"archive_sha256"`
	}
	if err := json.Unmarshal(importsJSON, &manifest); err != nil || manifest.ArchiveSHA != "b9a166a756605b21058a64cde93bcaab1a855dba3553e5c7e6ce0fa8fdfad7b9" {
		t.Fatal("Manifest provenance drift")
	}
	if len(manifest.Imports) == 0 {
		t.Fatal("Empty import manifest")
	}
	for name, symbols := range manifest.Imports {
		if name == "ue4ss.dll" || name == "dwmapi.dll" {
			t.Fatal("Probe would load a reviewed plugin instead of its dependencies")
		}
		if _, _, err := systemLibraryRequest(name); err != nil {
			t.Fatal(err)
		}
		for _, symbol := range symbols {
			if !validSymbol(symbol) {
				t.Fatal("Invalid embedded export")
			}
		}
	}
}

func TestExportValidation(t *testing.T) {
	for _, symbol := range []string{"GetProcAddress", "?example@@YAXXZ", "#1", "#65535"} {
		if !validSymbol(symbol) {
			t.Fatal("Valid public export rejected")
		}
	}
	for _, symbol := range []string{"", "bad\x00name", "bad\nname", "#0", "#65536", "#-1", "#bad"} {
		if validSymbol(symbol) {
			t.Fatal("Malformed export accepted")
		}
	}
}
