package panel

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"deps.dev/util/semver"
)

var nodeReleaseTag = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$`)
var nodeReleaseDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

const nodeReleaseRepo = "https://github.com/Veky121/voltra/releases/"
const nodeReleaseAPI = "https://api.github.com/repos/Veky121/voltra/releases"

type nodeReleaseAsset struct {
	Name, State, Digest string
	URL                 string `json:"browser_download_url"`
	Size                int64
}
type nodePublishedRelease struct {
	Tag        string `json:"tag_name"`
	Draft      bool
	Prerelease bool
	Assets     []nodeReleaseAsset
}
type nodeInstallerRelease struct {
	Version      string `json:"version"`
	Channel      string `json:"channel"`
	Source       string `json:"source"`
	ReleaseURL   string `json:"release_url"`
	InstallerURL string `json:"installer_url"`
}
type nodeReleaseCacheKey struct {
	App          *App
	Channel, Pin string
}
type nodeReleaseCacheEntry struct {
	Release nodeInstallerRelease
	Expires time.Time
}

var nodeReleaseCache sync.Map

func nodeReleasePolicy() (channel, pin string, err error) {
	pin = strings.TrimSpace(os.Getenv("NODE_RELEASE_VERSION"))
	if pin != "" && !nodeReleaseTag.MatchString(pin) {
		return "", "", bad("NODE_RELEASE_VERSION must be a published version tag.")
	}
	channel = os.Getenv("NODE_RELEASE_CHANNEL")
	if channel == "" {
		channel = "beta" // Development and prerelease panels use the beta feed.
		if nodeReleaseTag.MatchString(NodeReleaseVersion) && !strings.Contains(NodeReleaseVersion, "-") {
			channel = "stable"
		}
	}
	if channel != "stable" && channel != "beta" {
		return "", "", bad("NODE_RELEASE_CHANNEL must be stable or beta.")
	}
	return channel, pin, nil
}

func (a *App) nodeReleaseFetch(ctx context.Context, address string, maximum int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Voltra-NodeInstaller/1.0")
	req.Header.Set("Accept", "application/vnd.github+json")
	client := http.Client{Timeout: 15 * time.Second}
	if a.HTTP != nil {
		client = *a.HTTP
		client.Timeout = 15 * time.Second
	}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 4 || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.Port() != "" {
			return fmt.Errorf("invalid release redirect")
		}
		switch req.URL.Hostname() {
		case "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
			return nil
		}
		return fmt.Errorf("invalid release redirect host")
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, APIError{502, "NodeReleaseUnavailable", "Could not check the node release. Try again shortly."}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, APIError{502, "NodeReleaseUnavailable", fmt.Sprintf("Node release host returned HTTP %d. Try again shortly.", res.StatusCode)}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maximum+1))
	if err != nil || int64(len(data)) > maximum {
		return nil, bad("Node release metadata is invalid or too large.")
	}
	return data, nil
}

func nodeReleaseAssets(release nodePublishedRelease) (map[string]nodeReleaseAsset, bool) {
	if release.Draft || !nodeReleaseTag.MatchString(release.Tag) || len(release.Assets) > 100 {
		return nil, false
	}
	assets := map[string]nodeReleaseAsset{}
	for _, asset := range release.Assets {
		if _, duplicate := assets[asset.Name]; duplicate {
			return nil, false
		}
		assets[asset.Name] = asset
	}
	for _, name := range []string{"install-node.sh", "WINGS-SHA256SUMS", "NODE-SHA256SUMS", "WINGS-LICENSE", "wings-provenance.json", "voltra-wings-linux-amd64", "voltra-wings-linux-arm64", "voltra-node-linux-amd64", "voltra-node-linux-arm64"} {
		asset, ok := assets[name]
		if !ok || asset.State != "uploaded" || asset.Size < 1 || !nodeReleaseDigest.MatchString(asset.Digest) || asset.URL != nodeReleaseRepo+"download/"+release.Tag+"/"+name {
			return nil, false
		}
	}
	return assets, true
}

func (a *App) nodeReleaseChecksums(ctx context.Context, assets map[string]nodeReleaseAsset, manifest string, names ...string) error {
	asset := assets[manifest]
	data, err := a.nodeReleaseFetch(ctx, asset.URL, 64<<10)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	if "sha256:"+hex.EncodeToString(digest[:]) != asset.Digest {
		return bad("The node release checksum manifest did not match its published digest.")
	}
	checksums := map[string]string{}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 || !nodeReleaseDigest.MatchString("sha256:"+fields[0]) {
			return bad("The node release checksum manifest is invalid.")
		}
		if _, exists := checksums[fields[1]]; exists {
			return bad("The node release checksum manifest has duplicate entries.")
		}
		checksums[fields[1]] = "sha256:" + fields[0]
	}
	if scanner.Err() != nil {
		return bad("The node release checksum manifest is invalid.")
	}
	for _, name := range names {
		if checksums[name] != assets[name].Digest {
			return bad("The node release is incomplete or has mismatched checksums.")
		}
	}
	return nil
}

func (a *App) resolveNodeInstaller(ctx context.Context) (nodeInstallerRelease, error) {
	channel, pin, err := nodeReleasePolicy()
	if err != nil {
		return nodeInstallerRelease{}, err
	}
	key := nodeReleaseCacheKey{a, channel, pin}
	if entry, ok := nodeReleaseCache.Load(key); ok && time.Now().Before(entry.(nodeReleaseCacheEntry).Expires) {
		return entry.(nodeReleaseCacheEntry).Release, nil
	}
	address := nodeReleaseAPI + "?per_page=30"
	if pin != "" {
		address = nodeReleaseAPI + "/tags/" + pin
	}
	data, err := a.nodeReleaseFetch(ctx, address, 2<<20)
	if err != nil {
		return nodeInstallerRelease{}, err
	}
	var releases []nodePublishedRelease
	if pin != "" {
		var release nodePublishedRelease
		err = json.Unmarshal(data, &release)
		if release.Tag != pin {
			return nodeInstallerRelease{}, bad("The release host returned a different node version.")
		}
		releases = []nodePublishedRelease{release}
	} else {
		err = json.Unmarshal(data, &releases)
	}
	if err != nil || len(releases) > 30 {
		return nodeInstallerRelease{}, bad("The node release index is invalid.")
	}
	eligible := []nodePublishedRelease{}
	for _, release := range releases {
		if _, ok := nodeReleaseAssets(release); !ok {
			continue
		}
		if pin == "" && (channel == "stable" && (release.Prerelease || strings.Contains(release.Tag, "-")) || strings.Contains(strings.ToLower(release.Tag), "nightly")) {
			continue
		}
		eligible = append(eligible, release)
	}
	sort.Slice(eligible, func(i, j int) bool {
		x, ex := semver.NPM.Parse(strings.TrimPrefix(eligible[i].Tag, "v"))
		y, ey := semver.NPM.Parse(strings.TrimPrefix(eligible[j].Tag, "v"))
		return ex == nil && ey == nil && x.Compare(y) > 0
	})
	if len(eligible) == 0 {
		return nodeInstallerRelease{}, APIError{503, "NodeReleaseIncomplete", "No complete Linux node release is available on this channel yet. Both Wings and connector builds must finish before installation."}
	}
	release := eligible[0]
	assets, _ := nodeReleaseAssets(release)
	if err = a.nodeReleaseChecksums(ctx, assets, "WINGS-SHA256SUMS", "install-node.sh", "voltra-wings-linux-amd64", "voltra-wings-linux-arm64", "WINGS-LICENSE", "wings-provenance.json"); err == nil {
		err = a.nodeReleaseChecksums(ctx, assets, "NODE-SHA256SUMS", "voltra-node-linux-amd64", "voltra-node-linux-arm64")
	}
	if err != nil {
		return nodeInstallerRelease{}, err
	}
	result := nodeInstallerRelease{release.Tag, channel, "latest-complete", nodeReleaseRepo + "tag/" + release.Tag, assets["install-node.sh"].URL}
	if pin != "" {
		result.Source = "pinned"
	}
	nodeReleaseCache.Range(func(k, v any) bool {
		if time.Now().After(v.(nodeReleaseCacheEntry).Expires) {
			nodeReleaseCache.Delete(k)
		}
		return true
	})
	nodeReleaseCache.Store(key, nodeReleaseCacheEntry{result, time.Now().Add(time.Minute)})
	return result, nil
}

func (a *App) latestNodeInstaller(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	base := r.URL.Query().Get("panel_url")
	if base == "" {
		base = a.panelPublicURL(r.Context())
	}
	base, err := pairingPanelURL(base)
	if err != nil {
		fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	release, err := a.resolveNodeInstaller(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, M{"version": release.Version, "channel": release.Channel, "source": release.Source, "panel_url": base, "release_url": release.ReleaseURL, "installer_url": release.InstallerURL, "install_command": nodeInstallVersionCommand(base, release.Version)})
}
