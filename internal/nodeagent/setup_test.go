package nodeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

func TestPanelURLPolicy(t *testing.T) {
	for _, raw := range []string{"https://panel.example.com", "https://panel.example.com/base/", "http://127.0.0.1:8088", "http://[::1]:8088", "http://localhost:8088"} {
		if _, err := ValidatePanelURL(raw); err != nil {
			t.Errorf("rejected %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"http://panel.example.com", "http://192.168.1.1", "http://127.0.0.1.evil", "https://user:secret@panel.example.com", "https://example.com?token=secret", "https://example.com#secret", "file:///tmp/panel", "https://"} {
		if _, err := ValidatePanelURL(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	if _, token, err := ParseConnectionString("https://example.com#PAIR_SECRET"); err != nil || token != "PAIR_SECRET" {
		t.Fatal("connection string parsing failed")
	}
	if _, _, err := ParseConnectionString("https://example.com#secret\nextra"); err == nil {
		t.Fatal("accepted multiline token")
	}
}

func TestSetupApprovalPersistenceAndACKRecovery(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "node.json")
	wingsPath := filepath.Join(dir, "wings.yml")
	var output bytes.Buffer
	polls, completes, enrolls := 0, 0, 0
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.String(), "SECRET") {
			t.Error("secret in URL")
		}
		switch r.URL.Path {
		case "/api/remote/enroll":
			enrolls++
			var b map[string]any
			_ = json.NewDecoder(r.Body).Decode(&b)
			if b["token"] != "PAIR_SECRET" || b["hostname"] == "" || b["architecture"] != runtime.GOARCH {
				t.Error("invalid enrollment metadata")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "request-123", "request_token": "REQUEST_SECRET", "verification_code": "123-456", "expires_at": time.Now().Add(time.Minute)})
		case "/api/remote/enroll/request-123":
			if r.Header.Get("Authorization") != "Bearer REQUEST_SECRET" {
				t.Error("poll did not use unique request Bearer")
			}
			polls++
			if polls == 1 {
				fmt.Fprint(w, `{"status":"pending"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "approved", "panel_url": srv.URL, "connector_token": "CONNECTOR_SECRET", "configuration": map[string]any{"uuid": "node-uuid", "token_id": "wings-id", "token": "WINGS_SECRET", "api": map[string]any{"host": "0.0.0.0", "port": 9000}, "remote": "wrong"}})
		case "/api/remote/enroll/request-123/complete":
			completes++
			if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer REQUEST_SECRET" {
				t.Error("invalid ACK")
			}
			for _, path := range []string{configPath, wingsPath} {
				info, err := os.Stat(path)
				if err != nil {
					t.Errorf("ACK before persistence: %v", err)
					continue
				}
				if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
					t.Error("configuration is not private")
				}
			}
			if completes == 1 {
				w.WriteHeader(503)
				return
			}
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	o := SetupOptions{In: strings.NewReader(srv.URL + "#PAIR_SECRET\n"), Out: &output, ConfigPath: configPath, WingsConfigPath: wingsPath, PollInterval: time.Millisecond}
	if err := Setup(context.Background(), o); err == nil || !strings.Contains(err.Error(), "retry completion") {
		t.Fatalf("wanted recoverable ACK failure, got %v", err)
	}
	saved, err := LoadConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.RequestToken != "REQUEST_SECRET" || len(saved.PendingWings) == 0 {
		t.Fatal("lost recovery state")
	}
	// Recreate the second file from saved approval after an interrupted write.
	if err := os.Remove(wingsPath); err != nil {
		t.Fatal(err)
	}
	o.In = strings.NewReader("")
	if err := Setup(context.Background(), o); err != nil {
		t.Fatal(err)
	}
	if enrolls != 1 || completes != 2 {
		t.Fatalf("recovery enrolled again or lost ACK: enrolls=%d completes=%d", enrolls, completes)
	}
	saved, err = LoadConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Token != "CONNECTOR_SECRET" || saved.RequestToken != "" || len(saved.PendingWings) != 0 {
		t.Fatal("incorrect persisted credentials or bootstrap token retained after ACK")
	}
	wings, err := os.ReadFile(wingsPath)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := yaml.Unmarshal(wings, &config); err != nil {
		t.Fatal(err)
	}
	api := config["api"].(map[string]any)
	if api["host"] != "127.0.0.1" || api["port"] != 8080 || api["ssl"].(map[string]any)["enabled"] != false || config["remote"] != srv.URL {
		t.Fatalf("Wings is not restricted to private management: %v", api)
	}
	if !strings.Contains(output.String(), "123-456") {
		t.Fatal("verification code was not shown")
	}
	for _, secret := range []string{"PAIR_SECRET", "REQUEST_SECRET", "CONNECTOR_SECRET", "WINGS_SECRET"} {
		if strings.Contains(output.String(), secret) {
			t.Error("credential appeared in setup output")
		}
	}
}

func TestSetupTerminalStatesAndExistingWings(t *testing.T) {
	for _, status := range []string{"rejected", "expired"} {
		t.Run(status, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "request", "request_token": "request-secret", "verification_code": "123456", "expires_at": time.Now().Add(time.Minute)})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
			}))
			defer srv.Close()
			dir := t.TempDir()
			node := filepath.Join(dir, "node.json")
			err := Setup(context.Background(), SetupOptions{In: strings.NewReader(srv.URL + "#pair-secret"), Out: &bytes.Buffer{}, ConfigPath: node, WingsConfigPath: filepath.Join(dir, "wings.yml")})
			if err == nil || !strings.Contains(err.Error(), status) {
				t.Fatalf("terminal status ignored: %v", err)
			}
			if _, err := os.Stat(node); !os.IsNotExist(err) {
				t.Fatal("credentials persisted without approval")
			}
		})
	}
	dir := t.TempDir()
	wings := filepath.Join(dir, "wings.yml")
	_ = os.WriteFile(wings, []byte("existing"), 0600)
	err := Setup(context.Background(), SetupOptions{In: strings.NewReader(""), Out: &bytes.Buffer{}, ConfigPath: filepath.Join(dir, "node.json"), WingsConfigPath: wings})
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("existing Wings not protected: %v", err)
	}
	b, _ := os.ReadFile(wings)
	if string(b) != "existing" {
		t.Fatal("existing config overwritten")
	}
}

func TestEnrollmentRefusesRedirect(t *testing.T) {
	seen := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = true; w.WriteHeader(204) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer source.Close()
	err := request(context.Background(), "POST", source.URL, "REQUEST_SECRET", map[string]string{"token": "PAIR_SECRET"}, nil)
	if err == nil || seen {
		t.Fatal("followed enrollment redirect with credentials")
	}
}
