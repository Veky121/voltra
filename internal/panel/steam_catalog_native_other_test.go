//go:build !windows

package panel

import "os/exec"

func managedNativeHideWindow(command *exec.Cmd) {}
