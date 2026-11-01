//go:build !windows

package main

func desktopInstallation() (bool, error) { return false, nil }
func showInstallError(err error)         {}
