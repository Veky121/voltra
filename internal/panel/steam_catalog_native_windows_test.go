package panel

import (
	"context"
	"os/exec"
	"syscall"
	"testing"
)

func managedNativeHideWindow(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func TestSteamCatalogNativeCleanupCommandsStayHidden(t *testing.T) {
	command := managedNativeCommand(context.Background(), "docker", "inspect", "owned-fixture")
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow || command.SysProcAttr.CreationFlags&0x08000000 == 0 {
		t.Fatal("Native cleanup must never allocate a visible Windows console")
	}
}
