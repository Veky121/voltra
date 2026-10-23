package nodeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

const oldWings = `uuid: existing-node
token_id: old-id
token: OLD_WINGS_SECRET
remote: https://old.example.com
api:
  host: 0.0.0.0
  port: 9999
  upload_limit: 321
  ssl:
    enabled: true
system:
  root_directory: /srv/custom-root
  data: /srv/existing-games
  backup_directory: /srv/backups
  sftp:
    bind_address: 10.0.0.1
    bind_port: 2025
docker:
  network:
    name: existing-network
    interfaces:
      v4:
        subnet: 172.25.0.0/16
allowed_mounts: [/srv/mods]
operator_extension: keep-me
`

func writeOldNode(t *testing.T, panel string) (string, string) {
	t.Helper()
	dir := t.TempDir()
	node, wings := filepath.Join(dir, "node.json"), filepath.Join(dir, "wings.yml")
	if err := os.WriteFile(wings, []byte(oldWings), 0600); err != nil {
		t.Fatal(err)
	}
	if err := saveConfig(node, SavedConfig{Config: Config{PanelURL: panel, Token: "OLD_CONNECTOR_SECRET", WingsAddress: "127.0.0.1:8080"}, WingsConfigPath: wings}, false); err != nil {
		t.Fatal(err)
	}
	return node, wings
}

func TestReconnectEnrollmentModesAndWrongNodeLeaveFilesUntouched(t *testing.T) {
	for _, scenario := range []string{"normal-enrollment", "normal-approval", "wrong-node", "rejected", "pending-cancel"} {
		t.Run(scenario, func(t *testing.T) {
			polls, acks := 0, 0
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/remote/enroll":
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "recovery-1", "request_token": "REQUEST_SECRET", "verification_code": "123456", "expires_at": time.Now().Add(time.Minute), "recovery": scenario != "normal-enrollment"})
				case "/api/remote/enroll/recovery-1":
					polls++
					status := "approved"
					if scenario == "rejected" {
						status = "rejected"
					}
					if scenario == "pending-cancel" {
						status = "pending"
						cancel()
					}
					uuid := "existing-node"
					if scenario == "wrong-node" {
						uuid = "another-node"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "recovery": scenario != "normal-approval", "connector_token": "NEW_CONNECTOR_SECRET", "configuration": map[string]any{"uuid": uuid, "token_id": "new-id", "token": "NEW_WINGS_SECRET"}})
				default:
					acks++
					w.WriteHeader(204)
				}
			}))
			defer srv.Close()
			node, wings := writeOldNode(t, srv.URL)
			before, _ := os.ReadFile(node)
			err := Setup(ctx, SetupOptions{Reconnect: true, ReadConnection: func() (string, error) { return srv.URL + "#PAIR_SECRET", nil }, Out: &bytes.Buffer{}, ConfigPath: node, WingsConfigPath: wings, PollInterval: time.Millisecond})
			if err == nil {
				t.Fatal("unsafe reconnect succeeded")
			}
			if scenario == "wrong-node" && !strings.Contains(err.Error(), "UUID mismatch") {
				t.Fatal(err)
			}
			if scenario == "normal-enrollment" && polls != 0 {
				t.Fatal("polled a non-recovery enrollment")
			}
			after, _ := os.ReadFile(node)
			actual, _ := os.ReadFile(wings)
			if !bytes.Equal(before, after) || string(actual) != oldWings || acks != 0 {
				t.Fatal("unapproved/mismatched recovery changed configuration or acknowledged")
			}
		})
	}
}

func TestReconnectPersistsBeforeACKAndRunAutomaticallyResumesLostACK(t *testing.T) {
	acks, enrolls, prompts := 0, 0, 0
	var node, wings string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/remote/enroll":
			enrolls++
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "recovery-1", "request_token": "REQUEST_SECRET", "verification_code": "123456", "expires_at": time.Now().Add(time.Minute), "recovery": true})
		case "/api/remote/enroll/recovery-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "approved", "recovery": true, "panel_url": srv.URL, "connector_token": "NEW_CONNECTOR_SECRET", "configuration": map[string]any{"uuid": "existing-node", "token_id": "new-id", "token": "NEW_WINGS_SECRET", "system": map[string]any{"data": "/must-not-adopt"}, "docker": map[string]any{"network": "must-not-adopt"}}})
		case "/api/remote/enroll/recovery-1/complete":
			acks++
			if r.Header.Get("Authorization") != "Bearer REQUEST_SECRET" {
				t.Error("wrong ACK credential")
			}
			c, err := LoadConfig(node)
			b, _ := os.ReadFile(wings)
			if err != nil || c.Token != "NEW_CONNECTOR_SECRET" || !bytes.Equal(b, c.PendingWings) {
				t.Error("ACK before both configurations persisted")
			}
			if acks == 1 {
				w.WriteHeader(503)
				return
			}
			w.WriteHeader(204)
		case "/api/remote/connector":
			if acks != 2 || r.Header.Get("Authorization") != "Bearer NEW_CONNECTOR_SECRET" {
				t.Error("run started before ACK or used old credential")
			}
			w.WriteHeader(401) // End Run after exercising the actual resume path.
		default:
			t.Errorf("unexpected endpoint %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	node, wings = writeOldNode(t, srv.URL)
	var output bytes.Buffer
	err := Setup(context.Background(), SetupOptions{Reconnect: true, ReadConnection: func() (string, error) { prompts++; return srv.URL + "#PAIR_SECRET", nil }, Out: &output, ConfigPath: node, WingsConfigPath: wings})
	if err == nil || !strings.Contains(err.Error(), "retry completion") {
		t.Fatalf("wanted retained ACK: %v", err)
	}
	c, err := LoadConfig(node)
	if err != nil || !c.Recovery || len(c.PreviousWings) == 0 || c.RequestToken == "" {
		t.Fatalf("missing recovery journal: %v", err)
	}
	assertPreservedWings(t, wings, srv.URL)
	// Simulate interruption after saving node.json but before replacing Wings.
	if err := privateWrite(wings, []byte(oldWings), true); err != nil {
		t.Fatal(err)
	}
	err = RunSaved(context.Background(), node)
	if !errors.Is(err, errUnauthorized) {
		t.Fatalf("run resume failed: %v", err)
	}
	c, err = LoadConfig(node)
	if err != nil || c.RequestToken != "" || len(c.PreviousWings) != 0 || len(c.PendingWings) != 0 || c.NodeUUID != "existing-node" {
		t.Fatalf("bootstrap state not cleared: %v", err)
	}
	if enrolls != 1 || prompts != 1 || acks != 2 {
		t.Fatal("automatic resume enrolled or prompted again")
	}
	assertPreservedWings(t, wings, srv.URL)
	for _, secret := range []string{"PAIR_SECRET", "REQUEST_SECRET", "NEW_CONNECTOR_SECRET", "NEW_WINGS_SECRET", "OLD_WINGS_SECRET"} {
		if strings.Contains(output.String(), secret) {
			t.Fatal("output leaked credential")
		}
	}
}

func assertPreservedWings(t *testing.T, path, panel string) {
	t.Helper()
	var before, after map[string]any
	_ = yaml.Unmarshal([]byte(oldWings), &before)
	b, err := readPrivateWings(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal(b, &after); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"uuid", "system", "docker", "allowed_mounts", "operator_extension"} {
		if !reflect.DeepEqual(before[key], after[key]) {
			t.Fatalf("recovery changed %s", key)
		}
	}
	if after["token"] != "NEW_WINGS_SECRET" || after["token_id"] != "new-id" || after["remote"] != panel {
		t.Fatal("approved authentication not applied")
	}
	api := after["api"].(map[string]any)
	if api["host"] != "127.0.0.1" || api["port"] != 8080 || api["upload_limit"] != 321 || api["ssl"].(map[string]any)["enabled"] != false {
		t.Fatal("incorrect private API configuration")
	}
}

func TestRecoveryJournalRefusesConcurrentWingsChanges(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wings.yml")
	changed := []byte(strings.ReplaceAll(oldWings, "existing-node", "other-node"))
	if err := os.WriteFile(path, changed, 0600); err != nil {
		t.Fatal(err)
	}
	c := SavedConfig{Recovery: true, PreviousWings: []byte(oldWings), PendingWings: []byte("pending")}
	if err := persistWings(path, c); err == nil || !strings.Contains(err.Error(), "operator changes") {
		t.Fatal("overwrote a concurrent change", err)
	}
	b, _ := os.ReadFile(path)
	if !bytes.Equal(b, changed) {
		t.Fatal("changed Wings after refusal")
	}
}

func TestPanelErrorsAreActionableAndDoNotExposeResponse(t *testing.T) {
	for code, hint := range map[int]string{401: "expired or revoked", 404: "base URL", 409: "conflicts", 429: "rate limit", 503: "unavailable"} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(code)
				_, _ = w.Write([]byte("SERVER_SECRET"))
			}))
			defer srv.Close()
			err := request(context.Background(), "POST", srv.URL, "REQUEST_SECRET", nil, nil)
			if err == nil || !strings.Contains(err.Error(), hint) || strings.Contains(err.Error(), "SECRET") {
				t.Fatalf("unsafe/unhelpful error: %v", err)
			}
		})
	}
}

func TestSavedIdentityMismatchFailsBeforeReconnectPrompt(t *testing.T) {
	node, wings := writeOldNode(t, "https://panel.example.com")
	c, err := LoadConfig(node)
	if err != nil {
		t.Fatal(err)
	}
	c.NodeUUID = "another-node"
	if err := saveConfig(node, c, true); err != nil {
		t.Fatal(err)
	}
	prompted := false
	err = Setup(context.Background(), SetupOptions{Reconnect: true, ConfigPath: node, WingsConfigPath: wings, ReadConnection: func() (string, error) { prompted = true; return "", nil }, Out: &bytes.Buffer{}})
	if err == nil || !strings.Contains(err.Error(), "UUID does not match") || prompted {
		t.Fatalf("mismatched saved node identity accepted: %v", err)
	}
}

func TestFreshSetupRefusesRecoveryEnrollment(t *testing.T) {
	polls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/remote/enroll" {
			polls++
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"recovery": true})
	}))
	defer srv.Close()
	dir := t.TempDir()
	path := filepath.Join(dir, "node.json")
	err := Setup(context.Background(), SetupOptions{ConfigPath: path, WingsConfigPath: filepath.Join(dir, "wings.yml"), In: strings.NewReader(srv.URL + "#PAIR_SECRET"), Out: &bytes.Buffer{}})
	if err == nil || !strings.Contains(err.Error(), "mode mismatch") || polls != 0 {
		t.Fatalf("fresh setup accepted recovery: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("wrote config from recovery in fresh mode")
	}
}

func TestRunSavedResumesOriginalPendingEnrollmentACK(t *testing.T) {
	dir := t.TempDir()
	node, wings := filepath.Join(dir, "node.json"), filepath.Join(dir, "wings.yml")
	acks := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/remote/enroll/original-request/complete" {
			acks++
			if _, err := readPrivateWings(wings); err != nil {
				t.Error("ACK preceded Wings persistence")
			}
			if r.Header.Get("Authorization") != "Bearer REQUEST_SECRET" {
				t.Error("wrong ACK auth")
			}
			w.WriteHeader(204)
			return
		}
		if r.URL.Path != "/api/remote/connector" || acks != 1 || r.Header.Get("Authorization") != "Bearer CONNECTOR_SECRET" {
			t.Error("run did not ACK before connecting")
		}
		w.WriteHeader(401)
	}))
	defer srv.Close()
	c := SavedConfig{Config: Config{PanelURL: srv.URL, Token: "CONNECTOR_SECRET", WingsAddress: "127.0.0.1:8080"}, EnrollmentID: "original-request", RequestToken: "REQUEST_SECRET", EnrollmentPanelURL: srv.URL, PendingWings: []byte(oldWings), WingsConfigPath: wings}
	if err := saveConfig(node, c, false); err != nil {
		t.Fatal(err)
	}
	if err := RunSaved(context.Background(), node); !errors.Is(err, errUnauthorized) {
		t.Fatal(err)
	}
	saved, err := LoadConfig(node)
	if err != nil || saved.RequestToken != "" || len(saved.PendingWings) != 0 || acks != 1 {
		t.Fatal("original pending ACK resume regressed", err)
	}
}
