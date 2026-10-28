package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type fakeUpdates struct {
	checks, installs, restarts int
	fail                       bool
	restartFail                bool
}

func (f *fakeUpdates) Check(context.Context) (*updater.Release, error) {
	f.checks++
	if f.fail {
		return nil, errors.New("offline")
	}
	return &updater.Release{Version: "1.2.0"}, nil
}
func (f *fakeUpdates) DownloadAndInstall(context.Context) error { f.installs++; return nil }
func (f *fakeUpdates) Restart(context.Context) error {
	f.restarts++
	if f.restartFail {
		return errors.New("restart failed")
	}
	return nil
}
func TestUpdateConsentAndPersistence(t *testing.T) {
	dir := t.TempDir()
	f := &fakeUpdates{}
	c := &updateController{dir: dir, engine: f, provider: &channelProvider{channel: "release"}, status: updateStatus{Channel: "release", State: "idle"}}
	if channel, e := loadUpdateChannel(dir); e != nil || channel != "release" {
		t.Fatal(channel, e)
	}
	if c.action("install") == nil {
		t.Fatal("installed without check")
	}
	if e := c.action("check"); e != nil {
		t.Fatal(e)
	}
	if f.installs != 0 || f.restarts != 0 || c.snapshot().State != "available" {
		t.Fatal("check installed silently")
	}
	if e := c.changeChannel("nightly"); e != nil {
		t.Fatal(e)
	}
	if channel, e := loadUpdateChannel(dir); e != nil || channel != "nightly" {
		t.Fatal(channel, e)
	}
	if c.action("install") == nil {
		t.Fatal("old channel offer retained")
	}
	if c.changeChannel("invalid") == nil {
		t.Fatal("invalid channel accepted")
	}
	if e := c.action("check"); e != nil {
		t.Fatal(e)
	}
	if e := c.action("install"); e != nil {
		t.Fatal(e)
	}
	if f.installs != 1 || f.restarts != 0 {
		t.Fatal("installation restarted silently")
	}
	if c.changeChannel("release") == nil {
		t.Fatal("changed channel with staged update")
	}
	if e := c.action("restart"); e != nil || f.restarts != 1 {
		t.Fatal(e)
	}
}
func TestUpdateCheckFailureClearsOffer(t *testing.T) {
	f := &fakeUpdates{}
	c := &updateController{engine: f}
	_ = c.action("check")
	f.fail = true
	if c.action("check") == nil || c.snapshot().AvailableVersion != "" || c.action("install") == nil {
		t.Fatal("failed check retained offer")
	}
}

func TestDevelopmentBuildCanFindBetaAndManualChecksRefreshFeed(t *testing.T) {
	requests := 0
	var previous string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Query().Get("version") != "0.0.0" {
			t.Error("development build hid published beta")
		}
		fresh := r.URL.Query().Get("check")
		if fresh == "" || fresh == previous {
			t.Error("feed check was cached")
		}
		previous = fresh
		if r.Header.Get("Cache-Control") != "no-cache" {
			t.Error("missing cache bypass")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"schemaVersion": 1, "version": "0.1.0-beta.2", "channel": "release", "artifacts": []any{map[string]any{"platform": "windows", "arch": "amd64", "url": "https://github.com/Veky121/voltra/releases/download/v0.1.0-beta.2/Voltra-windows-amd64.exe", "filename": "Voltra-windows-amd64.exe", "filetype": "exe", "digestAlgo": "sha256", "digest": base64.StdEncoding.EncodeToString(make([]byte, 32)), "signatureAlgo": "ed25519", "signature": base64.StdEncoding.EncodeToString(make([]byte, 64))}}})
	}))
	defer server.Close()
	provider := &channelProvider{base: server.URL, channel: "release"}
	for range 2 {
		release, err := provider.Check(context.Background(), updater.CheckRequest{CurrentVersion: "0.1.0-dev", Platform: "windows", Arch: "amd64"})
		if err != nil || release == nil || release.Version != "0.1.0-beta.2" {
			t.Fatal("development beta offer missing", err)
		}
	}
	if requests != 2 {
		t.Fatal("manual check did not refresh")
	}
}

func TestOfficialSignedUpdateDefaults(t *testing.T) {
	key, err := base64.StdEncoding.DecodeString(updatePublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize || updateManifestURL != "https://github.com/Veky121/voltra/releases/download/update-{{channel}}/manifest.json" {
		t.Fatal("local builds must include official signed updates")
	}
}

func TestLiveOfficialUpdateFeeds(t *testing.T) {
	if os.Getenv("VOLTRA_LIVE_UPDATE_CHECK") != "true" {
		t.Skip("opt-in public feed check")
	}
	key, err := base64.StdEncoding.DecodeString(updatePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range []string{"release", "nightly"} {
		provider := &channelProvider{base: updateManifestURL, channel: channel}
		release, err := provider.Check(context.Background(), updater.CheckRequest{CurrentVersion: "0.1.0-dev", Platform: "windows", Arch: "amd64"})
		if err != nil {
			t.Fatal(channel, err)
		}
		if release == nil {
			t.Log(channel + ": no published/newer build")
			continue
		}
		if !ed25519.Verify(key, release.Verification.Digest, release.Verification.Signature) {
			t.Fatal("release signature does not match embedded trust anchor", channel)
		}
		t.Logf("%s: %s, valid Ed25519 signature", channel, release.Version)
	}
}
func TestEndpointSchemaAndChannelIsolation(t *testing.T) {
	v, channel := "1.2.0", "release"
	selected := "release"
	artifactURL := ""
	signed := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("channel") != selected {
			t.Error("missing channel")
		}
		a := map[string]any{"platform": "windows", "arch": "amd64", "url": "https://github.com/Veky121/voltra/releases/download/v" + v + "/Voltra-windows-amd64.exe", "filename": "Voltra-windows-amd64.exe", "filetype": "exe", "digestAlgo": "sha256", "digest": base64.StdEncoding.EncodeToString(make([]byte, 32))}
		if artifactURL != "" {
			a["url"] = artifactURL
		}
		if signed {
			a["signatureAlgo"] = "ed25519"
			a["signature"] = base64.StdEncoding.EncodeToString(make([]byte, 64))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"schemaVersion": 1, "version": v, "channel": channel, "artifacts": []any{a}})
	}))
	defer server.Close()
	p := &channelProvider{base: server.URL, channel: "release"}
	req := updater.CheckRequest{CurrentVersion: "1.0.0", Platform: "windows", Arch: "amd64"}
	if rel, e := p.Check(context.Background(), req); e != nil || rel == nil || len(rel.Verification.Digest) != 32 {
		t.Fatal(rel, e)
	}
	v = "2.0.0-beta.1"
	if rel, e := p.Check(context.Background(), req); e != nil || rel == nil {
		t.Fatal("release rejected beta", e)
	}
	v = "2.0.0-nightly.1"
	if rel, e := p.Check(context.Background(), req); e == nil || rel != nil {
		t.Fatal("release offered nightly")
	}
	channel = "nightly"
	if rel, e := p.Check(context.Background(), req); e != nil || rel != nil {
		t.Fatal("release queried nightly", e)
	}
	selected = "nightly"
	p.channel = selected
	if rel, e := p.Check(context.Background(), req); e != nil || rel == nil {
		t.Fatal("nightly rejected nightly", e)
	}
	for _, candidate := range []string{"2.0.0", "2.0.0-beta.1"} {
		v = candidate
		if rel, e := p.Check(context.Background(), req); e == nil || rel != nil {
			t.Fatal("nightly accepted release build", candidate)
		}
	}
	selected = "release"
	p.channel = selected
	channel = selected
	for _, candidate := range []string{"1.0.0", "0.9.0", "1.0.0-beta.1"} {
		v = candidate
		if rel, e := p.Check(context.Background(), req); e != nil || rel != nil {
			t.Fatal("offered equal or older build", candidate, e)
		}
	}
	v = "1.2.0"
	for _, candidate := range []string{"http://github.com/Veky121/voltra/releases/download/v1.2.0/a.exe", "https://github.com/Veky121/voltra/releases/download/update-release/a.exe", "https://example.com/a.exe"} {
		artifactURL = candidate
		if rel, e := p.Check(context.Background(), req); e == nil || rel != nil {
			t.Fatal("unsafe artifact accepted", candidate)
		}
	}
	artifactURL = ""

	v = "1.2.0"
	channel = "release"
	signed = false
	if _, e := p.Check(context.Background(), req); e == nil {
		t.Fatal("unsigned offer accepted")
	}
}

func TestLegacyUpdateChannelReadPreservesDesktopData(t *testing.T) {
	for _, saved := range []string{"stable", "beta", "release", "nightly"} {
		t.Run(saved, func(t *testing.T) {
			dir := t.TempDir()
			original := []byte(`{"channel":"` + saved + `","future_setting":{"keep":true}}`)
			session := []byte("protected-session-bytes")
			if err := os.WriteFile(filepath.Join(dir, "updates.json"), original, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "session.dat"), session, 0600); err != nil {
				t.Fatal(err)
			}
			want := "release"
			if saved == "nightly" {
				want = saved
			}
			for range 2 {
				if got, err := loadUpdateChannel(dir); err != nil || got != want {
					t.Fatal(got, err)
				}
			}
			for name, wantBytes := range map[string][]byte{"updates.json": original, "session.dat": session} {
				got, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil || !bytes.Equal(got, wantBytes) {
					t.Fatal("read changed desktop data", name, err)
				}
			}
			c := &updateController{dir: dir, engine: &fakeUpdates{}, provider: &channelProvider{}, status: updateStatus{State: "idle"}}
			for _, legacy := range []string{"stable", "beta"} {
				if c.changeChannel(legacy) == nil {
					t.Fatal("API accepted legacy channel", legacy)
				}
			}
			if err := c.changeChannel(want); err != nil {
				t.Fatal(err)
			}
			if got, err := loadUpdateChannel(dir); err != nil || got != want {
				t.Fatal(got, err)
			}
			got, err := os.ReadFile(filepath.Join(dir, "session.dat"))
			if err != nil || !bytes.Equal(got, session) {
				t.Fatal("channel change altered session", err)
			}
		})
	}
	for _, invalid := range []string{`{`, `{"channel":"unknown"}`, `{}`} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "updates.json"), []byte(invalid), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadUpdateChannel(dir); err == nil {
			t.Fatal("invalid preference accepted", invalid)
		}
	}
}

func TestInvalidPreferencesDisableOnlyUpdater(t *testing.T) {
	for _, content := range []string{"{", `{"channel":"unknown"}`, "unreadable"} {
		t.Run(content, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "updates.json")
			if content == "unreadable" {
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			session := []byte("protected-session")
			os.WriteFile(filepath.Join(dir, "session.dat"), session, 0600)
			host := &desktopHost{dir: dir}
			if err := configureUpdater(nil, host); err == nil {
				t.Fatal("expected configuration error")
			}
			if host.updates == nil || host.updates.snapshot().Error == "" {
				t.Fatal("missing actionable status")
			}
			if host.updates.action("check") == nil || host.updates.changeChannel("nightly") == nil {
				t.Fatal("invalid preferences silently replaced")
			}
			if content != "unreadable" {
				got, _ := os.ReadFile(path)
				if string(got) != content {
					t.Fatal("preferences changed")
				}
			}
			got, _ := os.ReadFile(filepath.Join(dir, "session.dat"))
			if !bytes.Equal(got, session) {
				t.Fatal("session changed")
			}
		})
	}
}
func TestRestartFailureRetainsVerifiedStaging(t *testing.T) {
	f := &fakeUpdates{restartFail: true}
	c := &updateController{engine: f, status: updateStatus{State: "available", AvailableVersion: "1.2.0"}}
	if err := c.action("install"); err != nil {
		t.Fatal(err)
	}
	if c.action("restart") == nil {
		t.Fatal("expected restart error")
	}
	if s := c.snapshot(); s.State != "ready" || s.Error != "restart failed" || s.AvailableVersion != "1.2.0" {
		t.Fatal(s)
	}
	host := &desktopHost{updates: c}
	w := httptest.NewRecorder()
	host.serveUpdates(w, httptest.NewRequest("POST", "/desktop/update-restart", nil))
	var status updateStatus
	json.Unmarshal(w.Body.Bytes(), &status)
	if w.Code != 409 || status.State != "ready" || status.Error == "" {
		t.Fatal(w.Code, w.Body.String())
	}
	f.restartFail = false
	if err := c.action("restart"); err != nil {
		t.Fatal(err)
	}
	if f.installs != 1 || f.restarts != 3 || c.snapshot().Error != "" {
		t.Fatal("staged retry failed")
	}
}
func TestExplicitCrossChannelOffer(t *testing.T) {
	selected := "nightly"
	candidate := "1.0.0-nightly.1"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"schemaVersion": 1, "version": candidate, "channel": selected, "artifacts": []any{map[string]any{"url": "https://github.com/Veky121/voltra/releases/download/v" + candidate + "/a.exe", "digestAlgo": "sha256", "digest": base64.StdEncoding.EncodeToString(make([]byte, 32)), "signatureAlgo": "ed25519", "signature": base64.StdEncoding.EncodeToString(make([]byte, 64))}}})
	}))
	defer server.Close()
	p := &channelProvider{base: server.URL, channel: selected}
	req := updater.CheckRequest{CurrentVersion: "2.0.0", Platform: "windows", Arch: "amd64"}
	if rel, err := p.Check(context.Background(), req); err != nil || rel != nil {
		t.Fatal("automatic downgrade", rel, err)
	}
	c := &updateController{dir: t.TempDir(), engine: &fakeUpdates{}, provider: p, status: updateStatus{Channel: "release"}}
	if err := c.changeChannel(selected); err != nil {
		t.Fatal(err)
	}
	if rel, err := p.Check(context.Background(), req); err != nil || rel == nil {
		t.Fatal("explicit switch missing offer", err)
	}
	req.CurrentVersion = "2.0.0-nightly.2"
	if rel, err := p.Check(context.Background(), req); err != nil || rel != nil {
		t.Fatal("same channel downgrade", rel, err)
	}
	selected = "release"
	candidate = "1.0.0-beta.1"
	if err := c.changeChannel(selected); err != nil {
		t.Fatal(err)
	}
	if rel, err := p.Check(context.Background(), req); err != nil || rel == nil {
		t.Fatal("reverse switch missing offer", err)
	}
}
func TestUpdateHTTPDeadlinesAndStreaming(t *testing.T) {
	manifest, download := updateHTTPClient(false), updateHTTPClient(true)
	if manifest.Timeout != 30*time.Second || download.Timeout != 10*time.Minute {
		t.Fatal("incorrect total timeouts")
	}
	tr := download.Transport.(*http.Transport)
	if tr.DialContext == nil || tr.TLSHandshakeTimeout <= 0 || tr.ResponseHeaderTimeout <= 0 {
		t.Fatal("unbounded connection")
	}
	// Compress the deadlines to exercise a body slower than a manifest budget.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		time.Sleep(100 * time.Millisecond)
		io.WriteString(w, "verified bytes")
	}))
	defer server.Close()
	manifest.Timeout = 30 * time.Millisecond
	download.Timeout = time.Second
	for i, client := range []*http.Client{manifest, download} {
		resp, err := client.Get(server.URL)
		if err != nil {
			t.Fatal(err)
		}
		_, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if (err == nil) != (i == 1) {
			t.Fatal("stream deadline", i, err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
	resp, err := download.Do(req)
	if err == nil {
		_, err = io.ReadAll(resp.Body)
		resp.Body.Close()
	}
	if err == nil {
		t.Fatal("ignored cancellation")
	}
}
