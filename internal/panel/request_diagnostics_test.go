package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestRequestDiagnosticsReferenceAndRedaction(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	r := httptest.NewRequest("POST", "/api/client/servers/private-id/files/pull?token=secret-query", nil)
	r.Header.Set("X-Request-ID", "untrusted-reference")
	w := httptest.NewRecorder()
	r, done := beginRequestDiagnostics(w, r)
	r.Pattern = "POST /api/client/servers/{server}/files/pull"
	fail(w, errors.New("password=secret-error"))
	done(r)
	id := w.Header().Get("X-Request-ID")
	if _, err := uuid.Parse(id); err != nil || diagnosticRequestID(r.Context()) != id {
		t.Fatal("missing generated reference")
	}
	var payload struct {
		Errors []struct {
			RequestID string `json:"request_id"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil || len(payload.Errors) != 1 || payload.Errors[0].RequestID != id {
		t.Fatalf("missing matching response reference: %s", w.Body.String())
	}
	for _, secret := range []string{"secret-query", "secret-error", "private-id", "untrusted-reference"} {
		if strings.Contains(logs.String()+w.Body.String(), secret) {
			t.Fatalf("leaked %s", secret)
		}
	}
	if !strings.Contains(logs.String(), id) || !strings.Contains(logs.String(), r.Pattern) {
		t.Fatal("diagnostic log is missing reference or route")
	}
}

func TestDaemonConnectionFailure(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		code   string
		status int
	}{
		{"timeout", context.DeadlineExceeded, "DaemonTimeoutException", 504},
		{"cancel", context.Canceled, "DaemonInterruptedException", 502},
		{"dns", &url.Error{Op: "Post", URL: "https://secret-token@private-node", Err: &net.DNSError{Err: "no such host", Name: "private-node"}}, "DaemonDNSException", 502},
		{"connection", errors.New("secret-token connection refused"), "DaemonConnectionException", 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := daemonConnectionFailure(tc.err)
			if err.Code != tc.code || err.Status != tc.status {
				t.Fatalf("unexpected classification: %#v", err)
			}
			if strings.Contains(err.Detail, "secret-token") || strings.Contains(err.Detail, "private-node") {
				t.Fatal("transport details exposed")
			}
		})
	}
}
