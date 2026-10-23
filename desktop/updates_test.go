package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

type fakeUpdates struct {
	checks, installs, restarts int
	fail                       bool
}

func (f *fakeUpdates) Check(context.Context) (*updater.Release, error) {
	f.checks++
	if f.fail {
		return nil, errors.New("offline")
	}
	return &updater.Release{Version: "1.2.0"}, nil
}
func (f *fakeUpdates) DownloadAndInstall(context.Context) error { f.installs++; return nil }
func (f *fakeUpdates) Restart(context.Context) error            { f.restarts++; return nil }
func TestUpdateConsentAndPersistence(t *testing.T) {
	dir := t.TempDir()
	f := &fakeUpdates{}
	c := &updateController{dir: dir, engine: f, provider: &channelProvider{channel: "stable"}, status: updateStatus{Channel: "stable", State: "idle"}}
	if channel, e := loadUpdateChannel(dir); e != nil || channel != "stable" {
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
	if e := c.changeChannel("beta"); e != nil {
		t.Fatal(e)
	}
	if channel, e := loadUpdateChannel(dir); e != nil || channel != "beta" {
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
	if c.changeChannel("stable") == nil {
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
func TestEndpointSchemaAndChannelIsolation(t *testing.T) {
	v, channel := "1.2.0", "stable"
	signed := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("channel") != "stable" {
			t.Error("missing channel")
		}
		a := map[string]any{"platform": "windows", "arch": "amd64", "url": "https://github.com/Veky121/voltra/releases/download/v" + v + "/Voltra-windows-amd64.exe", "filename": "Voltra-windows-amd64.exe", "filetype": "exe", "digestAlgo": "sha256", "digest": base64.StdEncoding.EncodeToString(make([]byte, 32))}
		if signed {
			a["signatureAlgo"] = "ed25519"
			a["signature"] = base64.StdEncoding.EncodeToString(make([]byte, 64))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"schemaVersion": 1, "version": v, "channel": channel, "artifacts": []any{a}})
	}))
	defer server.Close()
	p := &channelProvider{base: server.URL, channel: "stable"}
	req := updater.CheckRequest{CurrentVersion: "1.0.0", Platform: "windows", Arch: "amd64"}
	if rel, e := p.Check(context.Background(), req); e != nil || rel == nil || len(rel.Verification.Digest) != 32 {
		t.Fatal(rel, e)
	}
	v = "2.0.0-beta.1"
	if rel, e := p.Check(context.Background(), req); e == nil || rel != nil {
		t.Fatal("stable offered prerelease")
	}
	channel = "beta"
	if rel, e := p.Check(context.Background(), req); e != nil || rel != nil {
		t.Fatal("stable queried beta")
	}
	v = "1.2.0"
	channel = "stable"
	signed = false
	if _, e := p.Check(context.Background(), req); e == nil {
		t.Fatal("unsigned offer accepted")
	}
}
