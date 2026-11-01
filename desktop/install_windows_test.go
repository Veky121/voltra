package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopShortcutCreationDoesNotOverwriteExistingLink(t *testing.T) {
	desktop := t.TempDir()
	target := filepath.Join(t.TempDir(), "Voltra.exe")
	if err := createDesktopShortcut(target, desktop); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(desktop, "Voltra.lnk")
	info, err := os.Stat(link)
	if err != nil || info.Size() == 0 {
		t.Fatalf("shortcut missing: %v", err)
	}
	// An existing user-owned link must be untouched, even if setup is called.
	if err := os.WriteFile(link, []byte("user-owned shortcut"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := createDesktopShortcut(target, desktop); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(link)
	if err != nil || string(b) != "user-owned shortcut" {
		t.Fatal("shortcut overwritten")
	}
}
