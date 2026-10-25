//go:build linux

package nodeagent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

// Fixture-only authority. It is NOT a reviewed production release approval.
type privateReleaseFixtureAuthority struct {
	mu       sync.Mutex
	approval PrivateSteamProductionReleaseApproval
	err      error
	block    bool
	calls    int
	identity PrivateSteamReleaseIdentity
}

func (a *privateReleaseFixtureAuthority) CurrentPrivateSteamRelease(ctx context.Context, id PrivateSteamReleaseIdentity) (PrivateSteamProductionReleaseApproval, error) {
	a.mu.Lock()
	a.calls++
	a.identity = id
	block := a.block
	err := a.err
	value := a.approval
	value.AppPolicies = append([]PrivateSteamReviewedAppPolicy(nil), value.AppPolicies...)
	a.mu.Unlock()
	if block {
		<-ctx.Done()
		return PrivateSteamProductionReleaseApproval{}, ctx.Err()
	}
	return value, err
}
func (a *privateReleaseFixtureAuthority) mutate(f func(*PrivateSteamProductionReleaseApproval)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	f(&a.approval)
}

type privateReleaseFixtureAdmission struct {
	acquire func(context.Context, steamapi.PrivateRequest) (*steamexec.PrivateRoots, error)
}

func (a privateReleaseFixtureAdmission) Acquire(ctx context.Context, r steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
	return a.acquire(ctx, r)
}

type privateReleaseFixtureRunner struct{ run func(context.Context) error }

func (r privateReleaseFixtureRunner) Run(ctx context.Context, _ steamapi.PrivateRequest, _ func(steamapi.PrivateEvent) error, _ func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
	return r.run(ctx)
}
func privateReleaseSetup(t *testing.T) (*PrivateSteamConnectorConfig, *privateReleaseFixtureAuthority, *PrivateCandidateInstallation) {
	t.Helper()
	f := candidateTestFixture(t)
	install, err := f.install(context.Background(), t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := PrivateSteamAppPolicySHA256(2394010)
	a := &privateReleaseFixtureAuthority{approval: PrivateSteamProductionReleaseApproval{ManifestSHA256: f.trust, Revision: "FIXTURE-release-v1", Provider: f.m.Provider, RID: f.m.RID, ValidUntil: time.Now().Add(time.Hour), AppPolicies: []PrivateSteamReviewedAppPolicy{{2394010, "FIXTURE-policy-v1", hash}}}}
	admission := privateReleaseFixtureAdmission{func(context.Context, steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
		return nil, errors.New("fixture unused admission")
	}}
	config, err := NewInstalledPrivateSteamConnectorConfig(context.Background(), install.Root, install.Digest, admission, a)
	if err != nil {
		t.Fatal(err)
	}
	return config, a, install
}
func TestPrivateReleaseCompositionDefaultOffAndIdentity(t *testing.T) {
	f := candidateTestFixture(t)
	install, err := f.install(context.Background(), t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg, e := NewInstalledPrivateSteamConnectorConfig(context.Background(), install.Root, install.Digest, nil, nil); e == nil || cfg != nil {
		t.Fatal("offline candidate became release authority")
	}
	config, a, installed := privateReleaseSetup(t)
	w := config.Runner.(*installedPrivateSteamRunner)
	runner := w.runner.(*steamexec.PrivateJobRunner)
	if runner.Executable != filepath.Join(installed.Root, "binary/worker/SteamPrivateContentWorker") || runner.RuntimeRoot != filepath.Join(installed.Root, "binary/runtime") || runner.Admission != w.release {
		t.Fatal("runner not derived from reviewed installed layout")
	}
	a.mu.Lock()
	identity := a.identity
	a.mu.Unlock()
	if identity.ManifestSHA256 != installed.Digest || identity.Provider != steamapi.PrivateProvider || identity.RID != "linux-x64" || identity.SourceTarSHA256 == "" {
		t.Fatal("approval missing source/binary identity")
	}
	// Mutating a previously returned installer bundle cannot override composition.
	installed.Bundle.Root = "/untrusted"
	installed.Bundle.Files["injected"] = "bad"
	if config.Readiness.ProductionReady(context.Background()) != nil || runner.Bundle.Root == "/untrusted" {
		t.Fatal("mutable installer result aliased")
	}
	registry := NewPrivateSteamConnector(context.Background(), config)
	defer registry.Close()
	caps := registry.Capabilities()
	if len(caps) != 2 || caps[1] != steamapi.PrivateAppCapability(2394010) {
		t.Fatal("fixture app capability scope", caps)
	}
	if config.Readiness.AppPolicyReady(42) {
		t.Fatal("unregistered app accepted")
	}
}
func TestPrivateReleaseApprovalAndPolicyRevocation(t *testing.T) {
	tests := map[string]func(*PrivateSteamProductionReleaseApproval){
		"manifest":        func(a *PrivateSteamProductionReleaseApproval) { a.ManifestSHA256 = strings.Repeat("f", 64) },
		"provider":        func(a *PrivateSteamProductionReleaseApproval) { a.Provider = "fixture-not-production-provider" },
		"rid":             func(a *PrivateSteamProductionReleaseApproval) { a.RID = "linux-arm64" },
		"revision":        func(a *PrivateSteamProductionReleaseApproval) { a.Revision = "changed-v2" },
		"expiry":          func(a *PrivateSteamProductionReleaseApproval) { a.ValidUntil = time.Now().Add(-time.Second) },
		"empty-policy":    func(a *PrivateSteamProductionReleaseApproval) { a.AppPolicies = nil },
		"unknown-app":     func(a *PrivateSteamProductionReleaseApproval) { a.AppPolicies[0].App = 42 },
		"policy-revision": func(a *PrivateSteamProductionReleaseApproval) { a.AppPolicies[0].Revision = "changed-v2" },
		"profile-drift": func(a *PrivateSteamProductionReleaseApproval) {
			a.AppPolicies[0].ProfileSHA256 = strings.Repeat("f", 64)
		},
		"duplicate": func(a *PrivateSteamProductionReleaseApproval) {
			a.AppPolicies = append(a.AppPolicies, a.AppPolicies[0])
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			config, a, _ := privateReleaseSetup(t)
			registry := NewPrivateSteamConnector(context.Background(), config)
			defer registry.Close()
			a.mutate(mutate)
			if config.Readiness.ProductionReady(context.Background()) == nil || config.Readiness.AppPolicyReady(2394010) || len(registry.Capabilities()) != 0 {
				t.Fatal("revoked approval still ready")
			}
		})
	}
}
func TestPrivateReleaseInstalledDriftAndConfinement(t *testing.T) {
	for _, part := range []string{"manifest.json", "complete.json", "binary/worker/SteamPrivateContentWorker", "binary/runtime/dotnet", "source/BUILD-AND-RELINK.txt"} {
		t.Run(part, func(t *testing.T) {
			config, _, install := privateReleaseSetup(t)
			p := filepath.Join(install.Root, part)
			b, _ := os.ReadFile(p)
			if err := os.WriteFile(p, append(b, '!'), 0644); err != nil {
				t.Fatal(err)
			}
			if config.Readiness.ProductionReady(context.Background()) == nil {
				t.Fatal("installed drift accepted")
			}
		})
	}
	for _, kind := range []string{"symlink", "hardlink", "extra", "mode"} {
		t.Run(kind, func(t *testing.T) {
			config, _, install := privateReleaseSetup(t)
			p := filepath.Join(install.Root, "binary/worker/SteamPrivateContentWorker")
			switch kind {
			case "symlink":
				b, _ := os.ReadFile(p)
				outside := filepath.Join(t.TempDir(), "copy")
				os.WriteFile(outside, b, 0755)
				os.Remove(p)
				os.Symlink(outside, p)
			case "hardlink":
				os.Link(p, filepath.Join(t.TempDir(), "alias"))
			case "extra":
				os.WriteFile(filepath.Join(install.Root, "binary/worker/injected"), []byte("x"), 0644)
			case "mode":
				os.Chmod(p, 0777)
			}
			if config.Readiness.ProductionReady(context.Background()) == nil {
				t.Fatal("unsafe installed layout accepted")
			}
		})
	}
}
func TestPrivateReleaseTrustedAdmissionRevalidation(t *testing.T) {
	config, a, _ := privateReleaseSetup(t)
	s := config.Readiness.(*installedPrivateSteamRelease)
	base := t.TempDir()
	for _, name := range []string{"target", "work", "cache"} {
		if err := os.Mkdir(filepath.Join(base, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	request := privateConnectorRequest()
	actual := &steamexec.PrivateDirectoryAdmission{Roots: map[string]steamexec.PrivateDirectorySet{request.Server + ":" + request.Owner: {Target: filepath.Join(base, "target"), Work: filepath.Join(base, "work"), Cache: filepath.Join(base, "cache")}}}
	called, released := false, false
	s.admission = privateReleaseFixtureAdmission{func(ctx context.Context, r steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
		called = true
		roots, e := actual.Acquire(ctx, r)
		if e != nil {
			return nil, e
		}
		old := roots.Release
		roots.Release = func() { released = true; old() }
		a.mutate(func(a *PrivateSteamProductionReleaseApproval) { a.AppPolicies = nil })
		return roots, nil
	}}
	if roots, e := s.Acquire(context.Background(), request); e == nil || roots != nil || !called || !released {
		t.Fatal("revocation during trusted root acquisition did not release", e)
	}
	called = false
	if _, e := s.Acquire(context.Background(), request); e == nil || called {
		t.Fatal("revoked new admission touched roots")
	}
}
func TestPrivateReleaseDirectRunnerPolicyBeforeAdmission(t *testing.T) {
	config, _, _ := privateReleaseSetup(t)
	s := config.Readiness.(*installedPrivateSteamRelease)
	called := false
	s.admission = privateReleaseFixtureAdmission{func(context.Context, steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
		called = true
		return nil, nil
	}}
	r := privateConnectorRequest()
	r.Selection.Protected = nil
	if _, err := s.Acquire(context.Background(), r); err == nil || called {
		t.Fatal("missing preservation policy reached admission")
	}
}
func TestPrivateReleaseActiveJobRevocationAndExpiry(t *testing.T) {
	for _, kind := range []string{"release", "policy", "authority-error", "timeout", "expiry", "normal"} {
		t.Run(kind, func(t *testing.T) {
			config, a, _ := privateReleaseSetup(t)
			w := config.Runner.(*installedPrivateSteamRunner)
			if kind == "expiry" {
				a.mutate(func(a *PrivateSteamProductionReleaseApproval) { a.ValidUntil = time.Now().Add(200 * time.Millisecond) })
			}
			started := make(chan struct{})
			w.runner = privateReleaseFixtureRunner{func(ctx context.Context) error {
				close(started)
				if kind == "normal" {
					return nil
				}
				<-ctx.Done()
				return ctx.Err()
			}}
			done := make(chan error, 1)
			go func() { done <- w.Run(context.Background(), privateConnectorRequest(), nil, nil) }()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("runner did not start")
			}
			a.mu.Lock()
			switch kind {
			case "release":
				a.approval.Revision = "revoked"
			case "policy":
				a.approval.AppPolicies = nil
			case "authority-error":
				a.err = errors.New("do not expose authority diagnostic")
			case "timeout":
				a.block = true
			}
			a.mu.Unlock()
			select {
			case err := <-done:
				if kind == "normal" && err != nil {
					t.Fatal(err)
				}
				if kind != "normal" && (err == nil || strings.Contains(err.Error(), "diagnostic")) {
					t.Fatal("active revocation not sanitized", err)
				}
			case <-time.After(4 * time.Second):
				t.Fatal("active worker/monitor did not cancel and join")
			}
			a.mu.Lock()
			calls := a.calls
			a.mu.Unlock()
			time.Sleep(30 * time.Millisecond)
			a.mu.Lock()
			after := a.calls
			a.mu.Unlock()
			if calls != after {
				t.Fatal("monitor left running after Run")
			}
		})
	}
}
func TestPrivateReleaseProductionManifestCannotSelfEnable(t *testing.T) {
	f := candidateTestFixture(t)
	f.m.ProductionEnabled = true
	raw, _ := json.Marshal(f.m)
	if _, err := candidateManifest(raw, candidateDigest(raw)); err == nil {
		t.Fatal("archive enabled itself")
	}
	// The existing parser remains unchanged and candidate approval is still inert.
}

func TestPrivateReleaseActiveRequestAndCompositionCancellation(t *testing.T) {
	for _, kind := range []string{"request-deadline", "composition-cancel"} {
		t.Run(kind, func(t *testing.T) {
			config, _, _ := privateReleaseSetup(t)
			w := config.Runner.(*installedPrivateSteamRunner)
			composition, cancel := context.WithCancel(context.Background())
			defer cancel()
			w.release.ctx = composition
			started := make(chan struct{})
			w.runner = privateReleaseFixtureRunner{func(ctx context.Context) error { close(started); <-ctx.Done(); return ctx.Err() }}
			request := privateConnectorRequest()
			request.DeadlineSeconds = 1
			done := make(chan error, 1)
			go func() { done <- w.Run(context.Background(), request, nil, nil) }()
			select {
			case <-started:
			case <-time.After(time.Second):
				t.Fatal("runner not started")
			}
			if kind == "composition-cancel" {
				cancel()
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("canceled worker succeeded")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("worker/monitor not joined")
			}
		})
	}
}

// Opt-in real shipping candidate, fixture-only release authority, NO authentication
// or game-content/network activity. A durable pre-existing admission forces the
// actual worker to reject before constructing an authenticated content session.
func TestPrivateReleaseActualCandidateOfflineAdmission(t *testing.T) {
	dir, trust := os.Getenv("PRIVATE_STEAM_CANDIDATE_INPUT"), os.Getenv("PRIVATE_STEAM_CANDIDATE_TRUST")
	if dir == "" || trust == "" {
		t.Skip("requires explicitly supplied cached candidate input and trusted digest")
	}
	if os.Geteuid() != 0 {
		t.Fatal("actual alternate-UID composition fixture requires isolated Linux root")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.Open(filepath.Join(dir, "worker.tar"))
	if err != nil {
		t.Fatal(err)
	}
	defer binary.Close()
	source, err := os.Open(filepath.Join(dir, "source.tar"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	install, err := InstallPrivateCandidate(ctx, t.TempDir(), raw, trust, binary, source)
	if err != nil {
		t.Fatal(err)
	}
	m, err := candidateManifest(raw, trust)
	if err != nil {
		t.Fatal(err)
	}
	r := privateConnectorRequest()
	scope := r.Scope()
	base := t.TempDir()
	for _, name := range []string{"target", "work", "cache"} {
		if err := os.Mkdir(filepath.Join(base, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	target := filepath.Join(base, "target")
	if err := os.Chown(target, 988, 988); err != nil {
		t.Fatal(err)
	}
	prefix := filepath.Join(base, "work", scope.Server, scope.Owner, scope.Nonce)
	if err := os.MkdirAll(prefix, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(prefix, "admission.json")
	const prior = "fixture pre-existing admission; reject before network"
	if err := os.WriteFile(marker, []byte(prior), 0600); err != nil {
		t.Fatal(err)
	}
	hash, _ := PrivateSteamAppPolicySHA256(r.Selection.App)
	authority := &privateReleaseFixtureAuthority{approval: PrivateSteamProductionReleaseApproval{ManifestSHA256: trust, Revision: "FIXTURE-ONLY-NOT-PRODUCTION", Provider: m.Provider, RID: m.RID, ValidUntil: time.Now().Add(time.Minute), AppPolicies: []PrivateSteamReviewedAppPolicy{{r.Selection.App, "FIXTURE-ONLY-policy", hash}}}}
	admission := &steamexec.PrivateDirectoryAdmission{Roots: map[string]steamexec.PrivateDirectorySet{r.Server + ":" + r.Owner: {Target: target, Work: filepath.Join(base, "work"), Cache: filepath.Join(base, "cache")}}}
	config, err := NewInstalledPrivateSteamConnectorConfig(ctx, install.Root, trust, admission, authority)
	if err != nil {
		t.Fatal(err)
	}
	err = config.Runner.Run(ctx, r, func(steamapi.PrivateEvent) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "storage_create_conflict") {
		t.Fatal("actual composed worker did not reach expected offline admission rejection", err)
	}
	bytes, err := os.ReadFile(marker)
	if err != nil || string(bytes) != prior {
		t.Fatal("existing admission was modified", err)
	}
	files, err := os.ReadDir(target)
	if err != nil || len(files) != 0 {
		t.Fatal("offline rejection mutated target", err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	st := info.Sys().(*syscall.Stat_t)
	if st.Uid != 988 || st.Gid != 988 || info.Mode().Perm() != 0700 {
		t.Fatal("target owner/mode changed")
	}
	t.Log("actual cached shipping worker via installed-release composition rejected pre-existing admission before authentication; target UID988 unchanged; synthetic authority only")
}
