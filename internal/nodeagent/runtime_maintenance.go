package nodeagent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"voltra/internal/nodetunnel"
	"voltra/internal/steamexec"
)

const RuntimeMaintenanceCapability = "runtime-maintenance-v1"

type runtimeMaintainer interface {
	ClientStatus() steamexec.ClientStatus
	RequestClientCheck() error
	SetClientSchedule(bool) error
}

func runtimeCapabilities(runner steamRunner) []string {
	if _, ok := runner.(runtimeMaintainer); ok && steamexec.Supported() {
		return []string{RuntimeMaintenanceCapability}
	}
	return nil
}

func runtimeHandler(runner runtimeMaintainer) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(code int, detail string) {
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": detail})
		}
		if r.URL.RawQuery != "" {
			fail(400, "Runtime maintenance does not accept query parameters")
			return
		}
		if r.Method == "GET" && r.URL.Path == "/steamcmd" {
			_ = json.NewEncoder(w).Encode(runner.ClientStatus())
			return
		}
		if r.Method == "POST" && r.URL.Path == "/steamcmd/schedule" {
			dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
			dec.DisallowUnknownFields()
			var body struct {
				Enabled *bool `json:"enabled"`
			}
			var extra any
			if dec.Decode(&body) != nil || body.Enabled == nil || dec.Decode(&extra) != io.EOF {
				fail(400, "Supply enabled as a boolean")
				return
			}
			if err := runner.SetClientSchedule(*body.Enabled); err != nil {
				code := 503
				if errors.Is(err, steamexec.ErrClientBusy) {
					code = 409
				}
				fail(code, err.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(runner.ClientStatus())
			return
		}
		if r.Method != "POST" || r.URL.Path != "/steamcmd/check" {
			fail(404, "Unknown runtime maintenance operation")
			return
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		dec.DisallowUnknownFields()
		var body struct{}
		err := dec.Decode(&body)
		// Check accepts no inputs. Reject supplied settings, paths or trailing JSON.
		if err != io.EOF {
			if err != nil {
				fail(400, "SteamCMD check accepts an empty object")
				return
			}
			var extra any
			if dec.Decode(&extra) != io.EOF {
				fail(400, "SteamCMD check accepts one empty object")
				return
			}
		}
		if err = runner.RequestClientCheck(); err != nil {
			status := 503
			if errors.Is(err, steamexec.ErrClientBusy) {
				status = 409
			}
			fail(status, err.Error())
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(runner.ClientStatus())
	})
}

func serveRuntime(ctx context.Context, c net.Conn, runner runtimeMaintainer) error {
	l := &singleStreamListener{conn: c, done: make(chan struct{})}
	var handlers sync.WaitGroup
	srv := &http.Server{Handler: runtimeHandler(runner), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 8 * time.Second, MaxHeaderBytes: 4096, BaseContext: func(net.Listener) context.Context { return ctx }, ConnState: func(_ net.Conn, s http.ConnState) {
		if s == http.StateNew {
			handlers.Add(1)
		}
		if s == http.StateClosed {
			_ = l.Close()
			handlers.Done()
		}
	}}
	srv.SetKeepAlivesEnabled(false)
	stop := context.AfterFunc(ctx, func() { _ = srv.Close(); _ = l.Close() })
	defer stop()
	err := srv.Serve(l)
	handlers.Wait()
	if errors.Is(err, net.ErrClosed) || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func bridgeRuntime(ctx context.Context, base *url.URL, c Config, id string, runner steamRunner) error {
	maintenance, ok := runner.(runtimeMaintainer)
	if !ok {
		return errors.New("node build does not support runtime maintenance")
	}
	ws, err := dial(ctx, endpoint(base, "/api/remote/connector/streams/"+id, true), c.Token)
	if err != nil {
		return err
	}
	ws.SetReadLimit(nodetunnel.MaxMessageSize)
	stream := nodetunnel.NewConn(ws)
	defer stream.Close()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return serveRuntime(ctx, stream, maintenance)
}
