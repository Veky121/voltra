//go:build windows

package main

import "testing"

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
		if err != nil || path != `C:\windows\system32\`+name || flags != 0 {
			t.Fatal("Real DLL lost absolute System32 confinement")
		}
	}
	for _, name := range []string{"../game.dll", `C:\game.dll`, "api-../escape.dll", "operator/name.dll", "missing", "bad\x00.dll"} {
		if _, _, err := systemLibraryRequest(name); err == nil {
			t.Fatal("Unsafe library name accepted")
		}
	}
}
