package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Set only for the setup artifact. Update payloads remain the ordinary app.
var setupMode = "false"

func desktopInstallation() (bool, error) {
	requested := setupMode == "true" || (len(os.Args) == 2 && os.Args[1] == "--install")
	if !requested {
		return false, nil
	}
	self, err := os.Executable()
	if err != nil {
		return true, err
	}
	base, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return true, err
	}
	target := filepath.Join(base, "Programs", "Voltra", "Voltra.exe")
	previous := filepath.Join(filepath.Dir(target), "previous", "Voltra.exe")
	if strings.EqualFold(filepath.Clean(self), filepath.Clean(target)) || strings.EqualFold(filepath.Clean(self), filepath.Clean(previous)) {
		return false, nil
	}
	if _, err := os.Lstat(target); err == nil {
		return true, fmt.Errorf("Voltra is already installed at %s. Open it to update. Setup leaves existing shortcuts untouched", target)
	} else if !os.IsNotExist(err) {
		return true, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return true, err
	}
	if err := copyExecutable(self, target); err != nil {
		return true, err
	}
	// Resolve the actual Desktop known folder, including redirected desktops.
	// Never overwrite an existing link, and never run this during updates.
	desktop, err := windows.KnownFolderPath(windows.FOLDERID_Desktop, 0)
	if err != nil {
		return true, err
	}
	if err := createDesktopShortcut(target, desktop); err != nil {
		return true, fmt.Errorf("Voltra installed at %s, but shortcut creation failed: %w", target, err)
	}
	launch := exec.Command(target)
	launch.Dir = filepath.Dir(target)
	if err := launch.Start(); err != nil {
		return true, err
	}
	_ = launch.Process.Release()
	return true, nil
}

func createDesktopShortcut(target, desktop string) error {
	script := `$ErrorActionPreference = 'Stop'; $link = Join-Path $env:VOLTRA_INSTALL_DESKTOP 'Voltra.lnk'; if (!(Test-Path -LiteralPath $link)) { $shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($link); $shortcut.TargetPath = $env:VOLTRA_INSTALL_TARGET; $shortcut.WorkingDirectory = Split-Path -LiteralPath $env:VOLTRA_INSTALL_TARGET; $shortcut.IconLocation = $env:VOLTRA_INSTALL_TARGET + ',0'; $shortcut.Save() }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "VOLTRA_INSTALL_TARGET="+target, "VOLTRA_INSTALL_DESKTOP="+desktop)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %w", output, err)
	}
	return nil
}

func showInstallError(err error) {
	message, _ := windows.UTF16PtrFromString(err.Error())
	title, _ := windows.UTF16PtrFromString("Voltra setup")
	_, _, _ = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
}
