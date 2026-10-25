//go:build !linux

package steamexec

import "errors"

func (*PrivateWorkerBundle) verify(string, string) error {
	return errors.New("private Steam requires Linux")
}
