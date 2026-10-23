//go:build !linux

package steamexec

import (
	"errors"
	"os"
)

func fileOwner(os.FileInfo) (uint32, uint32, bool) { return 0, 0, false }

// Unsupported production platforms never execute maintenance.
func lockServer(string) (func(), error) { return func() {}, nil }
func syncDirectory(string) error        { return nil }
func chownBootstrap(string, os.FileInfo, uint32, uint32) error {
	return errors.New("bootstrap ownership preparation requires Linux")
}
