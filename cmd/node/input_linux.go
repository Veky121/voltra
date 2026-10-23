//go:build linux

package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"golang.org/x/sys/unix"
)

func requireSetupHost() error {
	if os.Geteuid() != 0 {
		return errors.New("setup must run as root (sudo voltra-node setup)")
	}
	return nil
}

func readPrivateLine(ctx context.Context) (string, error) {
	// curl | sudo bash leaves stdin connected to the installer, not the user.
	// Always open the controlling terminal; never consume the script or echo a
	// credential on a pipe when no private terminal is available.
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return "", errors.New("no controlling terminal; run sudo voltra-node setup from an interactive terminal")
	}
	defer tty.Close()
	return readPrivateTerminal(ctx, tty)
}

func readPrivateTerminal(ctx context.Context, tty *os.File) (string, error) {
	fd := int(tty.Fd())
	term, err := unix.IoctlGetTermios(fd, unix.TCGETS)
	if err != nil {
		return "", errors.New("cannot configure private terminal input; use an interactive terminal")
	}
	private := *term
	private.Lflag &^= unix.ECHO | unix.ECHONL
	if err := unix.IoctlSetTermios(fd, unix.TCSETS, &private); err != nil {
		return "", errors.New("cannot disable terminal echo")
	}
	defer unix.IoctlSetTermios(fd, unix.TCSETS, term)
	defer fmt.Fprintln(tty)
	type input struct {
		line string
		err  error
	}
	done := make(chan input, 1)
	go func() {
		line, err := bufio.NewReader(io.LimitReader(tty, 8193)).ReadString('\n')
		if err == io.EOF && line != "" {
			err = nil
		}
		if len(line) > 8192 {
			err = errors.New("connection string exceeds input limit")
		}
		done <- input{line, err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case value := <-done:
		return value.line, value.err
	}
}
