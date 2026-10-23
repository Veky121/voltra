//go:build !linux

package main

import (
	"context"
	"errors"
)

func requireSetupHost() error { return errors.New("node setup requires Linux and systemd") }
func readPrivateLine(context.Context) (string, error) {
	return "", errors.New("node setup requires Linux")
}
