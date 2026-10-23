//go:build !windows

package main

import "errors"

func protect([]byte) ([]byte, error) {
	return nil, errors.New("Saved desktop connections currently require Windows protected storage.")
}
func unprotect([]byte) ([]byte, error) {
	return nil, errors.New("Saved desktop connections currently require Windows protected storage.")
}
