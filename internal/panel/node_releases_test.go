package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func nodeFixtureRelease(tag string, prerelease bool) (nodePublishedRelease, map[string][]byte) {
	bodies := map[string][]byte{}
	names := []string{"install-node.sh", "WINGS-LICENSE", "wings-provenance.json", "voltra-wings-linux-amd64", "voltra-wings-linux-arm64", "voltra-node-linux-amd64", "voltra-node-linux-arm64"}
	for _, name := range names {
		bodies[name] = []byte("verified " + tag + " " + name)
	}
	digest := func(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
	for _, manifest := range []string{"WINGS-SHA256SUMS", "NODE-SHA256SUMS"} {
		files := names[:5]
		if manifest == "NODE-SHA256SUMS" {
			files = names[5:]
		}
		var b strings.Builder
		for _, name := range files {
			fmt.Fprintf(&b, "%s  %s\n", digest(bodies[name]), name)
		}
		bodies[manifest] = []byte(b.String())
	}
	r := nodePublishedRelease{Tag: tag, Prerelease: prerelease}
	for name, body := range bodies {
		r.Assets = append(r.Assets, nodeReleaseAsset{Name: name, State: "uploaded", Size: int64(len(body)), Digest: "sha256:" + digest(body), URL: nodeReleaseRepo + "download/" + tag + "/" + name})
	}
	return r, bodies
}
func nodeFixtureApp(t *testing.T, releases []nodePublishedRelease, bodies map[string]map[string][]byte, calls *int) *App {
	t.Helper()
	return &App{HTTP: &http.Client{Transport: mcContentTestTransport(func(r *http.Request) (*http.Response, error) {
		*calls++
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Fatal("credentials leaked to release host")
		}
		if r.URL.Host == "api.github.com" {
			var v any = releases
			if strings.Contains(r.URL.Path, "/tags/") {
				v = releases[0]
			}
			b, _ := json.Marshal(v)
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(b)))}, nil
		}
		for _, release := range releases {
			for name, body := range bodies[release.Tag] {
				if r.URL.String() == nodeReleaseRepo+"download/"+release.Tag+"/"+name {
					return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body)))}, nil
				}
			}
		}
		return nil, fmt.Errorf("unexpected release request")
	})}}
}
func TestNodeReleaseLatestCompleteAndPinnedCommands(t *testing.T) {
	t.Setenv("NODE_RELEASE_VERSION", "")
	t.Setenv("NODE_RELEASE_CHANNEL", "beta")
	old, b1 := nodeFixtureRelease("v0.1.0-beta.2", true)
	latest, b2 := nodeFixtureRelease("v0.1.0-beta.10", true)
	incomplete, _ := nodeFixtureRelease("v0.2.0", false)
	incomplete.Assets = incomplete.Assets[:1]
	calls := 0
	a := nodeFixtureApp(t, []nodePublishedRelease{old, incomplete, latest}, map[string]map[string][]byte{old.Tag: b1, latest.Tag: b2}, &calls)
	result, e := a.resolveNodeInstaller(context.Background())
	if e != nil || result.Version != latest.Tag {
		t.Fatalf("wrong latest complete release: %#v %v", result, e)
	}
	command := nodeInstallVersionCommand("https://panel.example.com", result.Version)
	if !strings.Contains(command, "/download/v0.1.0-beta.10/") || strings.Contains(command, "/latest/") || !strings.Contains(command, "sha256sum -c script.sha256") {
		t.Fatal(command)
	}
	before := calls
	if _, e = a.resolveNodeInstaller(context.Background()); e != nil || calls != before {
		t.Fatal("successful metadata check not cached", e)
	}
}
func TestNodeReleaseStableExcludesPrereleasesAndDrafts(t *testing.T) {
	t.Setenv("NODE_RELEASE_VERSION", "")
	t.Setenv("NODE_RELEASE_CHANNEL", "stable")
	stable, b := nodeFixtureRelease("v1.0.0", false)
	beta, _ := nodeFixtureRelease("v2.0.0-beta.1", true)
	draft, _ := nodeFixtureRelease("v3.0.0", false)
	draft.Draft = true
	calls := 0
	a := nodeFixtureApp(t, []nodePublishedRelease{beta, draft, stable}, map[string]map[string][]byte{stable.Tag: b}, &calls)
	r, e := a.resolveNodeInstaller(context.Background())
	if e != nil || r.Version != stable.Tag {
		t.Fatal(r, e)
	}
}
func TestNodeReleaseFailsClosedOnMetadataAndChecksums(t *testing.T) {
	for _, scenario := range []string{"missing-arm64", "pending", "foreign-url", "duplicate-asset", "missing-digest", "tampered-manifest", "missing-checksum"} {
		t.Run(scenario, func(t *testing.T) {
			t.Setenv("NODE_RELEASE_VERSION", "")
			t.Setenv("NODE_RELEASE_CHANNEL", "beta")
			r, b := nodeFixtureRelease("v1.2.3-beta.1", true)
			switch scenario {
			case "missing-arm64":
				for i, a := range r.Assets {
					if a.Name == "voltra-node-linux-arm64" {
						r.Assets = append(r.Assets[:i], r.Assets[i+1:]...)
						break
					}
				}
			case "pending":
				r.Assets[0].State = "new"
			case "foreign-url":
				r.Assets[0].URL = "https://example.invalid/binary"
			case "duplicate-asset":
				r.Assets = append(r.Assets, r.Assets[0])
			case "missing-digest":
				r.Assets[0].Digest = ""
			case "tampered-manifest":
				b["WINGS-SHA256SUMS"] = []byte("tampered")
			case "missing-checksum":
				b["WINGS-SHA256SUMS"] = []byte{}
				s := sha256.Sum256(b["WINGS-SHA256SUMS"])
				for i := range r.Assets {
					if r.Assets[i].Name == "WINGS-SHA256SUMS" {
						r.Assets[i].Digest = "sha256:" + hex.EncodeToString(s[:])
					}
				}
			}
			calls := 0
			a := nodeFixtureApp(t, []nodePublishedRelease{r}, map[string]map[string][]byte{r.Tag: b}, &calls)
			if _, e := a.resolveNodeInstaller(context.Background()); e == nil {
				t.Fatal("invalid release accepted")
			}
		})
	}
}
func TestNodeReleaseExplicitPinAndInvalidConfiguration(t *testing.T) {
	t.Setenv("NODE_RELEASE_VERSION", "v1.0.1")
	t.Setenv("NODE_RELEASE_CHANNEL", "stable")
	r, b := nodeFixtureRelease("v1.0.1", false)
	calls := 0
	a := nodeFixtureApp(t, []nodePublishedRelease{r}, map[string]map[string][]byte{r.Tag: b}, &calls)
	v, e := a.resolveNodeInstaller(context.Background())
	if e != nil || v.Source != "pinned" || v.Version != "v1.0.1" {
		t.Fatal(v, e)
	}
	t.Setenv("NODE_RELEASE_VERSION", "latest")
	if _, e = a.resolveNodeInstaller(context.Background()); e == nil {
		t.Fatal("mutable explicit pin accepted")
	}
}
