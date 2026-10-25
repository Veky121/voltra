//go:build linux

package nodeagent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

func privateRecoveryReleaseSetup(t *testing.T) (*PrivateSteamConnectorConfig, *privateReleaseFixtureAuthority) {
	t.Helper()
	old, a, install := privateReleaseSetup(t)
	s := old.Readiness.(*installedPrivateSteamRelease)
	base := old.Runner.(*installedPrivateSteamRunner).runner.(*steamexec.PrivateJobRunner)
	hash, _ := PrivateSteamAppPolicySHA256(2394010)
	a.mutate(func(a *PrivateSteamProductionReleaseApproval) {
		a.ReceiptRecovery = &PrivateSteamReviewedReceiptRecovery{ABI: steamapi.PrivateRecoveryABI, ManifestSHA256: install.Digest, EntrypointSHA256: base.WorkerSHA256, AppPolicies: []PrivateSteamReviewedAppPolicy{{2394010, "FIXTURE-recovery-v1", hash}}}
	})
	config, e := NewInstalledPrivateSteamConnectorConfig(context.Background(), install.Root, install.Digest, s.admission, a)
	if e != nil {
		t.Fatal(e)
	}
	return config, a
}
func TestPrivateRecoveryReleaseExplicitABIAndAppReview(t *testing.T) {
	old, _, _ := privateReleaseSetup(t)
	v, _ := privateRecoveryBrokerRequest(t, 1)
	if old.Readiness.(PrivateSteamReceiptRecoveryReadiness).ReceiptRecoveryReady(context.Background(), 2394010) == nil {
		t.Fatal("old candidate review enabled recovery")
	}
	if e := old.Runner.(PrivateSteamRecoverer).Recover(context.Background(), v, func(steamapi.PrivateEvent) error { return nil }); e == nil {
		t.Fatal("method alone enabled recovery")
	}
	for _, kind := range []string{"abi", "manifest", "entrypoint", "app", "app-revision", "none"} {
		t.Run(kind, func(t *testing.T) {
			config, a := privateRecoveryReleaseSetup(t)
			if config.Readiness.(PrivateSteamReceiptRecoveryReadiness).ReceiptRecoveryReady(context.Background(), 2394010) != nil {
				t.Fatal("fixture approval rejected")
			}
			a.mutate(func(a *PrivateSteamProductionReleaseApproval) {
				copy := *a.ReceiptRecovery
				copy.AppPolicies = append([]PrivateSteamReviewedAppPolicy(nil), copy.AppPolicies...)
				switch kind {
				case "abi":
					copy.ABI = "other-v1"
				case "manifest":
					copy.ManifestSHA256 = repeatRecoveryHex()
				case "entrypoint":
					copy.EntrypointSHA256 = repeatRecoveryHex()
				case "app":
					copy.AppPolicies[0].App = 42
				case "app-revision":
					copy.AppPolicies[0].Revision = "changed-v2"
				case "none":
					a.ReceiptRecovery = nil
					return
				}
				a.ReceiptRecovery = &copy
			})
			if config.Readiness.(PrivateSteamReceiptRecoveryReadiness).ReceiptRecoveryReady(context.Background(), 2394010) == nil {
				t.Fatal("revoked ABI review accepted")
			}
		})
	}
}

type privateRecoveryActiveFixture struct {
	privateReleaseFixtureRunner
	entered chan struct{}
}

func (f privateRecoveryActiveFixture) Recover(ctx context.Context, _ steamapi.PrivateReceiptRecoveryRequest, _ func(steamapi.PrivateEvent) error) error {
	close(f.entered)
	<-ctx.Done()
	return ctx.Err()
}
func TestPrivateRecoveryActiveApprovalRevocationCancelsAndJoins(t *testing.T) {
	for _, kind := range []string{"abi", "policy", "error", "expiry"} {
		t.Run(kind, func(t *testing.T) {
			config, a := privateRecoveryReleaseSetup(t)
			w := config.Runner.(*installedPrivateSteamRunner)
			entered := make(chan struct{})
			w.runner = privateRecoveryActiveFixture{entered: entered}
			if kind == "expiry" {
				a.mutate(func(a *PrivateSteamProductionReleaseApproval) { a.ValidUntil = time.Now().Add(200 * time.Millisecond) })
			}
			v, _ := privateRecoveryBrokerRequest(t, 1)
			done := make(chan error, 1)
			go func() { done <- w.Recover(context.Background(), v, func(steamapi.PrivateEvent) error { return nil }) }()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("recovery not started")
			}
			a.mu.Lock()
			switch kind {
			case "abi":
				a.approval.ReceiptRecovery = nil
			case "policy":
				copy := *a.approval.ReceiptRecovery
				copy.AppPolicies = nil
				a.approval.ReceiptRecovery = &copy
			case "error":
				a.err = errors.New("fixture authority revoked")
			}
			a.mu.Unlock()
			select {
			case e := <-done:
				if e == nil {
					t.Fatal("revoked recovery succeeded")
				}
			case <-time.After(4 * time.Second):
				t.Fatal("recovery not canceled/joined")
			}
		})
	}
}

type privateRecoveryReleaseAdmissionFixture struct {
	steamexec.PrivateAdmission
	recover func(context.Context, steamapi.PrivateRequest) (*steamexec.PrivateRoots, error)
}

func (a privateRecoveryReleaseAdmissionFixture) AcquireRecovery(ctx context.Context, r steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
	return a.recover(ctx, r)
}
func TestPrivateRecoveryReleaseAdmissionRevocationReleasesReadOnlyRoots(t *testing.T) {
	config, authority := privateRecoveryReleaseSetup(t)
	s := config.Readiness.(*installedPrivateSteamRelease)
	v, _ := privateRecoveryBrokerRequest(t, 1)
	request := v.Original.Request()
	base := t.TempDir()
	for _, name := range []string{"target", "work", "cache"} {
		if e := os.Mkdir(filepath.Join(base, name), 0700); e != nil {
			t.Fatal(e)
		}
	}
	marker := filepath.Join(base, "work", "preserved-operator-marker")
	os.WriteFile(marker, []byte("unchanged"), 0600)
	actual := &steamexec.PrivateDirectoryAdmission{Roots: map[string]steamexec.PrivateDirectorySet{request.Server + ":" + request.Owner: {Target: filepath.Join(base, "target"), Work: filepath.Join(base, "work"), Cache: filepath.Join(base, "cache")}}}
	called, released := false, false
	s.admission = privateRecoveryReleaseAdmissionFixture{PrivateAdmission: actual, recover: func(ctx context.Context, r steamapi.PrivateRequest) (*steamexec.PrivateRoots, error) {
		called = true
		roots, e := actual.AcquireRecovery(ctx, r)
		if e != nil {
			return nil, e
		}
		old := roots.Release
		roots.Release = func() { released = true; old() }
		authority.mutate(func(a *PrivateSteamProductionReleaseApproval) { a.ReceiptRecovery = nil })
		return roots, nil
	}}
	if roots, e := s.AcquireRecovery(context.Background(), request); e == nil || roots != nil || !called || !released {
		t.Fatal("revoked recovery admission retained roots", e)
	}
	called = false
	if _, e := s.AcquireRecovery(context.Background(), request); e == nil || called {
		t.Fatal("revoked recovery touched roots")
	}
	entries, _ := os.ReadDir(filepath.Join(base, "work"))
	if len(entries) != 1 || entries[0].Name() != "preserved-operator-marker" {
		t.Fatal("recovery admission created marker")
	}
	bytes, _ := os.ReadFile(marker)
	if string(bytes) != "unchanged" {
		t.Fatal("marker changed")
	}
}

// Opt-in shipping NEGATIVE only. Synthetic local review is not production
// authority. Missing and explicitly fixture/anonymous proofs must never recover.
func TestPrivateRecoveryActualCandidateShippingNegative(t *testing.T) {
	dir, trust := os.Getenv("PRIVATE_STEAM_RECOVERY_CANDIDATE_INPUT"), os.Getenv("PRIVATE_STEAM_RECOVERY_CANDIDATE_TRUST")
	if dir == "" || trust == "" {
		t.Skip("requires explicitly supplied cached recovery candidate/digest; candidate4 is not a recovery ABI")
	}
	if os.Geteuid() != 0 {
		t.Fatal("requires isolated Linux root with CHOWN and DAC_OVERRIDE")
	}
	raw, e := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if e != nil {
		t.Fatal(e)
	}
	binary, e := os.Open(filepath.Join(dir, "worker.tar"))
	if e != nil {
		t.Fatal(e)
	}
	defer binary.Close()
	source, e := os.Open(filepath.Join(dir, "source.tar"))
	if e != nil {
		t.Fatal(e)
	}
	defer source.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	install, e := InstallPrivateCandidate(ctx, t.TempDir(), raw, trust, binary, source)
	if e != nil {
		t.Fatal(e)
	}
	m, e := candidateManifest(raw, trust)
	if e != nil {
		t.Fatal(e)
	}
	v, _ := privateRecoveryBrokerRequest(t, 1)
	r := v.Original.Request()
	scope := r.Scope()
	base := t.TempDir()
	for _, name := range []string{"target", "work", "cache"} {
		if e := os.Mkdir(filepath.Join(base, name), 0700); e != nil {
			t.Fatal(e)
		}
	}
	target := filepath.Join(base, "target")
	if e := os.Chown(target, 988, 988); e != nil {
		t.Fatal(e)
	}
	prefix := filepath.Join(base, "work", scope.Server, scope.Owner, scope.Nonce)
	if e := os.MkdirAll(prefix, 0700); e != nil {
		t.Fatal(e)
	}
	marker := filepath.Join(prefix, "admission.json")
	os.WriteFile(marker, []byte("original admission unchanged"), 0600)
	admission := &steamexec.PrivateDirectoryAdmission{Roots: map[string]steamexec.PrivateDirectorySet{r.Server + ":" + r.Owner: {Target: target, Work: filepath.Join(base, "work"), Cache: filepath.Join(base, "cache")}}}
	worker := ""
	for _, file := range m.Files {
		if file.Path == m.Entrypoint {
			worker = file.SHA256
		}
	}
	hash, _ := PrivateSteamAppPolicySHA256(r.Selection.App)
	policy := PrivateSteamReviewedAppPolicy{App: r.Selection.App, Revision: "FIXTURE-ONLY-policy", ProfileSHA256: hash}
	authority := &privateReleaseFixtureAuthority{approval: PrivateSteamProductionReleaseApproval{ManifestSHA256: trust, Provider: m.Provider, RID: m.RID, Revision: "FIXTURE-ONLY-NOT-PRODUCTION", ValidUntil: time.Now().Add(time.Minute), AppPolicies: []PrivateSteamReviewedAppPolicy{policy}, ReceiptRecovery: &PrivateSteamReviewedReceiptRecovery{ABI: steamapi.PrivateRecoveryABI, ManifestSHA256: trust, EntrypointSHA256: worker, AppPolicies: []PrivateSteamReviewedAppPolicy{policy}}}}
	config, e := NewInstalledPrivateSteamConnectorConfig(ctx, install.Root, trust, admission, authority)
	if e != nil {
		t.Fatal(e)
	}
	for _, proof := range []string{"missing", "fixture", "anonymous"} {
		receiptPath := filepath.Join(prefix, "receipt.json")
		var before []byte
		if proof != "missing" {
			provider, access := "fixture-private-content-v1", "fixture"
			if proof == "anonymous" {
				provider = "steamkit-public-depot-v1"
				access = "anonymous_public"
			}
			receipt := map[string]any{"version": 1, "provider": provider, "scope": scope, "app": r.Selection.App, "build": "1", "depot": 43, "manifest": "1", "branch": r.Selection.Branch, "platform": r.Selection.Platform, "architecture": r.Selection.Architecture, "language": r.Selection.Language, "files": []any{map[string]any{"path": "publisher-only", "sha1": strings.Repeat("a", 40), "sha256": strings.Repeat("a", 64), "bytes": "1", "mode": 384, "uid": 988, "gid": 988}}, "depots": []any{map[string]any{"publisher_app": r.Selection.App, "depot": 43, "manifest": "1"}}, "publication_committed": true, "native_acceptance_verified": false, "access_proof": access, "entitlement_verified": false, "account_entitlement_verified": false, "anonymous_access_verified": proof == "anonymous"}
			before, _ = json.Marshal(receipt)
			if e := os.WriteFile(receiptPath, before, 0600); e != nil {
				t.Fatal(e)
			}
		}
		e = config.Runner.(PrivateSteamRecoverer).Recover(ctx, v, func(ev steamapi.PrivateEvent) error {
			if ev.Type == "result" {
				t.Error("shipping accepted unverified recovery proof")
			}
			return nil
		})
		expected := "receipt_missing"
		if proof != "missing" {
			expected = "invalid_provider_receipt"
		}
		if e == nil || !strings.Contains(e.Error(), expected) {
			t.Fatal("shipping recovery did not reject before authentication", proof, e)
		}
		if proof != "missing" {
			after, _ := os.ReadFile(receiptPath)
			if string(before) != string(after) {
				t.Fatal("receipt changed")
			}
		}
		bytes, _ := os.ReadFile(marker)
		if string(bytes) != "original admission unchanged" {
			t.Fatal("admission changed")
		}
		targetEntries, _ := os.ReadDir(target)
		cacheEntries, _ := os.ReadDir(filepath.Join(base, "cache"))
		if len(targetEntries) != 0 || len(cacheEntries) != 0 {
			t.Fatal("recovery changed target/cache")
		}
		if _, e := os.Stat(filepath.Join(base, "work", "admission-"+scope.Job+".json")); !os.IsNotExist(e) {
			t.Fatal("Go admission marker created")
		}
	}
	t.Log("actual shipping recovery rejected missing/fixture/anonymous receipts with targetUID988, no authentication/network/publication; synthetic release authority only")
}

func TestPrivateRecoveryInstalledDeadlineUsesOriginalCallerAndAuthority(t *testing.T) {
	for _, kind := range []string{"original7200", "caller", "authority"} {
		t.Run(kind, func(t *testing.T) {
			config, a := privateRecoveryReleaseSetup(t)
			w := config.Runner.(*installedPrivateSteamRunner)
			v, _ := privateRecoveryBrokerRequest(t, 1)
			v.Original.DeadlineSeconds = 7200
			scope := v.Original.Request().Scope()
			approval := time.Now().Add(3 * time.Hour)
			if kind == "authority" {
				approval = time.Now().Add(time.Minute)
			}
			a.mutate(func(a *PrivateSteamProductionReleaseApproval) { a.ValidUntil = approval })
			ctx := context.Background()
			caller := time.Time{}
			if kind == "caller" {
				var cancel context.CancelFunc
				caller = time.Now().Add(time.Second)
				ctx, cancel = context.WithDeadline(ctx, caller)
				defer cancel()
			}
			var got time.Time
			fixture := &privateRecoveryBrokerFixture{}
			fixture.ready.Store(true)
			w.runner = privateRecoveryDeadlineFixture{privateRecoveryBrokerFixture: fixture, inspect: func(ctx context.Context, request steamapi.PrivateReceiptRecoveryRequest) {
				got, _ = ctx.Deadline()
				if request.Original.Request().Scope() != scope {
					t.Fatal("installed runner changed original scope")
				}
			}}
			start := time.Now()
			if e := w.Recover(ctx, v, func(steamapi.PrivateEvent) error { return nil }); e != nil {
				t.Fatal(e)
			}
			end := time.Now()
			switch kind {
			case "caller":
				if !got.Equal(caller) {
					t.Fatal("caller not honored")
				}
			case "authority":
				if !got.Equal(approval) {
					t.Fatal("authority expiry not clamped")
				}
			default:
				if got.Before(start.Add(2*time.Hour)) || got.After(end.Add(2*time.Hour)) {
					t.Fatal("installed runner still capped recovery", got.Sub(start))
				}
			}
		})
	}
}
