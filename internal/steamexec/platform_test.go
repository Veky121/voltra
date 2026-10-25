package steamexec

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"voltra/internal/steamapi"
)

func TestWindowsPalworldPayloadRequired(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "steamapps"), 0700)
	os.WriteFile(filepath.Join(dir, "steamapps/appmanifest_2394010.acf"), []byte(manifest("200")), 0600)
	request := steamapi.Request{AppID: 2394010, Platform: "windows"}
	if build, err := readInstalledRequest(dir, request); err != nil || build != "" {
		t.Fatal("Linux manifest falsely proved Windows installation")
	}
	file := filepath.Join(dir, "Pal/Binaries/Win64/PalServer-Win64-Shipping.exe")
	os.MkdirAll(filepath.Dir(file), 0700)
	raw := make([]byte, 128)
	copy(raw, "MZ")
	binary.LittleEndian.PutUint32(raw[60:], 64)
	copy(raw[64:], "PE\x00\x00")
	binary.LittleEndian.PutUint16(raw[68:], 0x8664)
	os.WriteFile(file, raw, 0600)
	if build, err := readInstalledRequest(dir, request); err != nil || build != "200" {
		t.Fatalf("Valid fixed Windows payload rejected: %v", err)
	}
	raw[68] = 0x4c
	raw[69] = 1
	os.WriteFile(file, raw, 0600)
	if _, err := readInstalledRequest(dir, request); err == nil {
		t.Fatal("32-bit payload accepted")
	}
	if build, err := readInstalledRequest(dir, steamapi.Request{AppID: 2394010}); err != nil || build != "200" {
		t.Fatal("Legacy Linux manifest behavior changed")
	}
}

func TestWindowsMetadataPlatformSelectedBeforeAnonymousLogin(t *testing.T) {
	executor, docker := fixture(t)
	request := req("check")
	request.Platform = "windows"
	result := terminal(t, execute(executor, request))
	if result.Type != "result" || result.InstalledBuild != "" {
		t.Fatal("Windows metadata check treated Linux payload as installed")
	}
	for _, args := range docker.snapshot() {
		if len(args) == 0 || args[0] != "run" {
			continue
		}
		platform, login := -1, -1
		for index, arg := range args {
			if arg == "+@sSteamCmdForcePlatformType" {
				platform = index
			}
			if arg == "+login" {
				login = index
			}
		}
		if platform < 0 || login <= platform || args[platform+1] != "windows" {
			t.Fatal("Windows depot selection not established before login")
		}
	}
}
