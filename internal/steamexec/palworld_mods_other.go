//go:build !linux

package steamexec

import "errors"

func palworldDiskAvailable(string) (uint64, error) {
	return 0, errors.New("native Linux disk accounting required")
}
