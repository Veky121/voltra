//go:build !linux

package steamexec

import (
	"context"
	"errors"
)

// Unsupported production platforms never execute Steam maintenance.
func prepareClientCacheOwner(string, uint32, uint32, bool) error {
	return errors.New("SteamCMD cache requires Linux")
}
func lockClientCache(ctx context.Context, _ string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return func() {}, nil
}
