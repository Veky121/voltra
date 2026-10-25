//go:build linux

package nodeagent

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"voltra/internal/steamexec"
)

var candidateHash = regexp.MustCompile(`^[a-f0-9]{64}$`)
var candidateRuntime = regexp.MustCompile(`^10\.0\.[0-9]+$`)
var errCandidate = errors.New("private Steam candidate verification rejected")

func candidateDigest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func candidatePath(p string) bool {
	if p == "" || len(p) > 200 || path.Clean(p) != p || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\:") {
		return false
	}
	for _, c := range p {
		if c < 32 || c == 127 {
			return false
		}
	}
	for _, part := range strings.Split(p, "/") {
		if part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return false
		}
	}
	return true
}
func candidateManifest(raw []byte, trusted string) (*PrivateCandidateManifest, error) {
	if len(raw) == 0 || len(raw) > 8<<20 || !candidateHash.MatchString(trusted) || candidateDigest(raw) != trusted {
		return nil, errCandidate
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil, errCandidate
	}
	for _, key := range []string{"version", "provider", "rid", "entrypoint", "runtime_root", "runtime_version", "sdk", "source_inputs_sha256", "worker_tar_sha256", "source_tar_sha256", "files", "source_files", "production_enabled"} {
		if fields[key] == nil {
			return nil, errCandidate
		}
	}
	var m PrivateCandidateManifest
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&m) != nil || m.Version != 1 || m.Provider != "steamkit-depot-v1" || m.RID != "linux-x64" || m.Entrypoint != "worker/SteamPrivateContentWorker" || m.RuntimeRoot != "runtime" || !candidateRuntime.MatchString(m.RuntimeVersion) || m.SDK != "10.0.402" || m.ProductionEnabled || !bytes.Equal(bytes.TrimSpace(fields["production_enabled"]), []byte("false")) || !candidateHash.MatchString(m.InputsSHA256) || !candidateHash.MatchString(m.WorkerTarSHA256) || !candidateHash.MatchString(m.SourceTarSHA256) {
		return nil, errCandidate
	}
	for _, list := range [][]PrivateCandidateFile{m.Files, m.SourceFiles} {
		if len(list) == 0 || len(list) > 20000 {
			return nil, errCandidate
		}
		seen := map[string]bool{}
		componentCases := map[string]string{}
		var total int64
		for _, f := range list {
			lower := strings.ToLower(f.Path)
			if !candidatePath(f.Path) || seen[lower] || !candidateHash.MatchString(f.SHA256) || f.Bytes < 0 || f.Bytes > 512<<20 || (f.Mode != 0644 && f.Mode != 0755) || strings.Contains(f.Path, "OfflinePrivateContentFixture") || strings.Contains(f.Path, "DepotDownloader") {
				return nil, errCandidate
			}
			component := ""
			for _, part := range strings.Split(f.Path, "/") {
				if component != "" {
					component += "/"
				}
				component += part
				lowerPart := strings.ToLower(component)
				if prior, ok := componentCases[lowerPart]; ok && prior != component {
					return nil, errCandidate
				}
				componentCases[lowerPart] = component
			}
			seen[lower] = true
			total += f.Bytes
			if total > 512<<20 {
				return nil, errCandidate
			}
		}
		for _, f := range list {
			for p := path.Dir(f.Path); p != "."; p = path.Dir(p) {
				if seen[strings.ToLower(p)] {
					return nil, errCandidate
				}
			}
		}
	}
	required := func(files []PrivateCandidateFile, names []string) bool {
		for _, name := range names {
			found := false
			for _, f := range files {
				if f.Path == name && f.Bytes > 0 {
					found = true
				}
			}
			if !found {
				return false
			}
		}
		return true
	}
	if !required(m.Files, []string{m.Entrypoint, "worker/SteamPrivateContentWorker.dll", "worker/SteamPrivateContentWorker.deps.json", "worker/SteamPrivateContentWorker.runtimeconfig.json", "runtime/dotnet", "runtime/LICENSE.txt", "runtime/ThirdPartyNotices.txt", "licenses/LGPL-2.1-full.txt", "licenses/Voltra-MIT.txt", "licenses/Apache-2.0.txt", "licenses/protobuf-net-Licence.txt", "licenses/SteamKit2-3.5.0-license.txt", "licenses/System.IO.Hashing-10.0.12-THIRD-PARTY-NOTICES.TXT", "licenses/System.IO.Hashing-LICENSE.TXT", "licenses/ZstdSharp-LICENSE", "runtime/host/fxr/" + m.RuntimeVersion + "/libhostfxr.so", "runtime/shared/Microsoft.NETCore.App/" + m.RuntimeVersion + "/libcoreclr.so", "runtime/shared/Microsoft.NETCore.App/" + m.RuntimeVersion + "/libhostpolicy.so", "runtime/shared/Microsoft.NETCore.App/" + m.RuntimeVersion + "/System.Private.CoreLib.dll"}) || !required(m.SourceFiles, []string{"worker/ContentWorker.csproj", "worker/packages.lock.json", "BUILD-AND-RELINK.txt", "corresponding-source/SteamKit-49387aec55c24104946af7a7b160148358e538b4.tar.gz", "inputs.json"}) {
		return nil, errCandidate
	}
	return &m, nil
}
func candidateTrustedDirectory(base string) error {
	if !filepath.IsAbs(base) || filepath.Clean(base) != base {
		return errCandidate
	}
	for p := base; ; p = filepath.Dir(p) {
		s, e := os.Lstat(p)
		if e != nil || !s.IsDir() || s.Mode()&022 != 0 {
			return errCandidate
		}
		st, ok := s.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 {
			return errCandidate
		}
		if p == "/" {
			break
		}
	}
	return nil
}
func candidateSync(dir string) error {
	f, e := os.Open(dir)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}
func candidateWrite(p string, data []byte, mode os.FileMode) error {
	f, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if e != nil {
		return e
	}
	_, e = f.Write(data)
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	return e
}

type candidateReader struct {
	ctx context.Context
	r   io.Reader
}

func (c candidateReader) Read(b []byte) (int, error) {
	if e := c.ctx.Err(); e != nil {
		return 0, e
	}
	return c.r.Read(b)
}
func candidateExtract(ctx context.Context, stage, prefix string, input io.Reader, hash string, list []PrivateCandidateFile) error {
	if input == nil {
		return errCandidate
	}
	var limit int64 = 10240 + int64(len(list))*2048
	expected := map[string]PrivateCandidateFile{}
	for _, f := range list {
		limit += f.Bytes
		expected[f.Path] = f
	}
	archive := filepath.Join(stage, prefix+".archive")
	out, e := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer out.Close()
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(out, h), io.LimitReader(candidateReader{ctx, input}, limit+1))
	if e != nil || n > limit || hex.EncodeToString(h.Sum(nil)) != hash {
		return errCandidate
	}
	if _, e = out.Seek(0, io.SeekStart); e != nil {
		return e
	}
	root := filepath.Join(stage, prefix)
	if os.Mkdir(root, 0755) != nil {
		return errCandidate
	}
	reader := tar.NewReader(out)
	seen := map[string]bool{}
	for {
		header, e := reader.Next()
		if e == io.EOF {
			break
		}
		if e != nil || header.Typeflag != tar.TypeReg || header.Format != tar.FormatUSTAR || !candidatePath(header.Name) {
			return errCandidate
		}
		f, ok := expected[header.Name]
		if !ok || seen[header.Name] || header.Size != f.Bytes || header.Mode != int64(f.Mode) || header.Uid != 0 || header.Gid != 0 || header.Linkname != "" {
			return errCandidate
		}
		seen[header.Name] = true
		p := filepath.Join(root, filepath.FromSlash(header.Name))
		if e = os.MkdirAll(filepath.Dir(p), 0755); e != nil {
			return e
		}
		file, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(f.Mode))
		if e != nil {
			return e
		}
		sum := sha256.New()
		count, e := io.Copy(io.MultiWriter(file, sum), candidateReader{ctx, reader})
		if e == nil {
			e = file.Chmod(os.FileMode(f.Mode))
		}
		if e == nil {
			e = file.Sync()
		}
		file.Close()
		if e != nil || count != f.Bytes || hex.EncodeToString(sum.Sum(nil)) != f.SHA256 {
			return errCandidate
		}
	}
	if len(seen) != len(expected) {
		return errCandidate
	}
	if e = out.Close(); e != nil {
		return e
	}
	return os.Remove(archive)
}
func candidateExpected(m *PrivateCandidateManifest) map[string]PrivateCandidateFile {
	all := map[string]PrivateCandidateFile{}
	for prefix, list := range map[string][]PrivateCandidateFile{"binary": m.Files, "source": m.SourceFiles} {
		for _, f := range list {
			f.Path = prefix + "/" + f.Path
			all[f.Path] = f
		}
	}
	return all
}
func candidateVerifyTree(root string, m *PrivateCandidateManifest, raw []byte, digest string, partial bool) error {
	all := candidateExpected(m)
	dirs := map[string]bool{".": true}
	for name := range all {
		for p := path.Dir(name); p != "."; p = path.Dir(p) {
			dirs[p] = true
		}
	}
	meta := map[string]bool{"intent.json": true, "manifest.json": true, "complete.json": true}
	if partial {
		meta["binary.archive"] = true
		meta["source.archive"] = true
	}
	seen := map[string]bool{}
	e := filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return errCandidate
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		s, e := d.Info()
		if e != nil {
			return errCandidate
		}
		st, ok := s.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 || st.Gid != 0 || s.Mode()&022 != 0 || s.Mode()&os.ModeSymlink != 0 {
			return errCandidate
		}
		if s.IsDir() {
			if !dirs[rel] {
				return errCandidate
			}
			return nil
		}
		if !s.Mode().IsRegular() || st.Nlink != 1 {
			return errCandidate
		}
		f, ok := all[rel]
		if !ok {
			if !meta[rel] {
				return errCandidate
			}
			if partial {
				return nil
			}
			if rel == "manifest.json" {
				b, e := os.ReadFile(p)
				if e != nil || !bytes.Equal(b, raw) {
					return errCandidate
				}
				return nil
			}
			b, e := os.ReadFile(p)
			if e != nil || string(b) != digest+"\n" {
				return errCandidate
			}
			return nil
		}
		seen[rel] = true
		if partial {
			return nil
		}
		if s.Size() != f.Bytes || s.Mode().Perm() != os.FileMode(f.Mode) {
			return errCandidate
		}
		file, e := os.Open(p)
		if e != nil {
			return e
		}
		h := sha256.New()
		_, e = io.Copy(h, file)
		file.Close()
		if e != nil || hex.EncodeToString(h.Sum(nil)) != f.SHA256 {
			return errCandidate
		}
		return nil
	})
	if e != nil {
		return e
	}
	if !partial {
		if len(seen) != len(all) {
			return errCandidate
		}
		for _, p := range []string{"manifest.json", "intent.json", "complete.json"} {
			if _, e = os.Stat(filepath.Join(root, p)); e != nil {
				return errCandidate
			}
		}
	}
	return nil
}
func candidateFsyncTree(root string) error {
	var dirs []string
	e := filepath.WalkDir(root, func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			dirs = append(dirs, p)
		}
		return nil
	})
	if e != nil {
		return e
	}
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	for _, p := range dirs {
		if e = candidateSync(p); e != nil {
			return e
		}
	}
	return nil
}
func candidateInstallation(root, digest string, m *PrivateCandidateManifest) *PrivateCandidateInstallation {
	bundle := &steamexec.PrivateWorkerBundle{Provider: m.Provider, Root: filepath.Join(root, "binary/worker"), Files: map[string]string{}, RuntimeRoot: filepath.Join(root, "binary/runtime"), RuntimeFiles: map[string]string{}}
	for _, f := range m.Files {
		if strings.HasPrefix(f.Path, "worker/") {
			bundle.Files[strings.TrimPrefix(f.Path, "worker/")] = f.SHA256
		}
		if strings.HasPrefix(f.Path, "runtime/") {
			bundle.RuntimeFiles[strings.TrimPrefix(f.Path, "runtime/")] = f.SHA256
		}
	}
	return &PrivateCandidateInstallation{root, digest, bundle}
}
func installPrivateCandidate(ctx context.Context, base string, raw []byte, trusted string, binary, source io.Reader, fault func(string) error) (*PrivateCandidateInstallation, error) {
	if runtime.GOARCH != "amd64" {
		return nil, errors.New("private Steam candidate requires Linux amd64")
	}
	m, e := candidateManifest(raw, trusted)
	if e != nil {
		return nil, e
	}
	if e = candidateTrustedDirectory(base); e != nil {
		return nil, e
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	lock, e := os.OpenFile(filepath.Join(base, ".candidate-install.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if e != nil {
		return nil, errCandidate
	}
	defer lock.Close()
	lockInfo, lockErr := lock.Stat()
	if lockErr != nil || !lockInfo.Mode().IsRegular() || lockInfo.Mode()&022 != 0 {
		return nil, errCandidate
	}
	lockStat, ok := lockInfo.Sys().(*syscall.Stat_t)
	if !ok || lockStat.Uid != 0 || lockStat.Gid != 0 || lockStat.Nlink != 1 {
		return nil, errCandidate
	}
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return nil, errors.New("private Steam candidate install already active")
	}
	final := filepath.Join(base, trusted)
	stage := filepath.Join(base, ".candidate-"+trusted)
	if _, e = os.Lstat(final); e == nil {
		if candidateVerifyTree(final, m, raw, trusted, false) != nil {
			return nil, errCandidate
		}
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		if fault != nil {
			if e = fault("before_idempotent_parent_sync"); e != nil {
				return nil, e
			}
		}
		if e = candidateSync(base); e != nil {
			return nil, e
		}
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		if fault != nil {
			if e = fault("after_idempotent_parent_sync"); e != nil {
				return nil, e
			}
		}
		return candidateInstallation(final, trusted, m), nil
	} else if !os.IsNotExist(e) {
		return nil, errCandidate
	}
	if _, e = os.Lstat(stage); e == nil {
		if candidateVerifyTree(stage, m, raw, trusted, true) != nil {
			return nil, errCandidate
		}
		intent, e := os.ReadFile(filepath.Join(stage, "intent.json"))
		if e != nil || string(intent) != trusted+"\n" {
			return nil, errors.New("private Steam candidate staging recovery requires operator review")
		}
		if e = os.RemoveAll(stage); e != nil {
			return nil, e
		}
		if e = candidateSync(base); e != nil {
			return nil, e
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	if e = os.Mkdir(stage, 0700); e != nil {
		return nil, e
	}
	if e = candidateWrite(filepath.Join(stage, "intent.json"), []byte(trusted+"\n"), 0600); e != nil {
		return nil, e
	}
	if e = candidateSync(stage); e != nil {
		return nil, e
	}
	if e = candidateSync(base); e != nil {
		return nil, e
	}
	check := func(s string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if fault != nil {
			return fault(s)
		}
		return nil
	}
	if e = candidateExtract(ctx, stage, "binary", binary, m.WorkerTarSHA256, m.Files); e != nil {
		return nil, e
	}
	if e = candidateExtract(ctx, stage, "source", source, m.SourceTarSHA256, m.SourceFiles); e != nil {
		return nil, e
	}
	if e = check("after_extract"); e != nil {
		return nil, e
	}
	if e = candidateWrite(filepath.Join(stage, "manifest.json"), raw, 0600); e != nil {
		return nil, e
	}
	if e = candidateWrite(filepath.Join(stage, "complete.json"), []byte(trusted+"\n"), 0600); e != nil {
		return nil, e
	}
	if e = candidateFsyncTree(stage); e != nil {
		return nil, e
	}
	if e = candidateVerifyTree(stage, m, raw, trusted, false); e != nil {
		return nil, e
	}
	if e = check("before_rename"); e != nil {
		return nil, e
	}
	if e = os.Rename(stage, final); e != nil {
		return nil, e
	}
	if e = check("after_rename"); e != nil {
		return nil, e
	}
	if e = candidateSync(base); e != nil {
		return nil, fmt.Errorf("candidate rename committed but parent sync unconfirmed: %w", e)
	}
	if e = check("after_parent_sync"); e != nil {
		return nil, e
	}
	return candidateInstallation(final, trusted, m), nil
}
