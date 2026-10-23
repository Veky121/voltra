//go:build linux

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func testTerminal(t *testing.T) (*os.File, *os.File) {
	t.Helper()
	master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { master.Close() })
	if err := unix.IoctlSetPointerInt(int(master.Fd()), unix.TIOCSPTLCK, 0); err != nil {
		t.Fatal(err)
	}
	n, err := unix.IoctlGetInt(int(master.Fd()), unix.TIOCGPTN)
	if err != nil {
		t.Fatal(err)
	}
	tty, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", n), os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tty.Close() })
	return master, tty
}

func TestPrivateReadHelper(t *testing.T) {
	mode := os.Getenv("VOLTRA_PRIVATE_INPUT_TEST")
	if mode == "" {
		return
	}
	line, err := readPrivateLine(context.Background())
	if mode == "no-terminal" {
		if err == nil || !strings.Contains(err.Error(), "interactive terminal") {
			t.Fatal("private prompt accepted a pipe without a controlling terminal")
		}
		return
	}
	if err != nil || line != "https://panel.example.com#HIDDEN_SECRET\n" {
		t.Fatal("private prompt consumed stdin instead of /dev/tty")
	}
}

func TestPrivatePromptUsesControllingTTYWithPipedStdin(t *testing.T) {
	master, tty := testTerminal(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPrivateReadHelper$")
	cmd.Env = append(os.Environ(), "VOLTRA_PRIVATE_INPUT_TEST=terminal")
	cmd.Stdin = strings.NewReader("INSTALLER_SCRIPT_MUST_NOT_BE_READ\n")
	cmd.Stdout = tty
	cmd.Stderr = tty
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 1}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		state, err := unix.IoctlGetTermios(int(tty.Fd()), unix.TCGETS)
		if err != nil {
			t.Fatal(err)
		}
		if state.Lflag&unix.ECHO == 0 {
			break
		}
		if time.Now().After(deadline) {
			cmd.Wait()
			t.Fatal("child did not open a private terminal")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := master.WriteString("https://panel.example.com#HIDDEN_SECRET\n"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal("child private input failed", err)
	}
	if err := unix.SetNonblock(int(master.Fd()), true); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 8192)
	n, _ := unix.Read(int(master.Fd()), buf)
	if n <= 0 || !strings.Contains(string(buf[:n]), "PASS") || strings.Contains(string(buf[:n]), "HIDDEN_SECRET") {
		t.Fatal("private prompt failed or echoed input")
	}
}

func TestPrivatePromptRejectsPipeWithoutTerminal(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestPrivateReadHelper$")
	cmd.Env = append(os.Environ(), "VOLTRA_PRIVATE_INPUT_TEST=no-terminal")
	cmd.Stdin = strings.NewReader("https://panel.example.com#PIPE_SECRET\n")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	output, err := cmd.CombinedOutput()
	if err != nil || strings.Contains(string(output), "PIPE_SECRET") {
		t.Fatal("no-terminal private input policy failed", err)
	}
}

func TestPrivateTerminalHiddenInputAndCancellation(t *testing.T) {
	for _, cancelInput := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelInput), func(t *testing.T) {
			master, tty := testTerminal(t)
			original, err := unix.IoctlGetTermios(int(tty.Fd()), unix.TCGETS)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				line, err := readPrivateTerminal(ctx, tty)
				if !cancelInput && line != "https://panel.example.com#HIDDEN_SECRET\n" {
					err = fmt.Errorf("wrong private input")
				}
				done <- err
			}()
			deadline := time.Now().Add(time.Second)
			for {
				state, err := unix.IoctlGetTermios(int(tty.Fd()), unix.TCGETS)
				if err != nil {
					t.Fatal(err)
				}
				if state.Lflag&unix.ECHO == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("echo never disabled")
				}
				time.Sleep(time.Millisecond)
			}
			if cancelInput {
				cancel()
			} else if _, err := master.WriteString("https://panel.example.com#HIDDEN_SECRET\n"); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if cancelInput && !errors.Is(err, context.Canceled) || !cancelInput && err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("private prompt did not return")
			}
			state, _ := unix.IoctlGetTermios(int(tty.Fd()), unix.TCGETS)
			if state.Lflag != original.Lflag {
				t.Fatal("terminal settings were not restored")
			}
			if err := unix.SetNonblock(int(master.Fd()), true); err != nil {
				t.Fatal(err)
			}
			buf := make([]byte, 8192)
			n, _ := unix.Read(int(master.Fd()), buf)
			if n > 0 && strings.Contains(string(buf[:n]), "HIDDEN_SECRET") {
				t.Fatal("secret echoed to terminal")
			}
		})
	}
}
