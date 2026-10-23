package telnet

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// MaxCommandLen is an artificial restriction, but it will help in case of
// random large queries.
const MaxCommandLen = 1000

// MaxPasswordBytes is separate from the artificial command-length limit.
const MaxPasswordBytes = 1024

// DefaultDialTimeout provides default auth timeout to remote server.
const DefaultDialTimeout = 5 * time.Second

// DefaultExitCommand provides default TELNET exit command.
const DefaultExitCommand = "exit"

// ForcedExitCommand provides forced TELNET exit command.
const ForcedExitCommand = ":q"

// CRLF moves the cursor to the next line and then moves it to the beginning.
const CRLF = "\r\n"

// NullString is a null byte in string format.
const NullString = "\x00"

// ReceiveWaitPeriod is a delay to receive data from the server.
const ReceiveWaitPeriod = 3 * time.Millisecond

// ExecuteTickTimeout is execute read timeout.
const ExecuteTickTimeout = 1 * time.Second

// Remote server response messages.
const (
	ResponseEnterPassword         = "Please enter password"
	ResponseAuthSuccess           = "Logon successful."
	ResponseAuthIncorrectPassword = "Password incorrect, please enter password:"
	ResponseAuthTooManyFails      = "Too many failed login attempts!"
	ResponseWelcome               = "Press 'help' to get a list of all commands. Press 'exit' to end session."

	// ResponseINFLayout is the template for the logline about the command
	// received by the server.
	ResponseINFLayout = "INF Executing command '%s' by Telnet from %s"
)

var (
	// ErrAuthFailed is returned when 7 Days to Die server rejected
	// sent password.
	ErrAuthFailed = errors.New("authentication failed")

	// ErrAuthUnexpectedMessage is returned when 7 Days to Die server responses
	// without ResponseAuthSuccess or ResponseAuthIncorrectPassword
	// on auth request.
	ErrAuthUnexpectedMessage = errors.New("unexpected authentication response")

	// ErrCommandTooLong is returned when executed command length is bigger
	// than MaxCommandLen characters.
	ErrCommandTooLong = errors.New("command too long")

	// ErrCommandEmpty is returned when executed command length equal 0.
	ErrCommandEmpty    = errors.New("command too small")
	ErrPasswordTooLong = errors.New("password exceeds supported byte limit")
	ErrPasswordInvalid = errors.New("invalid password encoding or line delimiter")

	// ErrMultiErrorOccurred is returned when close connection failed with
	// error after auth failed.
	ErrMultiErrorOccurred = errors.New("an error occurred while handling another error")
)

// Conn is TELNET connection.
type Conn struct {
	conn     net.Conn
	settings Settings
	reader   io.Reader
	writer   io.Writer
	buffer   *bytes.Buffer
	status   string
	authRaw  []byte
	mu       sync.Mutex
	readDone chan struct{}
}

// Dial creates a new authorized TELNET connection.
func Dial(address string, password string, options ...Option) (*Conn, error) {
	settings := DefaultSettings

	for _, option := range options {
		option(&settings)
	}

	conn, err := net.DialTimeout("tcp", address, settings.dialTimeout)
	if err != nil {
		// Failed to open TCP conn to the server.
		return nil, fmt.Errorf("telnet: %w", err)
	}

	client := Conn{conn: conn, settings: settings, reader: conn, writer: conn, buffer: new(bytes.Buffer)}

	if err := client.auth(password); err != nil {
		// Failed to auth conn with the server.
		if err2 := client.Close(); err2 != nil {
			//nolint:errorlint // TODO: Come up with the better wrapping
			return &client, fmt.Errorf("%w: %v. Previous error: %v", ErrMultiErrorOccurred, err2, err)
		}

		return &client, err
	}
	client.readDone = make(chan struct{})
	go func() { defer close(client.readDone); client.processReadResponse(client.buffer) }()

	return &client, nil
}

// DialInteractive parses commands from input reader, executes them on remote
// server and writes responses to output writer. Password can be empty string.
// In this case password will be prompted in an interactive window.
func DialInteractive(r io.Reader, w io.Writer, address string, password string, options ...Option) error {
	settings := DefaultSettings

	for _, option := range options {
		option(&settings)
	}

	conn, err := net.DialTimeout("tcp", address, settings.dialTimeout)
	if err != nil {
		// Failed to open TCP conn to the server.
		return fmt.Errorf("telnet: %w", err)
	}

	client := Conn{conn: conn, settings: settings, reader: conn, writer: conn}
	defer client.Close()

	if password != "" {
		if err := client.auth(password); err != nil {
			return err
		}
		if _, err := w.Write(client.authRaw); err != nil {
			return err
		}
	}
	client.readDone = make(chan struct{})
	go func() { defer close(client.readDone); client.processReadResponse(w) }()

	return client.interactive(r)
}

// Execute sends command string to execute to the remote TELNET server.
func (c *Conn) Execute(command string) (string, error) {
	if command == "" {
		return "", ErrCommandEmpty
	}

	response, err := c.execute(command)
	if err != nil {
		return response, err
	}

	if c.settings.clearResponse {
		responseINFMessage := fmt.Sprintf(ResponseINFLayout+CRLF, command, c.LocalAddr().String())
		if tmp := strings.Split(response, responseINFMessage); len(tmp) > 1 {
			return tmp[1], err
		}
	}

	return response, err
}

// LocalAddr returns the local network address.
func (c *Conn) LocalAddr() net.Addr {
	return c.conn.LocalAddr()
}

// RemoteAddr returns the remote network address.
func (c *Conn) RemoteAddr() net.Addr {
	return c.conn.RemoteAddr()
}

// Status returns server info status after auth request.
func (c *Conn) Status() string {
	return c.status
}

// Close closes the client connection.
func (c *Conn) Close() error {
	_, _ = c.write([]byte(c.settings.exitCommand + CRLF))

	time.Sleep(ReceiveWaitPeriod)

	err := c.conn.Close()
	if c.readDone != nil {
		<-c.readDone
	}
	return err
}

// auth authenticates client for the next requests.
func (c *Conn) auth(password string) error {
	if len(password) > MaxPasswordBytes {
		return ErrPasswordTooLong
	}
	if !utf8.ValidString(password) || strings.ContainsAny(password, "\r\n\x00") {
		return ErrPasswordInvalid
	}
	timeout := c.settings.dialTimeout
	if timeout <= 0 {
		timeout = DefaultDialTimeout
	}
	if err := c.conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return err
	}
	defer c.conn.SetReadDeadline(time.Time{})
	if _, err := c.write([]byte(password + CRLF)); err != nil {
		return err
	}
	// Complete the authenticated greeting before accepting commands. Responses
	// can be fragmented and never appear in authentication diagnostics.
	var response strings.Builder
	one := make([]byte, 1)
	for response.Len() < 64<<10 {
		n, err := c.reader.Read(one)
		if n > 0 {
			response.Write(one[:n])
			text := response.String()
			if strings.Contains(text, ResponseAuthIncorrectPassword) || strings.Contains(text, ResponseAuthTooManyFails) {
				return ErrAuthFailed
			}
			if strings.Contains(text, ResponseAuthSuccess) && strings.Contains(text, ResponseWelcome) && strings.HasSuffix(text, CRLF+CRLF) {
				c.authRaw = []byte(text)
				c.status = text
				break
			}
		}
		if err != nil {
			return ErrAuthUnexpectedMessage
		}
	}
	if c.authRaw == nil {
		return ErrAuthUnexpectedMessage
	}

	c.status = strings.TrimPrefix(c.status, ResponseEnterPassword+CRLF+ResponseAuthSuccess)
	c.status = strings.TrimSuffix(c.status, CRLF+CRLF+ResponseWelcome)
	c.status = strings.TrimSpace(c.status)

	return nil
}

// execute sends command string to execute to the remote TELNET server.
func (c *Conn) execute(command string) (string, error) {
	if len(command) > MaxCommandLen {
		return "", ErrCommandTooLong
	}

	if _, err := c.write([]byte(command + CRLF)); err != nil {
		return "", err
	}

	time.Sleep(ExecuteTickTimeout)

	c.mu.Lock()
	response := c.buffer.String()
	*c.buffer = bytes.Buffer{}
	c.mu.Unlock()

	response = strings.ReplaceAll(response, NullString, "")
	response = strings.TrimSpace(response)

	return response, nil
}

// interactive reads commands from reader in terminal mode and sends them
// to execute to the remote TELNET server.
func (c *Conn) interactive(r io.Reader) error {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		command := scanner.Text()

		if command == ForcedExitCommand {
			command = c.settings.exitCommand
		}

		if _, err := c.write([]byte(command + CRLF)); err != nil {
			return err
		}

		if command == c.settings.exitCommand {
			break
		}
	}

	time.Sleep(ReceiveWaitPeriod)

	return c.Close()
}

// write sends data to established TELNET connection.
func (c *Conn) write(p []byte) (n int, err error) {
	return c.writer.Write(p)
}

// read reads structured binary data from c.conn into byte array.
func (c *Conn) read(p []byte) (n int, err error) {
	return c.reader.Read(p)
}

// processReadResponse reads response data from TELNET connection
// and writes them to writer (Stdout).
func (c *Conn) processReadResponse(writer io.Writer) {
	p := make([]byte, 1)

	for {
		// Read 1 byte.
		n, err := c.read(p)
		if n <= 0 && err == nil {
			continue
		} else if n <= 0 && err != nil {
			break
		}

		if writer == c.buffer {
			c.mu.Lock()
			_, _ = writer.Write(p)
			c.mu.Unlock()
		} else {
			_, _ = writer.Write(p)
		}
	}
}
