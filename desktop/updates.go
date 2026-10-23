package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
	"golang.org/x/mod/semver"
)

type updateEngine interface {
	Check(context.Context) (*updater.Release, error)
	DownloadAndInstall(context.Context) error
	Restart(context.Context) error
}
type updateStatus struct {
	Channel          string `json:"channel"`
	State            string `json:"state"`
	Version          string `json:"version"`
	AvailableVersion string `json:"available_version,omitempty"`
	Error            string `json:"error,omitempty"`
}
type updateController struct {
	mu       sync.Mutex
	engine   updateEngine
	provider *channelProvider
	dir      string
	status   updateStatus
}

// Only the selected channel is queried. Stable rejects prereleases even if a
// carrier feed is mispublished. Signed bytes must also come from version assets.
type channelProvider struct{ base, channel string }

func (p *channelProvider) Name() string { return "voltra" }
func validChannel(s string) bool        { return s == "stable" || s == "beta" || s == "nightly" }
func releaseChannel(v string) string {
	v = "v" + strings.TrimPrefix(v, "v")
	if !semver.IsValid(v) {
		return ""
	}
	pre := semver.Prerelease(v)
	if pre == "" {
		return "stable"
	}
	if strings.HasPrefix(pre, "-beta.") {
		return "beta"
	}
	if strings.HasPrefix(pre, "-nightly.") {
		return "nightly"
	}
	return ""
}
func (p *channelProvider) endpoint() (*endpoint.Provider, error) {
	return endpoint.New(endpoint.Config{URL: strings.ReplaceAll(p.base, "{{channel}}", p.channel), Channel: p.channel})
}
func (p *channelProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	ep, err := p.endpoint()
	if err != nil {
		return nil, err
	}
	rel, err := ep.Check(ctx, req)
	if err != nil || rel == nil {
		return rel, err
	}
	if rel.Channel != p.channel || releaseChannel(rel.Version) != p.channel {
		return nil, errors.New("update feed version does not match selected channel")
	}
	raw, _ := rel.Metadata["endpoint.artifact.url"].(string)
	u, err := url.Parse(raw)
	want := "/Veky121/voltra/releases/download/v" + rel.Version + "/"
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || !strings.HasPrefix(u.Path, want) || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("update must reference a version-tagged Voltra HTTPS release artifact")
	}
	if rel.Verification == nil || rel.Verification.SignatureAlgo != "ed25519" || len(rel.Verification.Signature) != ed25519.SignatureSize || rel.Verification.DigestAlgo != "sha256" || len(rel.Verification.Digest) != 32 {
		return nil, errors.New("update requires SHA-256 and an Ed25519 signature")
	}
	return rel, nil
}
func (p *channelProvider) Download(ctx context.Context, rel *updater.Release, w io.Writer, progress func(int64, int64)) error {
	ep, err := p.endpoint()
	if err != nil {
		return err
	}
	return ep.Download(ctx, rel, w, progress)
}
func loadUpdateChannel(dir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(dir, "updates.json"))
	if errors.Is(err, os.ErrNotExist) {
		return "stable", nil
	}
	if err != nil {
		return "", err
	}
	var v struct {
		Channel string `json:"channel"`
	}
	if json.Unmarshal(b, &v) != nil || !validChannel(v.Channel) {
		return "", errors.New("invalid saved update channel")
	}
	return v.Channel, nil
}
func (c *updateController) snapshot() updateStatus { c.mu.Lock(); defer c.mu.Unlock(); return c.status }
func (c *updateController) changeChannel(channel string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !validChannel(channel) {
		return errors.New("choose stable, beta, or nightly")
	}
	if c.status.State == "ready" {
		return errors.New("restart to apply the staged update before changing channel")
	}
	b, _ := json.Marshal(map[string]string{"channel": channel})
	// Atomic replacement keeps preferences separate from the protected session.
	tmp, err := os.CreateTemp(c.dir, "updates-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.Write(b)
	}
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(tmp.Name(), filepath.Join(c.dir, "updates.json")); err != nil {
		return err
	}
	c.provider.channel = channel
	c.status = updateStatus{Channel: channel, State: "idle", Version: version}
	return nil
}
func (c *updateController) action(action string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	c.status.Error = ""
	var err error
	switch action {
	case "check":
		if c.status.State == "ready" {
			return errors.New("an update is already staged; restart to apply it")
		}
		c.status.AvailableVersion = ""
		var rel *updater.Release
		rel, err = c.engine.Check(ctx)
		c.status.State = "up-to-date"
		if err == nil && rel != nil {
			c.status.State = "available"
			c.status.AvailableVersion = rel.Version
		}
	case "install":
		if c.status.State != "available" {
			return errors.New("check for an available update before installing")
		}
		err = c.engine.DownloadAndInstall(ctx)
		if err == nil {
			c.status.State = "ready"
		}
	case "restart":
		if c.status.State != "ready" {
			return errors.New("download and verify an update before restarting")
		}
		err = c.engine.Restart(ctx)
	default:
		return errors.New("unknown update action")
	}
	if err != nil {
		c.status.State = "error"
		c.status.Error = err.Error()
	}
	return err
}
func configureUpdater(app *application.App, host *desktopHost) error {
	if updateManifestURL == "" && updatePublicKey == "" {
		return nil
	}
	u, err := url.Parse(strings.ReplaceAll(updateManifestURL, "{{channel}}", "stable"))
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.Fragment != "" || !strings.Contains(updateManifestURL, "{{channel}}") {
		return errors.New("updates require a GitHub HTTPS manifest URL containing {{channel}}")
	}
	key, err := base64.StdEncoding.DecodeString(updatePublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return errors.New("update public key must be base64 of 32 raw Ed25519 bytes")
	}
	channel, err := loadUpdateChannel(host.dir)
	if err != nil {
		return err
	}
	p := &channelProvider{base: updateManifestURL, channel: channel}
	// Wails' interval calls CheckAndInstall. Leave it disabled: installation
	// must follow the user's Install action, with Restart as another action.
	if err = app.Updater.Init(updater.Config{CurrentVersion: version, Providers: []updater.Provider{p}, PublicKey: key, Window: updater.WindowNone}); err != nil {
		return err
	}
	host.updates = &updateController{engine: app.Updater, provider: p, dir: host.dir, status: updateStatus{Channel: channel, State: "idle", Version: version}}
	return nil
}
func (h *desktopHost) serveUpdates(w http.ResponseWriter, r *http.Request) {
	if h.updates == nil {
		desktopError(w, 409, "Updates are not configured for this build.")
		return
	}
	if r.URL.Path == "/desktop/update-channel" {
		var input struct {
			Channel string `json:"channel"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&input) != nil {
			desktopError(w, 422, "Choose an update channel.")
			return
		}
		if err := h.updates.changeChannel(input.Channel); err != nil {
			desktopError(w, 409, err.Error())
			return
		}
	} else if r.Method == "POST" {
		action := map[string]string{"/desktop/updates": "check", "/desktop/update-install": "install", "/desktop/update-restart": "restart"}[r.URL.Path]
		if err := h.updates.action(action); err != nil {
			desktopError(w, 409, err.Error())
			return
		}
	}
	desktopJSON(w, 200, h.updates.snapshot())
}
