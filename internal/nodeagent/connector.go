// Package nodeagent implements approved node enrollment and an outbound Wings connector.
package nodeagent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

// Config contains credentials loaded from the private connector configuration.
// WingsAddress is fixed locally and is never accepted from a control message.
type Config struct {
	PanelURL     string                       `json:"panel_url"`
	Token        string                       `json:"token"`
	WingsAddress string                       `json:"wings_address"`
	PrivateSteam *PrivateSteamConnectorConfig `json:"-"`
}

const maxStreams = 64
const pongTimeout = 60 * time.Second
const pingInterval = 20 * time.Second

var streamID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// ValidatePanelURL allows plaintext only for literal loopback development URLs.
// DNS names other than localhost are never trusted as plaintext loopback hosts.
func ValidatePanelURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return nil, errors.New("invalid Panel URL")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || !(strings.EqualFold(u.Hostname(), "localhost") || ip != nil && ip.IsLoopback()) {
			return nil, errors.New("Panel URL requires HTTPS; HTTP is allowed only on loopback for development")
		}
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	return u, nil
}

func endpoint(base *url.URL, path string, ws bool) string {
	u := *base
	u.Path += path
	if ws {
		if u.Scheme == "https" {
			u.Scheme = "wss"
		} else {
			u.Scheme = "ws"
		}
	}
	return u.String()
}

func validateConfig(c Config) (*url.URL, error) {
	u, err := ValidatePanelURL(c.PanelURL)
	if err != nil {
		return nil, err
	}
	if c.Token == "" || strings.ContainsAny(c.Token, "\r\n") {
		return nil, errors.New("missing or invalid connector credential")
	}
	host, port, err := net.SplitHostPort(c.WingsAddress)
	if err != nil || port == "" {
		return nil, errors.New("invalid local Wings address")
	}
	ip := net.ParseIP(host)
	if !(strings.EqualFold(host, "localhost") || ip != nil && ip.IsLoopback()) {
		return nil, errors.New("Wings address must be loopback")
	}
	return u, nil
}

// Run maintains an outbound connection until ctx is cancelled or credentials are
// rejected. Temporary failures reconnect with jittered exponential backoff.
// Cancellation closes the control socket and all streams, then joins all workers.
func Run(ctx context.Context, c Config) error {
	base, err := validateConfig(c)
	if err != nil {
		return err
	}
	delay := time.Second
	steam := steamexec.New()
	for {
		if ctx.Err() != nil {
			return nil
		}
		started := time.Now()
		err := sessionWithSteam(ctx, base, c, steam)
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, errUnauthorized) {
			return err
		}
		if time.Since(started) > 30*time.Second {
			delay = time.Second
		}
		t := time.NewTimer(delay + time.Duration(rand.Int64N(int64(delay/4))))
		select {
		case <-ctx.Done():
			t.Stop()
			return nil
		case <-t.C:
		}
		delay = min(delay*2, 30*time.Second)
	}
}

var errUnauthorized = errors.New("Panel rejected connector credentials")

func dial(ctx context.Context, raw, token string) (*websocket.Conn, error) {
	d := websocket.Dialer{Proxy: http.ProxyFromEnvironment, HandshakeTimeout: 10 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 4096}
	ws, resp, err := d.DialContext(ctx, raw, http.Header{"Authorization": {"Bearer " + token}})
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	if err != nil {
		if resp != nil && (resp.StatusCode == 401 || resp.StatusCode == 403) {
			return nil, errUnauthorized
		}
		// Dial errors may contain URLs or proxy credentials; never expose them.
		return nil, errors.New("connector handshake failed")
	}
	return ws, nil
}

func keepalive(ctx context.Context, ws *websocket.Conn, done chan<- struct{}) {
	defer close(done)
	t := time.NewTicker(pingInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = ws.Close()
			return
		case <-t.C:
			if err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
				_ = ws.Close()
				return
			}
		}
	}
}

func session(ctx context.Context, base *url.URL, c Config) error {
	return sessionWithSteam(ctx, base, c, steamexec.New())
}

func sessionWithSteam(ctx context.Context, base *url.URL, c Config, steam steamRunner) error {
	ws, err := dial(ctx, endpoint(base, "/api/remote/connector", true), c.Token)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer ws.Close()
	private := NewPrivateSteamConnector(ctx, c.PrivateSteam)
	defer private.Close()
	_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := ws.WriteJSON(struct {
		Type         string   `json:"type"`
		Capabilities []string `json:"capabilities"`
		PanelOrigin  string   `json:"panel_origin"`
	}{Type: "hello", Capabilities: append(append(steamCapabilities(), NetworkCapability), private.Capabilities()...), PanelOrigin: strings.TrimRight(c.PanelURL, "/")}); err != nil {
		return errors.New("connector capability advertisement failed")
	}
	_ = ws.SetWriteDeadline(time.Time{})
	ws.SetReadLimit(4096)
	_ = ws.SetReadDeadline(time.Now().Add(pongTimeout))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(pongTimeout)) })
	heartbeatDone := make(chan struct{})
	go keepalive(ctx, ws, heartbeatDone)
	var workers sync.WaitGroup
	var mu sync.Mutex
	active := make(map[string]bool)
	defer func() { cancel(); _ = ws.Close(); private.Close(); workers.Wait(); <-heartbeatDone }()
	for {
		var msg struct {
			Type         string                       `json:"type"`
			ID           string                       `json:"id"`
			Service      string                       `json:"service"`
			PrivateGrant *steamapi.PrivateStreamGrant `json:"private_grant,omitempty"`
		}
		if err := ws.ReadJSON(&msg); err != nil {
			return errors.New("connector control connection closed")
		}
		if msg.Type != "open" || !streamID.MatchString(msg.ID) || (msg.Service != "" && msg.Service != "steam" && msg.Service != "network" && msg.Service != steamapi.PrivateStreamService) || msg.Service == steamapi.PrivateStreamService && (msg.PrivateGrant == nil || msg.PrivateGrant.Validate() != nil) || msg.Service != steamapi.PrivateStreamService && msg.PrivateGrant != nil {
			return errors.New("invalid connector control message")
		}
		mu.Lock()
		if len(active) >= maxStreams || active[msg.ID] {
			mu.Unlock()
			continue
		}
		active[msg.ID] = true
		mu.Unlock()
		workers.Add(1)
		go func(id, service string, grant *steamapi.PrivateStreamGrant) {
			defer workers.Done()
			defer func() { mu.Lock(); delete(active, id); mu.Unlock() }()
			if service == steamapi.PrivateStreamService {
				_ = private.bridge(ctx, base, c, id, *grant)
			} else if service == "network" {
				_ = bridgeNetwork(ctx, base, c, id)
			} else if service == "steam" {
				_ = bridgeSteam(ctx, base, c, id, steam)
			} else {
				_ = bridge(ctx, base, c, id)
			}
		}(msg.ID, msg.Service, msg.PrivateGrant)
	}
}

func bridgeSteam(ctx context.Context, base *url.URL, c Config, id string, runner steamRunner) error {
	ws, err := dial(ctx, endpoint(base, "/api/remote/connector/streams/"+id, true), c.Token)
	if err != nil {
		return err
	}
	stream := nodetunnel.NewConn(ws)
	defer stream.Close()
	_ = stream.SetReadDeadline(time.Now().Add(pongTimeout))
	ws.SetPongHandler(func(string) error { return stream.SetReadDeadline(time.Now().Add(pongTimeout)) })
	streamCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go keepalive(streamCtx, ws, done)
	defer func() { cancel(); <-done }()
	return serveSteam(streamCtx, stream, runner)
}

func bridge(ctx context.Context, base *url.URL, c Config, id string) error {
	local, err := (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext(ctx, "tcp", c.WingsAddress)
	if err != nil {
		return errors.New("local Wings connection failed")
	}
	defer local.Close()
	ws, err := dial(ctx, endpoint(base, "/api/remote/connector/streams/"+id, true), c.Token)
	if err != nil {
		return err
	}
	stream := nodetunnel.NewConn(ws)
	defer stream.Close()
	_ = stream.SetReadDeadline(time.Now().Add(pongTimeout))
	ws.SetPongHandler(func(string) error { return stream.SetReadDeadline(time.Now().Add(pongTimeout)) })
	streamCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go keepalive(streamCtx, ws, done)
	defer func() { cancel(); <-done }()
	copyDone := make(chan error, 2)
	go func() { _, e := io.Copy(local, stream); copyDone <- e }()
	go func() { _, e := io.Copy(stream, local); copyDone <- e }()
	remaining := 2
	select {
	case <-ctx.Done():
		err = ctx.Err()
	case err = <-copyDone:
		remaining--
	}
	_ = local.Close()
	_ = stream.Close()
	// Both copy goroutines must finish before releasing the stream slot.
	for range remaining {
		<-copyDone
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("stream closed")
	}
	return nil
}
