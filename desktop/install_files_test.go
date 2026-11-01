package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPreviousVersionRetentionAcrossUpdatesAndFailedRestart(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "Voltra.exe")
	write := func(path, value string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	read := func(path string) string {
		t.Helper()
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	previous := filepath.Join(dir, "previous", "Voltra.exe")
	write(exe, "version one")
	if err := stagePreviousExecutable(exe); err != nil {
		t.Fatal(err)
	}
	write(exe, "version two")
	if err := acceptPreviousExecutable(exe); err != nil {
		t.Fatal(err)
	}
	if read(previous) != "version one" {
		t.Fatal("first backup lost")
	}
	// Restart fails and the same version is opened again.
	if err := stagePreviousExecutable(exe); err != nil {
		t.Fatal(err)
	}
	if err := acceptPreviousExecutable(exe); err != nil {
		t.Fatal(err)
	}
	if read(previous) != "version one" {
		t.Fatal("failed restart replaced backup")
	}
	// Retry, then accept a new version. Only its immediate predecessor stays.
	if err := stagePreviousExecutable(exe); err != nil {
		t.Fatal(err)
	}
	write(exe, "version three")
	if err := acceptPreviousExecutable(exe); err != nil {
		t.Fatal(err)
	}
	if read(previous) != "version two" {
		t.Fatal("wrong previous version")
	}
	entries, err := os.ReadDir(filepath.Dir(previous))
	if err != nil || len(entries) != 1 {
		t.Fatalf("extra backups: %v, %v", entries, err)
	}
}

func TestAsideCleanupPreservesUnrelatedFiles(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "Voltra.exe")
	for _, name := range []string{"Voltra.exe", "Voltra.exe.old.123", "Voltra.exe.old.notes", "Other.exe.old.123"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "Voltra.exe.old.456"), 0700); err != nil {
		t.Fatal(err)
	}
	cleanUpdateAsides(exe)
	if _, err := os.Stat(exe + ".old.123"); !os.IsNotExist(err) {
		t.Fatal("numeric aside remained")
	}
	for _, name := range []string{"Voltra.exe", "Voltra.exe.old.notes", "Other.exe.old.123", "Voltra.exe.old.456"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestInstallCopyDoesNotOverwrite(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "setup.exe"), filepath.Join(dir, "Voltra.exe")
	if err := os.WriteFile(source, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyExecutable(source, target); err == nil {
		t.Fatal("overwrote existing app")
	}
	b, err := os.ReadFile(target)
	if err != nil || string(b) != "existing" {
		t.Fatal("existing app changed")
	}
}
