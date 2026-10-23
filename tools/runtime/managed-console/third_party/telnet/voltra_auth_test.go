package telnet_test

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"github.com/gorcon/telnet"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func nativeAuthPeer(t *testing.T, handle func(net.Conn) error) (string, <-chan error) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	done := make(chan error, 1)
	go func() {
		c, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(5 * time.Second))
		done <- handle(c)
	}()
	return listener.Addr().String(), done
}
func TestVoltraAuthentication1024BytesFragmentedAndOrdered(t *testing.T) {
	for index, password := range []string{strings.Repeat("a", 1024), strings.Repeat("é", 512)} {
		t.Run(fmt.Sprintf("variant%d_%d_bytes", index, len(password)), func(t *testing.T) {
			address, done := nativeAuthPeer(t, func(c net.Conn) error {
				reader := bufio.NewReader(c)
				line, err := reader.ReadString('\n')
				if err != nil {
					return err
				}
				if strings.TrimSuffix(line, "\r\n") != password {
					return errors.New("password bytes changed")
				}
				c.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
				_, err = reader.Peek(1)
				if err == nil {
					return errors.New("command sent before authentication")
				}
				if n, ok := err.(net.Error); !ok || !n.Timeout() {
					return errors.New("connection ended before authentication")
				}
				c.SetReadDeadline(time.Now().Add(3 * time.Second))
				greeting := telnet.ResponseEnterPassword + telnet.CRLF + telnet.ResponseAuthSuccess + telnet.CRLF + telnet.CRLF + telnet.ResponseWelcome + telnet.CRLF + telnet.CRLF
				for _, b := range []byte(greeting) {
					if _, err = c.Write([]byte{b}); err != nil {
						return err
					}
				}
				command, err := reader.ReadString('\n')
				if err != nil {
					return err
				}
				if command != "shutdown\r\n" {
					return errors.New("unexpected authenticated command")
				}
				io.WriteString(c, "World saved\r\n")
				return nil
			})
			var output bytes.Buffer
			err := telnet.DialInteractive(strings.NewReader("shutdown\n"), &output, address, password, telnet.SetDialTimeout(2*time.Second))
			if err != nil {
				t.Fatal("supported password authentication failed:", err)
			}
			if err = <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestVoltraAuthenticationRejectionAndEOF(t *testing.T) {
	for _, response := range []string{telnet.ResponseAuthIncorrectPassword, "", telnet.ResponseAuthSuccess + "\r\npartial"} {
		address, done := nativeAuthPeer(t, func(c net.Conn) error {
			if _, err := bufio.NewReader(c).ReadString('\n'); err != nil {
				return err
			}
			_, err := io.WriteString(c, response)
			return err
		})
		_, err := telnet.Dial(address, "private-fixture", telnet.SetDialTimeout(time.Second))
		if err == nil || strings.Contains(err.Error(), "private-fixture") {
			t.Fatal("authentication accepted incomplete/rejected response or leaked password")
		}
		if response == telnet.ResponseAuthIncorrectPassword && !errors.Is(err, telnet.ErrAuthFailed) {
			t.Fatal("rejection was not identified")
		}
		if e := <-done; e != nil {
			t.Fatal(e)
		}
	}
}
func TestVoltraPasswordByteBoundSeparateFromCommandLimit(t *testing.T) {
	for _, password := range []string{strings.Repeat("a", 1025), strings.Repeat("é", 513)} {
		address, done := nativeAuthPeer(t, func(c net.Conn) error { _, err := io.Copy(io.Discard, c); return err })
		_, err := telnet.Dial(address, password, telnet.SetDialTimeout(time.Second))
		if !errors.Is(err, telnet.ErrPasswordTooLong) {
			t.Fatal("UTF8 byte boundary was not enforced")
		}
		<-done
	}
	if telnet.MaxPasswordBytes != 1024 || telnet.MaxCommandLen != 1000 {
		t.Fatal("authentication and command limits were conflated")
	}
}
