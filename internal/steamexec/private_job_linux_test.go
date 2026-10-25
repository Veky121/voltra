//go:build linux

package steamexec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"voltra/internal/steamapi"
)

func privateJobRequest() steamapi.PrivateRequest {
	return steamapi.PrivateRequest{Version: steamapi.PrivateVersion, Job: jobID, Server: serverID, Owner: strings.Repeat("a", 64), Nonce: strings.Repeat("b", 64), Selection: steamapi.PrivateSelection{App: 42, Branch: "preview", Platform: "linux", Architecture: "64", Language: "english", DLC: []uint32{}, Protected: []string{}}, Username: "fixture-account", Password: "fixture-password", ContentBudget: "1048576", RollbackReserve: "4096", CacheQuota: "1048576", DeadlineSeconds: 10}
}
func privateJobDirectories(t *testing.T) (*PrivateDirectoryAdmission, PrivateDirectorySet) {
	t.Helper()
	base := t.TempDir()
	s := PrivateDirectorySet{filepath.Join(base, serverID), filepath.Join(base, "work"), filepath.Join(base, "cache")}
	for _, p := range []string{s.Target, s.Work, s.Cache} {
		if e := os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	r := privateJobRequest()
	return &PrivateDirectoryAdmission{Roots: map[string]PrivateDirectorySet{r.Server + ":" + r.Owner: s}}, s
}
func TestPrivateJobAdmission(t *testing.T) {
	r := privateJobRequest()
	a, s := privateJobDirectories(t)
	roots, e := a.Acquire(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.Acquire(context.Background(), r); e == nil {
		t.Fatal("concurrent admitted")
	}
	roots.Release()
	if _, e = a.Acquire(context.Background(), r); e == nil {
		t.Fatal("replay admitted")
	}
	b, _ := os.ReadFile(filepath.Join(s.Work, "admission-"+r.Scope().Job+".json"))
	if strings.Contains(string(b), r.Password) {
		t.Fatal("credential journaled")
	}
	a, s = privateJobDirectories(t)
	os.Remove(s.Cache)
	os.Symlink(s.Target, s.Cache)
	if _, e = a.Acquire(context.Background(), r); e == nil {
		t.Fatal("symlink admitted")
	}
	a, _ = privateJobDirectories(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = a.Acquire(ctx, r); e == nil {
		t.Fatal("cancel admitted")
	}
}
func TestPrivateJobExecutorExclusion(t *testing.T) {
	r := privateJobRequest()
	storage, s := privateJobDirectories(t)
	e := New()
	e.journal = t.TempDir()
	e.wingsConfig = filepath.Join(t.TempDir(), "absent")
	f := &fakeDocker{dir: s.Target}
	e.docker = f
	a := &PrivateExecutorAdmission{e, storage}
	roots, err := a.Acquire(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.reserveMaintenance(r.Server); err == nil {
		t.Fatal("public reservation ignored private")
	}
	other := New()
	other.journal = e.journal
	other.wingsConfig = e.wingsConfig
	other.docker = f
	if _, err = (&PrivateExecutorAdmission{other, storage}).Acquire(context.Background(), r); err == nil {
		t.Fatal("filesystem lock ignored")
	}
	roots.Release()
	release, err := e.reserveMaintenance(r.Server)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Acquire(context.Background(), r); err == nil {
		t.Fatal("private ignored public")
	}
	release()
	for _, kind := range []string{"running", "installer"} {
		storage, _ = privateJobDirectories(t)
		a.Storage = storage
		f.running = kind == "running"
		f.installerActive = kind == "installer"
		if _, err = a.Acquire(context.Background(), r); err == nil {
			t.Fatal(kind + " admitted")
		}
	}
}
func TestPrivateJobActualWorkerAdmissionFailure(t *testing.T) {
	exe := os.Getenv("PRIVATE_STEAM_WORKER_EXECUTABLE")
	if exe == "" {
		t.Skip("requires pinned actual worker offline runtime")
	}
	a, s := privateJobDirectories(t)
	r := privateJobRequest()
	scope := r.Scope()
	prefix := filepath.Join(s.Work, scope.Server, scope.Owner, scope.Nonce)
	os.MkdirAll(prefix, 0700)
	os.WriteFile(filepath.Join(prefix, "admission.json"), []byte("existing admission"), 0600)
	data, e := os.ReadFile(exe)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(data)
	manifestData, manifestErr := os.ReadFile(os.Getenv("PRIVATE_STEAM_BUNDLE_MANIFEST"))
	if manifestErr != nil {
		t.Fatal(manifestErr)
	}
	var bundle PrivateWorkerBundle
	if json.Unmarshal(manifestData, &bundle) != nil {
		t.Fatal("invalid test bundle inventory")
	}
	runner := PrivateJobRunner{Bundle: &bundle, Admission: a, Executable: exe, RuntimeRoot: os.Getenv("PRIVATE_STEAM_WORKER_RUNTIME_ROOT"), WorkerSHA256: hex.EncodeToString(h[:]), Provider: steamapi.PrivateProvider}
	err := runner.Run(context.Background(), r, func(steamapi.PrivateEvent) error { return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "storage_create_conflict") {
		t.Fatalf("actual worker did not reject pre-session admission: %v", err)
	}
	entries, _ := os.ReadDir(s.Target)
	if len(entries) != 0 {
		t.Fatal("target mutated")
	}
	prior := &steamapi.PrivateReceipt{Scope: r.Scope(), SHA256: strings.Repeat("c", 64), Files: "1"}
	prior.Path = prior.Scope.Server + "/" + prior.Scope.Owner + "/" + prior.Scope.Nonce + "/receipt.json"
	prior.PublisherPlan.App = 42
	prior.PublisherPlan.Build = "1"
	json.Unmarshal([]byte(`[{"publisher_app":42,"depot":43,"manifest":"1"}]`), &prior.PublisherPlan.Depots)
	next := r
	next.Job = "33333333-3333-3333-3333-333333333333"
	next.Nonce = strings.Repeat("e", 64)
	next.Previous = prior
	stages := []string{}
	err = runner.Run(context.Background(), next, func(e steamapi.PrivateEvent) error { stages = append(stages, e.Stage); return nil }, nil)
	if err == nil || !strings.Contains(err.Error(), "previous publication validation failed") {
		t.Fatalf("prior boundary not validated: %v", err)
	}
	if strings.Contains(strings.Join(stages, ","), "worker_started") {
		t.Fatal("content session started before prior validation")
	}
	runner.Provider = "fixture-private-content-v1"
	if runner.Run(context.Background(), r, func(steamapi.PrivateEvent) error { return nil }, nil) == nil {
		t.Fatal("fixture provider accepted")
	}
	_ = json.Valid(data)
}
func TestPrivatePersistedFixtureProviderRejected(t *testing.T) {
	a, s := privateJobDirectories(t)
	r := privateJobRequest()
	roots, e := a.Acquire(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	defer roots.Release()
	scope := r.Scope()
	path := scope.Server + "/" + scope.Owner + "/" + scope.Nonce + "/receipt.json"
	os.MkdirAll(filepath.Dir(filepath.Join(s.Work, path)), 0700)
	os.WriteFile(filepath.Join(s.Work, path), []byte(`{"provider":"fixture-private-content-v1","entitlement_verified":false,"publication_committed":true,"native_acceptance_verified":false,"account_entitlement_verified":false,"access_proof":"fixture"}`), 0600)
	raw, _ := json.Marshal(map[string]any{"path": path})
	if validatePrivateProvider(roots.Work, raw) == nil {
		t.Fatal("persisted fixture provider accepted without terminal marker")
	}
}
func TestPrivateJobAdmissionIdentityAndPermissions(t *testing.T) {
	r := privateJobRequest()
	for _, kind := range []string{"overlap", "mode", "rename"} {
		a, s := privateJobDirectories(t)
		switch kind {
		case "overlap":
			s.Cache = s.Work
			a.Roots[r.Server+":"+r.Owner] = s
		case "mode":
			os.Chmod(s.Cache, 0755)
		case "rename":
			os.Rename(s.Work, s.Work+"-old")
			os.Symlink(s.Work+"-old", s.Work)
		}
		if _, e := a.Acquire(context.Background(), r); e == nil {
			t.Fatal(kind + " admitted")
		}
	}
}
func TestPrivateWorkerClosedWorld(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "worker")
	os.WriteFile(p, []byte("immutable"), 0700)
	sum := sha256.Sum256([]byte("immutable"))
	manifest := map[string]string{"worker": hex.EncodeToString(sum[:])}
	if e := verifyPrivateInventory(root, manifest); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(root, "extra.dll"), []byte("unexpected"), 0600)
	if verifyPrivateInventory(root, manifest) == nil {
		t.Fatal("extra managed library accepted")
	}
	os.Remove(filepath.Join(root, "extra.dll"))
	os.WriteFile(p, []byte("replaced"), 0700)
	if verifyPrivateInventory(root, manifest) == nil {
		t.Fatal("replacement accepted")
	}
	os.Remove(p)
	os.Symlink("/bin/true", p)
	if verifyPrivateInventory(root, manifest) == nil {
		t.Fatal("symlink worker accepted")
	}
}
func TestPrivateActualFrameRejectedBeforeAdmission(t *testing.T) {
	r := privateJobRequest()
	r.Password = strings.Repeat("x", 65536)
	runner := PrivateJobRunner{Admission: &PrivateDirectoryAdmission{}, Provider: steamapi.PrivateProvider, Bundle: &PrivateWorkerBundle{Provider: steamapi.PrivateProvider}}
	e := runner.Run(context.Background(), r, func(steamapi.PrivateEvent) error { return nil }, nil)
	if e == nil || !strings.Contains(e.Error(), "request frame rejected") {
		t.Fatal("exact worker frame was not checked before bundle/admission")
	}
}
func TestPrivateJobActualCoordinatorFixture(t *testing.T) {
	exe := os.Getenv("PRIVATE_STEAM_FIXTURE_EXECUTABLE")
	if exe == "" {
		t.Skip("requires separately named real-coordinator offline harness")
	}
	a, s := privateJobDirectories(t)
	r := privateJobRequest()
	roots, e := a.Acquire(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	defer roots.Release()
	p := PrivateContentProcess{Executable: exe, RuntimeRoot: os.Getenv("PRIVATE_STEAM_WORKER_RUNTIME_ROOT"), Target: roots.Target, Work: roots.Work, Cache: roots.Cache, Guard: func(ctx context.Context, c PrivateGuardChallenge) (PrivateGuardReply, error) {
		code := "fixture-code"
		return PrivateGuardReply{ChallengeID: c.ChallengeID, Kind: c.Kind, Code: &code}, nil
	}}
	raw, e := p.Run(context.Background(), PrivateContentRequest{Operation: "private_content", AppID: 42, Branch: "preview", Username: "fixture-account", Password: "fixture-password", ParentFieldsValidated: true, Content: map[string]any{"scope": r.Scope(), "platform": "linux", "architecture": "64", "language": "english", "dlc_apps": []uint32{}, "protected_roots": []string{}, "content_budget": "1048576", "rollback_reserve": "4096", "cache_quota": "1048576", "deadline_seconds": 20}})
	if e != nil {
		t.Fatal(e)
	}
	payload, e := os.ReadFile(filepath.Join(s.Target, "bin/server"))
	if e != nil || string(payload) != "offline real coordinator payload" {
		t.Fatal("actual coordinator payload absent")
	}
	if !strings.Contains(string(raw), "fixture-private-content-v1") {
		t.Fatal("fixture provenance absent")
	}
	if r.CheckReceipt(raw) == nil {
		t.Fatal("fixture reference promoted to private entitlement")
	}
	if validatePrivateProvider(roots.Work, raw) == nil {
		t.Fatal("persisted fixture promoted to private entitlement")
	}
	var reference steamapi.PrivateReceipt
	json.Unmarshal(raw, &reference)
	stripped, _ := json.Marshal(reference)
	if validatePrivateProvider(roots.Work, stripped) == nil {
		t.Fatal("marker-stripped persisted fixture accepted")
	}
}
