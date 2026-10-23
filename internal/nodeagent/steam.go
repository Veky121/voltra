package nodeagent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

type steamRunner interface {
	Run(context.Context, steamapi.Request, func(steamapi.Event) error)
}

func steamHandler(runner steamRunner) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "close")
		enc := json.NewEncoder(w)
		failure := func(status int, detail string) {
			w.WriteHeader(status)
			_ = enc.Encode(steamapi.Event{Type: "error", Stage: "failed", Detail: detail, Error: detail})
		}
		if r.Method != "POST" || r.URL.Path != "/run" || r.URL.RawQuery != "" {
			failure(404, "Steam service accepts only POST /run")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		var request steamapi.Request
		if dec.Decode(&request) != nil {
			failure(400, "invalid Steam request JSON")
			return
		}
		var trailing any
		if dec.Decode(&trailing) != io.EOF {
			failure(400, "Steam request must contain one JSON object")
			return
		}
		if err := request.Normalize(); err != nil {
			failure(400, err.Error())
			return
		}
		w.WriteHeader(200)
		if http.NewResponseController(w).Flush() != nil {
			return
		}
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		// Heartbeats ensure a vanished Panel cannot leave a helper running for
		// the entire execution timeout. Only this goroutine writes the response.
		events := make(chan steamapi.Event)
		done := make(chan struct{})
		go func() {
			defer close(done)
			runner.Run(ctx, request, func(event steamapi.Event) error {
				select {
				case events <- event:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			})
		}()
		defer func() { cancel(); <-done }()
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		terminal := false
		for {
			var event steamapi.Event
			select {
			case <-ctx.Done():
				return
			case <-done:
				if !terminal {
					_ = enc.Encode(steamapi.Event{Type: "error", Stage: "failed", Error: "Steam executor ended without a result", Detail: "Steam executor ended without a result"})
					_ = http.NewResponseController(w).Flush()
				}
				return
			case event = <-events:
				if terminal {
					continue
				}
				terminal = event.Type == "result" || event.Type == "error"
			case <-ticker.C:
				if terminal {
					continue
				}
				event = steamapi.Event{Type: "progress", Stage: "waiting", Detail: "Steam maintenance is still running."}
			}
			controller := http.NewResponseController(w)
			_ = controller.SetWriteDeadline(time.Now().Add(15 * time.Second))
			if enc.Encode(event) != nil || controller.Flush() != nil {
				return
			}
		}
	})
}

// Serve one HTTP request directly over an authenticated connector byte stream.
// net/http supplies disconnect cancellation and chunked/flushed NDJSON framing.
func serveSteam(ctx context.Context, c net.Conn, runner steamRunner) error {
	l := &singleStreamListener{conn: c, done: make(chan struct{})}
	var handlers sync.WaitGroup
	srv := &http.Server{Handler: steamHandler(runner), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 20 * time.Second, MaxHeaderBytes: 8192, BaseContext: func(net.Listener) context.Context { return ctx }, ConnState: func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			handlers.Add(1)
		}
		if state == http.StateClosed {
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

type singleStreamListener struct {
	mu       sync.Mutex
	conn     net.Conn
	accepted bool
	done     chan struct{}
	once     sync.Once
}

func (l *singleStreamListener) Accept() (net.Conn, error) {
	l.mu.Lock()
	if !l.accepted {
		l.accepted = true
		l.mu.Unlock()
		return l.conn, nil
	}
	l.mu.Unlock()
	<-l.done
	return nil, net.ErrClosed
}
func (l *singleStreamListener) Close() error {
	l.once.Do(func() { close(l.done); _ = l.conn.Close() })
	return nil
}
func (l *singleStreamListener) Addr() net.Addr { return l.conn.LocalAddr() }

func steamCapabilities() []string {
	if steamexec.Supported() {
		return steamapi.Capabilities()
	}
	return []string{}
}
