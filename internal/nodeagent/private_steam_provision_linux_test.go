//go:build linux

package nodeagent

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

type candidateFixture struct {
	m                   PrivateCandidateManifest
	raw, binary, source []byte
	trust               string
}

func candidateTestFixture(t *testing.T) candidateFixture {
	t.Helper()
	names := []string{"worker/SteamPrivateContentWorker", "worker/SteamPrivateContentWorker.dll", "worker/SteamPrivateContentWorker.deps.json", "worker/SteamPrivateContentWorker.runtimeconfig.json", "runtime/dotnet", "runtime/LICENSE.txt", "runtime/ThirdPartyNotices.txt", "licenses/LGPL-2.1-full.txt", "licenses/Voltra-MIT.txt", "licenses/Apache-2.0.txt", "licenses/protobuf-net-Licence.txt", "licenses/SteamKit2-3.5.0-license.txt", "licenses/System.IO.Hashing-10.0.12-THIRD-PARTY-NOTICES.TXT", "licenses/System.IO.Hashing-LICENSE.TXT", "licenses/ZstdSharp-LICENSE", "runtime/host/fxr/10.0.13/libhostfxr.so", "runtime/shared/Microsoft.NETCore.App/10.0.13/libcoreclr.so", "runtime/shared/Microsoft.NETCore.App/10.0.13/libhostpolicy.so", "runtime/shared/Microsoft.NETCore.App/10.0.13/System.Private.CoreLib.dll"}
	source := []string{"worker/ContentWorker.csproj", "worker/packages.lock.json", "BUILD-AND-RELINK.txt", "corresponding-source/SteamKit-49387aec55c24104946af7a7b160148358e538b4.tar.gz", "inputs.json"}
	makeArchive := func(paths []string) ([]PrivateCandidateFile, []byte) {
		var b bytes.Buffer
		w := tar.NewWriter(&b)
		var files []PrivateCandidateFile
		for _, p := range paths {
			data := []byte("synthetic filesystem fixture " + p)
			mode := int64(0644)
			if p == "worker/SteamPrivateContentWorker" || p == "runtime/dotnet" {
				mode = 0755
			}
			if e := w.WriteHeader(&tar.Header{Name: p, Mode: mode, Size: int64(len(data)), Typeflag: tar.TypeReg, Format: tar.FormatUSTAR}); e != nil {
				t.Fatal(e)
			}
			w.Write(data)
			files = append(files, PrivateCandidateFile{p, candidateDigest(data), int64(len(data)), uint32(mode)})
		}
		w.Close()
		return files, b.Bytes()
	}
	files, bin := makeArchive(names)
	sources, src := makeArchive(source)
	m := PrivateCandidateManifest{Version: 1, Provider: "steamkit-depot-v1", RID: "linux-x64", Entrypoint: "worker/SteamPrivateContentWorker", RuntimeRoot: "runtime", RuntimeVersion: "10.0.13", SDK: "10.0.402", InputsSHA256: strings.Repeat("a", 64), WorkerTarSHA256: candidateDigest(bin), SourceTarSHA256: candidateDigest(src), Files: files, SourceFiles: sources}
	raw, _ := json.Marshal(m)
	return candidateFixture{m, raw, bin, src, candidateDigest(raw)}
}
func (f candidateFixture) install(ctx context.Context, base string, fault func(string) error) (*PrivateCandidateInstallation, error) {
	return installPrivateCandidate(ctx, base, f.raw, f.trust, bytes.NewReader(f.binary), bytes.NewReader(f.source), fault)
}
func TestPrivateCandidateStrictInstall(t *testing.T) {
	f := candidateTestFixture(t)
	base := t.TempDir()
	install, e := f.install(context.Background(), base, nil)
	if e != nil {
		t.Fatal(e)
	}
	if install.Bundle.Root != filepath.Join(base, f.trust, "binary/worker") {
		t.Fatal("unconfined result")
	}
	before, _ := os.Stat(filepath.Join(install.Root, "binary/worker/SteamPrivateContentWorker"))
	again, e := f.install(context.Background(), base, nil)
	if e != nil || again.Root != install.Root {
		t.Fatal("idempotence failed", e)
	}
	after, _ := os.Stat(filepath.Join(install.Root, "binary/worker/SteamPrivateContentWorker"))
	if !os.SameFile(before, after) {
		t.Fatal("idempotence rewrote owned executable")
	}
	os.WriteFile(filepath.Join(install.Root, "binary/worker/operator.keep"), []byte("operator"), 0600)
	if _, e = f.install(context.Background(), base, nil); e == nil {
		t.Fatal("unexpected installed file accepted")
	}
}
func TestPrivateCandidateArchiveAttacks(t *testing.T) {
	for _, kind := range []string{"traversal", "absolute", "symlink", "hardlink", "duplicate", "extra", "mode", "size", "hash", "trust", "missing-source", "missing-license", "wrong-rid", "fixture"} {
		t.Run(kind, func(t *testing.T) {
			f := candidateTestFixture(t)
			if kind == "trust" {
				f.trust = strings.Repeat("0", 64)
			} else if kind == "missing-source" {
				f.m.SourceFiles = f.m.SourceFiles[1:]
			} else if kind == "missing-license" {
				for i, v := range f.m.Files {
					if v.Path == "licenses/LGPL-2.1-full.txt" {
						f.m.Files = append(f.m.Files[:i], f.m.Files[i+1:]...)
						break
					}
				}
			} else if kind == "wrong-rid" {
				f.m.RID = "linux-arm64"
			} else if kind == "fixture" {
				f.m.Provider = "fixture-private-content-v1"
			} else {
				var b bytes.Buffer
				w := tar.NewWriter(&b)
				r := tar.NewReader(bytes.NewReader(f.binary))
				first := true
				for {
					h, e := r.Next()
					if e == io.EOF {
						break
					}
					data, _ := io.ReadAll(r)
					if first {
						switch kind {
						case "traversal":
							h.Name = "../escape"
						case "absolute":
							h.Name = "/escape"
						case "symlink":
							h.Typeflag = tar.TypeSymlink
							h.Linkname = "/etc/passwd"
							h.Size = 0
							data = nil
						case "hardlink":
							h.Typeflag = tar.TypeLink
							h.Linkname = "/etc/passwd"
							h.Size = 0
							data = nil
						case "mode":
							h.Mode = 0777
						case "size":
							h.Size++
							data = append(data, 'x')
						case "hash":
							data[0] = 'X'
						}
						first = false
					}
					w.WriteHeader(h)
					w.Write(data)
					if kind == "duplicate" && h.Name == "worker/SteamPrivateContentWorker" {
						w.WriteHeader(h)
						w.Write(data)
					}
				}
				if kind == "extra" {
					w.WriteHeader(&tar.Header{Name: "extra", Mode: 0644, Size: 1, Typeflag: tar.TypeReg, Format: tar.FormatUSTAR})
					w.Write([]byte("x"))
				}
				w.Close()
				f.binary = b.Bytes()
				f.m.WorkerTarSHA256 = candidateDigest(f.binary)
			}
			if kind != "trust" {
				f.raw, _ = json.Marshal(f.m)
				f.trust = candidateDigest(f.raw)
			}
			base := t.TempDir()
			if _, e := f.install(context.Background(), base, nil); e == nil {
				t.Fatal("unsafe candidate accepted")
			}
			if _, e := os.Stat(filepath.Join(base, f.trust)); !os.IsNotExist(e) {
				t.Fatal("unsafe candidate published")
			}
		})
	}
}
func TestPrivateCandidateRecoveryAndOwnership(t *testing.T) {
	for _, point := range []string{"after_extract", "before_rename", "after_rename", "after_parent_sync"} {
		t.Run(point, func(t *testing.T) {
			f := candidateTestFixture(t)
			base := t.TempDir()
			_, e := f.install(context.Background(), base, func(s string) error {
				if s == point {
					return errors.New("injected crash boundary")
				}
				return nil
			})
			if e == nil {
				t.Fatal("fault ignored")
			}
			if _, e = f.install(context.Background(), base, nil); e != nil {
				t.Fatal("recovery failed", e)
			}
		})
	}
	f := candidateTestFixture(t)
	base := t.TempDir()
	f.install(context.Background(), base, func(string) error { return errors.New("stop") })
	stage := filepath.Join(base, ".candidate-"+f.trust)
	os.WriteFile(filepath.Join(stage, "unknown.operator"), []byte("retain"), 0600)
	if _, e := f.install(context.Background(), base, nil); e == nil {
		t.Fatal("unknown staging file deleted")
	}
	b, _ := os.ReadFile(filepath.Join(stage, "unknown.operator"))
	if string(b) != "retain" {
		t.Fatal("operator staging file lost")
	}
}
func TestPrivateCandidateCancellationAndLock(t *testing.T) {
	f := candidateTestFixture(t)
	base := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := f.install(ctx, base, nil); e == nil {
		t.Fatal("canceled candidate installed")
	}
	lock, e := os.OpenFile(filepath.Join(base, ".candidate-install.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Close()
	syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if _, e = f.install(context.Background(), base, nil); e == nil {
		t.Fatal("parallel candidate ignored lock")
	}
	syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if _, e = f.install(context.Background(), base, nil); e != nil {
		t.Fatal(e)
	}
}
func TestPrivateCandidateCrashChild(t *testing.T) {
	if os.Getenv("PRIVATE_CANDIDATE_CHILD") != "1" {
		return
	}
	base := os.Getenv("PRIVATE_CANDIDATE_BASE")
	f := candidateTestFixture(t)
	_, e := f.install(context.Background(), base, func(stage string) error {
		if stage == os.Getenv("PRIVATE_CANDIDATE_POINT") {
			os.Exit(71)
		}
		return nil
	})
	t.Fatal("crash child did not exit", e)
}
func TestPrivateCandidateActualCrashRecovery(t *testing.T) {
	for _, point := range []string{"after_extract", "before_rename", "after_rename"} {
		t.Run(point, func(t *testing.T) {
			base := t.TempDir()
			cmd := exec.Command(os.Args[0], "-test.run=^TestPrivateCandidateCrashChild$")
			cmd.Env = append(os.Environ(), "PRIVATE_CANDIDATE_CHILD=1", "PRIVATE_CANDIDATE_BASE="+base, "PRIVATE_CANDIDATE_POINT="+point)
			e := cmd.Run()
			exit, ok := e.(*exec.ExitError)
			if !ok || exit.ExitCode() != 71 {
				t.Fatal("real child crash missing", e)
			}
			f := candidateTestFixture(t)
			if _, e = f.install(context.Background(), base, nil); e != nil {
				t.Fatal("interrupted candidate recovery failed", e)
			}
		})
	}
}
func TestPrivateCandidateActualWorkerFinalLayout(t *testing.T) {
	dir := os.Getenv("PRIVATE_STEAM_CANDIDATE_INPUT")
	trust := os.Getenv("PRIVATE_STEAM_CANDIDATE_TRUST")
	if dir == "" || trust == "" {
		t.Skip("requires candidate and separately approved manifest digest")
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
	installed, e := InstallPrivateCandidate(context.Background(), t.TempDir(), raw, trust, binary, source)
	if e != nil {
		t.Fatal(e)
	}
	r := privateNodeRequest()
	scope := r.Scope()
	base := t.TempDir()
	for _, v := range []string{"target", "work", "cache"} {
		os.Mkdir(filepath.Join(base, v), 0700)
	}
	prefix := filepath.Join(base, "work", scope.Server, scope.Owner, scope.Nonce)
	os.MkdirAll(prefix, 0700)
	os.WriteFile(filepath.Join(prefix, "admission.json"), []byte("prior admission"), 0600)
	probe := exec.Command(filepath.Join(installed.Root, "binary/worker/SteamPrivateContentWorker"), "--self-test")
	probe.Env = []string{"DOTNET_ROOT=" + installed.Bundle.RuntimeRoot, "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1", "DOTNET_EnableDiagnostics=0", "TMPDIR=" + os.TempDir()}
	probeOutput, probeErr := probe.CombinedOutput()
	if probeErr != nil {
		t.Fatalf("installed offline worker self-test startup failed: %v; %s", probeErr, probeOutput)
	}
	m, _ := candidateManifest(raw, trust)
	runner := &steamexec.PrivateJobRunner{Admission: &steamexec.PrivateDirectoryAdmission{Roots: map[string]steamexec.PrivateDirectorySet{r.Server + ":" + r.Owner: {Target: filepath.Join(base, "target"), Work: filepath.Join(base, "work"), Cache: filepath.Join(base, "cache")}}}, Executable: filepath.Join(installed.Root, "binary/worker/SteamPrivateContentWorker"), RuntimeRoot: installed.Bundle.RuntimeRoot, Provider: m.Provider, Bundle: installed.Bundle, WorkerSHA256: installed.Bundle.Files["SteamPrivateContentWorker"]}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	e = runner.Run(ctx, r, func(_event steamapi.PrivateEvent) error { return nil }, nil)
	if e == nil || !strings.Contains(e.Error(), "storage_create_conflict") {
		t.Fatal("installed actual worker failed offline admission boundary", e)
	}
}
func TestPrivateCandidateRetryCompletesParentSync(t *testing.T) {
	f := candidateTestFixture(t)
	base := t.TempDir()
	_, e := f.install(context.Background(), base, func(stage string) error {
		if stage == "after_rename" {
			return errors.New("parent sync not reached")
		}
		return nil
	})
	if e == nil {
		t.Fatal("rename fault ignored")
	}
	observed := []string{}
	_, e = f.install(context.Background(), base, func(stage string) error {
		observed = append(observed, stage)
		if stage == "before_idempotent_parent_sync" {
			return errors.New("retry sync injection")
		}
		return nil
	})
	if e == nil {
		t.Fatal("retry falsely claimed durability")
	}
	_, e = f.install(context.Background(), base, func(stage string) error { observed = append(observed, stage); return nil })
	if e != nil || !strings.Contains(strings.Join(observed, ","), "after_idempotent_parent_sync") {
		t.Fatal("idempotent retry did not complete parent sync", e)
	}
}
