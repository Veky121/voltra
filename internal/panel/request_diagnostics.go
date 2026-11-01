package panel

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime"
	"time"

	"github.com/google/uuid"
)

type diagnosticRequestKey struct{}

// Record the handler that rejected a request without logging its arguments.
func diagnosticFailureCaller() string {
	pc, _, _, ok := runtime.Caller(2)
	if ok {
		if fn := runtime.FuncForPC(pc); fn != nil {
			return fn.Name()
		}
	}
	return "unknown"
}

// Always generate our own reference: incoming headers are not trusted log data.
func beginRequestDiagnostics(w http.ResponseWriter, r *http.Request) (*http.Request, func(*http.Request)) {
	id := uuid.NewString()
	w.Header().Set("X-Request-ID", id)
	r = r.WithContext(context.WithValue(r.Context(), diagnosticRequestKey{}, id))
	started := time.Now()
	return r, func(completed *http.Request) {
		// Patterns omit query strings, file names, tokens and user-provided path values.
		slog.Debug("panel request completed", "request_id", id, "method", completed.Method, "route", completed.Pattern, "duration_ms", time.Since(started).Milliseconds())
	}
}

func diagnosticRequestID(ctx context.Context) string {
	id, _ := ctx.Value(diagnosticRequestKey{}).(string)
	return id
}

// Classify transport failures without returning addresses, credentials or URLs.
func daemonConnectionFailure(err error) *APIError {
	var network net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &network) && network.Timeout() {
		return &APIError{Status: 504, Code: "DaemonTimeoutException", Detail: "The server node did not respond in time. Check the server's current state before retrying; the action may still be running. If this continues, ask an administrator to check the node connection."}
	}
	if errors.Is(err, context.Canceled) {
		return &APIError{Status: 502, Code: "DaemonInterruptedException", Detail: "The request to the server node was interrupted. Check the server's current state before trying the action again."}
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return &APIError{Status: 502, Code: "DaemonDNSException", Detail: "Voltra could not resolve the server node's address. Ask an administrator to check the node hostname and DNS configuration."}
	}
	return &APIError{Status: 502, Code: "DaemonConnectionException", Detail: "Voltra could not connect to the server node. Ask an administrator to check that the node is online and its connection is configured. Check the server's current state before retrying an action."}
}
