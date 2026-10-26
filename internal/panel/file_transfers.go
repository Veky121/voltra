package panel

// Resumable transfers use tusd's protocol implementation and disk store. The
// browser-to-panel leg resumes independently of the final panel-to-Wings copy.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tus/tusd/v2/pkg/filelocker"
	"github.com/tus/tusd/v2/pkg/filestore"
	tus "github.com/tus/tusd/v2/pkg/handler"
	"github.com/tus/tusd/v2/pkg/memorylocker"
)

const transferChunkSize int64 = 16 << 20
const transferTTL = 7 * 24 * time.Hour

type transferScope struct{ user, server, node M }
type transferReceipt struct {
	Info        tus.FileInfo
	CompletedAt time.Time
}
type fileTransferManager struct {
	app          *App
	store        filestore.FileStore
	locker       *memorylocker.MemoryLocker
	diskLocker   filelocker.FileLocker
	createMu     sync.Mutex
	locks        [128]sync.Mutex
	stagingLimit int64
}

func (a *App) registerFileTransfers(mux *http.ServeMux) {
	dir := os.Getenv("VOLTRA_UPLOAD_DIR")
	if dir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			base = os.TempDir()
		}
		key := sha256.Sum256([]byte(a.Config.DatabaseURL + "|" + a.Config.PublicURL))
		dir = filepath.Join(base, "voltra", "uploads", hex.EncodeToString(key[:8]))
	}
	m, initErr := newFileTransferManager(a, dir)
	handle := func(w http.ResponseWriter, r *http.Request) {
		if initErr != nil {
			fail(w, &APIError{Status: 503, Code: "UploadStorageUnavailable", Detail: "Upload staging storage is unavailable"})
			return
		}
		s, err := a.server(r, "file.create")
		if err != nil {
			fail(w, err)
			return
		}
		u, err := a.user(r)
		if err != nil {
			fail(w, err)
			return
		}
		n, err := a.node(r.Context(), num(s["node_id"]))
		if err != nil {
			fail(w, err)
			return
		}
		m.serve(w, r, transferScope{u, s, n})
	}
	for _, pattern := range []string{
		"GET /api/client/servers/{server}/files/transfers",
		"POST /api/client/servers/{server}/files/transfers",
		"OPTIONS /api/client/servers/{server}/files/transfers",
		"HEAD /api/client/servers/{server}/files/transfers/{transfer}",
		"PATCH /api/client/servers/{server}/files/transfers/{transfer}",
		"DELETE /api/client/servers/{server}/files/transfers/{transfer}",
		"OPTIONS /api/client/servers/{server}/files/transfers/{transfer}",
		"POST /api/client/servers/{server}/files/transfers/{transfer}/complete",
	} {
		mux.HandleFunc(pattern, handle)
	}
	mux.HandleFunc("GET /api/client/servers/{server}/files/download-stream", a.streamServerFile)
	mux.HandleFunc("GET /api/client/servers/{server}/files/preview", a.streamServerFile)
}

func newFileTransferManager(a *App, dir string) (*fileTransferManager, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	store := filestore.New(dir)
	store.FileModePerm, store.DirModePerm = 0600, 0700
	limit, _ := strconv.ParseInt(os.Getenv("VOLTRA_UPLOAD_STAGING_LIMIT_BYTES"), 10, 64)
	diskLocker := filelocker.New(dir)
	diskLocker.AcquirerPollInterval = 25 * time.Millisecond
	return &fileTransferManager{app: a, store: store, locker: memorylocker.New(), diskLocker: diskLocker, stagingLimit: limit}, nil
}

func (m *fileTransferManager) acquireDiskLock(ctx context.Context, id string, timeout time.Duration) (func(), error) {
	lock, err := m.diskLocker.NewLock(id)
	if err != nil {
		return nil, err
	}
	wait, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// A waiting HEAD should not abort an in-flight finalization. The holder
	// finishes normally; callers may retry the 423 if acquisition times out.
	if err = lock.Lock(wait, func() {}); err != nil {
		return nil, &APIError{Status: 423, Code: "UploadBusy", Detail: "Another request is updating this upload; retry shortly"}
	}
	return func() { _ = lock.Unlock() }, nil
}

func (m *fileTransferManager) lock(id string) *sync.Mutex {
	h := fnv.New32a()
	_, _ = h.Write([]byte(id))
	return &m.locks[h.Sum32()%uint32(len(m.locks))]
}

func transferAcquireLocalLock(ctx context.Context, lock *sync.Mutex) (func(), error) {
	wait, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if lock.TryLock() {
			return lock.Unlock, nil
		}
		select {
		case <-wait.Done():
			return nil, &APIError{Status: 423, Code: "UploadBusy", Detail: "Another request is updating this upload; retry shortly"}
		case <-ticker.C:
		}
	}
}

func transferMaxFileSize(node M) int64 {
	mb := num(node["upload_size"])
	if mb <= 0 || mb > (1<<63-1)/(1<<20) {
		return 0
	}
	return mb * (1 << 20)
}

func transferMetadata(info tus.FileInfo, scope transferScope) (tus.MetaData, error) {
	name := info.MetaData["filename"]
	if name == "" || name == "." || name == ".." || len(name) > 255 || strings.ContainsAny(name, "/\x00") {
		return nil, bad("filename must be a single file name without path separators")
	}
	dir := info.MetaData["directory"]
	if dir == "" {
		dir = "/"
	}
	if strings.ContainsRune(dir, '\x00') || len(dir) > 4096 {
		return nil, bad("Invalid upload directory")
	}
	for _, p := range strings.Split(dir, "/") {
		if p == ".." {
			return nil, bad("Parent traversal is not allowed")
		}
	}
	dir = path.Clean("/" + strings.TrimLeft(dir, "/"))
	return tus.MetaData{"filename": name, "directory": dir, "owner": strconv.FormatInt(num(scope.user["id"]), 10), "server": str(scope.server["uuid"]), "node": strconv.FormatInt(num(scope.node["id"]), 10)}, nil
}

func transferOwned(info tus.FileInfo, scope transferScope) bool {
	return info.MetaData["owner"] == strconv.FormatInt(num(scope.user["id"]), 10) && info.MetaData["server"] == str(scope.server["uuid"]) && info.MetaData["node"] == strconv.FormatInt(num(scope.node["id"]), 10)
}

func (m *fileTransferManager) serve(w http.ResponseWriter, r *http.Request, scope transferScope) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("transfer")
	if id == "" && r.Method == http.MethodGet {
		writeJSON(w, 200, item("file_transfer_capabilities", M{"max_file_size": transferMaxFileSize(scope.node), "chunk_size": transferChunkSize, "expires_after_seconds": int64(transferTTL / time.Second), "staging_limit": m.stagingLimit}))
		return
	}
	if id != "" {
		if len(id) != 32 || strings.Trim(id, "0123456789abcdef") != "" {
			fail(w, notFound())
			return
		}
		lock := m.lock(id)
		unlock, err := transferAcquireLocalLock(r.Context(), lock)
		if err != nil {
			fail(w, err)
			return
		}
		defer unlock()
		release, err := m.acquireDiskLock(r.Context(), id, 20*time.Second)
		if err != nil {
			fail(w, err)
			return
		}
		defer release()
		info, done, err := m.info(r.Context(), id)
		if err != nil || !transferOwned(info, scope) {
			fail(w, notFound())
			return
		}
		if done != nil {
			if r.Method == http.MethodDelete {
				_ = os.Remove(m.receiptPath(id))
				w.WriteHeader(204)
				return
			}
			if r.Method == http.MethodHead {
				w.Header().Set("Tus-Resumable", "1.0.0")
				w.Header().Set("Upload-Length", strconv.FormatInt(info.Size, 10))
				w.Header().Set("Upload-Offset", strconv.FormatInt(info.Size, 10))
				w.Header().Set("Upload-Complete", "true")
				w.WriteHeader(200)
				return
			}
			if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/complete") {
				m.writeCompleted(w, info)
				return
			}
			fail(w, &APIError{Status: 409, Code: "UploadCompleted", Detail: "This upload has already been committed"})
			return
		}
		// Refresh expiry even for a paused upload when the browser checks its offset.
		stamp := time.Now()
		_ = os.Chtimes(filepath.Join(m.store.Path, id+".info"), stamp, stamp)
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/complete") {
			if info.SizeIsDeferred || info.Offset != info.Size {
				fail(w, &APIError{Status: 409, Code: "UploadIncomplete", Detail: "Upload has not finished transferring"})
				return
			}
			if max := transferMaxFileSize(scope.node); max > 0 && info.Size > max {
				fail(w, &APIError{Status: 413, Code: "UploadTooLarge", Detail: "File exceeds the node upload limit"})
				return
			}
			if err := m.complete(r.Context(), scope, info); err != nil {
				fail(w, err)
				return
			}
			m.writeCompleted(w, info)
			return
		}
		if r.Method == http.MethodDelete {
			if _, err := os.Stat(m.commitPath(id)); err == nil {
				if _, err = m.recoverCommit(r.Context(), scope, info); err != nil {
					fail(w, err)
					return
				}
				m.removeRemoteTemp(scope, info, ".voltra-upload-"+id)
			}
			_ = os.Remove(m.commitPath(id))
		}
	}
	// Serialize creation and quota reservation. Session operations are separately
	// serialized above, while tusd's locker protects protocol-level operations.
	if id == "" && r.Method == http.MethodPost {
		m.createMu.Lock()
		defer m.createMu.Unlock()
		release, err := m.acquireDiskLock(r.Context(), "create", 20*time.Second)
		if err != nil {
			fail(w, err)
			return
		}
		defer release()
		m.cleanup(time.Now())
	}
	composer := tus.NewStoreComposer()
	m.store.UseIn(composer)
	m.locker.UseIn(composer)
	base := "/api/client/servers/" + url.PathEscape(r.PathValue("server")) + "/files/transfers/"
	h, err := tus.NewHandler(tus.Config{
		StoreComposer: composer, BasePath: base, MaxSize: transferMaxFileSize(scope.node), DisableDownload: true, DisableConcatenation: true,
		Cors: &tus.CorsConfig{Disable: true},
		PreUploadCreateCallback: func(hook tus.HookEvent) (tus.HTTPResponse, tus.FileInfoChanges, error) {
			if hook.Upload.SizeIsDeferred {
				return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("UPLOAD_LENGTH_REQUIRED", "Upload-Length is required", 400)
			}
			metadata, err := transferMetadata(hook.Upload, scope)
			if err != nil {
				return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("INVALID_METADATA", err.Error(), 400)
			}
			if m.stagingLimit > 0 {
				used, err := m.reservedBytes()
				if err != nil {
					return tus.HTTPResponse{}, tus.FileInfoChanges{}, err
				}
				if hook.Upload.Size > m.stagingLimit-used {
					return tus.HTTPResponse{}, tus.FileInfoChanges{}, tus.NewError("STAGING_CAPACITY", "Upload staging capacity is exhausted", 507)
				}
			}
			return tus.HTTPResponse{}, tus.FileInfoChanges{ID: randomToken(16), MetaData: metadata}, nil
		},
	})
	if err != nil {
		fail(w, err)
		return
	}
	clone := r.Clone(r.Context())
	clone.URL.Path = "/" + id
	clone.URL.RawPath = ""
	if r.Method == http.MethodPatch || r.Method == http.MethodPost {
		if r.ContentLength > transferChunkSize {
			fail(w, &APIError{Status: 413, Code: "ChunkTooLarge", Detail: "Upload chunks must be at most 16 MiB"})
			return
		}
		clone.Body = http.MaxBytesReader(w, r.Body, transferChunkSize)
	}
	h.ServeHTTP(&transferLocationWriter{ResponseWriter: w, base: base}, clone)
}

// Keep tus follow-up requests on the origin that created the upload. The native
// app supplies its credential through a local proxy, and HTTPS reverse proxies
// can expose a different scheme/hostname from the panel's internal listener.
type transferLocationWriter struct {
	http.ResponseWriter
	base string
}

func (w *transferLocationWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *transferLocationWriter) WriteHeader(status int) {
	if location, err := url.Parse(w.Header().Get("Location")); err == nil && strings.HasPrefix(location.Path, w.base) {
		w.Header().Set("Location", location.RequestURI())
	}
	w.ResponseWriter.WriteHeader(status)
}

func (m *fileTransferManager) receiptPath(id string) string {
	return filepath.Join(m.store.Path, id+".done")
}
func (m *fileTransferManager) info(ctx context.Context, id string) (tus.FileInfo, *transferReceipt, error) {
	data, err := os.ReadFile(m.receiptPath(id))
	if err == nil {
		var receipt transferReceipt
		if err = json.Unmarshal(data, &receipt); err != nil {
			return tus.FileInfo{}, nil, err
		}
		if time.Since(receipt.CompletedAt) > transferTTL {
			return tus.FileInfo{}, nil, os.ErrNotExist
		}
		return receipt.Info, &receipt, nil
	}
	if !os.IsNotExist(err) {
		return tus.FileInfo{}, nil, err
	}
	st, err := os.Stat(filepath.Join(m.store.Path, id+".info"))
	if err != nil {
		return tus.FileInfo{}, nil, os.ErrNotExist
	}
	if time.Since(st.ModTime()) > transferTTL {
		if _, err := os.Stat(m.commitPath(id)); err != nil {
			return tus.FileInfo{}, nil, os.ErrNotExist
		}
	}
	u, err := m.store.GetUpload(ctx, id)
	if err != nil {
		return tus.FileInfo{}, nil, err
	}
	i, err := u.GetInfo(ctx)
	return i, nil, err
}

func (m *fileTransferManager) reservedBytes() (int64, error) {
	entries, err := os.ReadDir(m.store.Path)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".info") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(m.store.Path, entry.Name()))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return 0, err
		}
		var info tus.FileInfo
		if err = json.Unmarshal(data, &info); err != nil {
			return 0, err
		}
		if info.Size > (1<<63-1)-total {
			return 1<<63 - 1, nil
		}
		total += info.Size
	}
	return total, nil
}

// Expired staging data is removed on creation rather than keeping a background
// goroutine alive after App shutdown. Active sessions are never swept.
func (m *fileTransferManager) cleanup(now time.Time) {
	entries, err := os.ReadDir(m.store.Path)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".info") && !strings.HasSuffix(name, ".done") {
			continue
		}
		st, err := entry.Info()
		if err != nil || now.Sub(st.ModTime()) <= transferTTL {
			continue
		}
		id := strings.TrimSuffix(strings.TrimSuffix(name, ".info"), ".done")
		lock := m.lock(id)
		if !lock.TryLock() {
			continue
		}
		release, lockErr := m.acquireDiskLock(context.Background(), id, 5*time.Millisecond)
		if lockErr != nil {
			lock.Unlock()
			continue
		}
		// Recheck after locking: a queued PATCH may just have refreshed the file.
		if st, err = os.Stat(filepath.Join(m.store.Path, name)); err == nil && now.Sub(st.ModTime()) > transferTTL {
			// A pending remote rename can have an old file in its recovery backup.
			// Keep the journal and staging bytes until an explicit retry or cancel
			// resolves it, rather than discard the only recovery information.
			if _, journalErr := os.Stat(m.commitPath(id)); journalErr == nil {
				release()
				lock.Unlock()
				continue
			}
			_ = os.Remove(filepath.Join(m.store.Path, id))
			_ = os.Remove(filepath.Join(m.store.Path, id+".info"))
			_ = os.Remove(m.receiptPath(id))
		}
		release()
		lock.Unlock()
	}
}

func (m *fileTransferManager) writeCompleted(w http.ResponseWriter, info tus.FileInfo) {
	writeJSON(w, 200, item("file_transfer", M{"id": info.ID, "name": info.MetaData["filename"], "directory": info.MetaData["directory"], "size": info.Size, "status": "completed"}))
}

// transferRequest deliberately has no whole-request deadline. Browser aborts and
// server contexts cancel transfers; Transport still enforces connect timeouts.
func (a *App) transferRequest(ctx context.Context, node M, method, suffix string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, daemonAddress(node)+suffix, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+str(node["daemon_token"]))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := http.Client{}
	if a.HTTP != nil {
		client = *a.HTTP
	}
	client.Timeout = 0
	if str(node["connection_mode"]) == "outbound" {
		client.Transport = a.connectorTransport(node)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, &APIError{Status: 502, Code: "DaemonConnectionException", Detail: "Unable to stream file through Wings"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		defer res.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
		var payload M
		_ = json.Unmarshal(data, &payload)
		detail := str(payload["error"])
		if detail == "" {
			detail = http.StatusText(res.StatusCode)
		}
		status := 502
		if res.StatusCode == 400 || res.StatusCode == 404 || res.StatusCode == 409 || res.StatusCode == 413 || res.StatusCode == 422 || res.StatusCode == 507 {
			status = res.StatusCode
		}
		return nil, &APIError{Status: status, Code: "DaemonRequestException", Detail: fmt.Sprintf("Wings returned %d: %s", res.StatusCode, detail)}
	}
	return res, nil
}

func (m *fileTransferManager) complete(ctx context.Context, scope transferScope, info tus.FileInfo) error {
	if _, err := os.Stat(m.commitPath(info.ID)); err == nil {
		committed, err := m.recoverCommit(ctx, scope, info)
		if err != nil {
			return err
		}
		if committed {
			return m.persistCompletion(ctx, scope, info)
		}
	}
	// Keep the staging file until commit and receipt persistence both succeed, so
	// a dropped finalization request is safe to retry without re-uploading.
	file, err := os.Open(filepath.Join(m.store.Path, info.ID))
	if err != nil {
		return err
	}
	defer file.Close()
	directory := info.MetaData["directory"]
	tempName := ".voltra-upload-" + info.ID
	claims := M{"server_uuid": scope.server["uuid"]}
	token, err := m.app.nodeJWT(scope.node, scope.user, claims, "file-upload", 24*time.Hour)
	if err != nil {
		return err
	}
	// Journal before forwarding, so a crash halfway through the Wings copy can
	// be retried or cancelled without losing track of its remote temporary file.
	if err = durableTransferFile(m.commitPath(info.ID), []byte("pending")); err != nil {
		return err
	}
	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	writeResult := make(chan error, 1)
	go func() {
		part, err := multipartWriter.CreateFormFile("files", tempName)
		if err == nil {
			_, err = io.CopyN(part, file, info.Size)
		}
		if err == nil {
			err = multipartWriter.Close()
		}
		_ = writer.CloseWithError(err)
		writeResult <- err
	}()
	suffix := "/upload/file?" + url.Values{"directory": {directory}, "token": {token}}.Encode()
	res, err := m.app.transferRequest(ctx, scope.node, http.MethodPost, suffix, reader, multipartWriter.FormDataContentType())
	_ = reader.CloseWithError(err)
	writeErr := <-writeResult
	// Windows refuses removal of an open file. Close staging before writing the
	// completion receipt and releasing disk space, including on successful copy.
	if closeErr := file.Close(); writeErr == nil {
		writeErr = closeErr
	}
	if err == nil {
		_, err = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}
	if err == nil {
		err = writeErr
	}
	if err != nil {
		m.removeRemoteTemp(scope, info, tempName)
		return err
	}
	if err = m.commitRemote(ctx, scope, info, tempName); err != nil {
		return err
	}
	return m.persistCompletion(ctx, scope, info)
}

func (m *fileTransferManager) persistCompletion(ctx context.Context, scope transferScope, info tus.FileInfo) error {
	receipt := transferReceipt{Info: info, CompletedAt: time.Now()}
	receipt.Info.Offset = receipt.Info.Size
	data, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	if err = durableTransferFile(m.receiptPath(info.ID), data); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(m.store.Path, info.ID))
	_ = os.Remove(filepath.Join(m.store.Path, info.ID+".info"))
	_ = os.Remove(m.commitPath(info.ID))
	if m.app.DB != nil {
		_ = m.app.audit(ctx, num(scope.user["id"]), num(scope.server["id"]), "server:file.upload", M{"file": info.MetaData["filename"], "directory": info.MetaData["directory"], "bytes": info.Size, "resumable": true})
	}
	return nil
}

func (m *fileTransferManager) commitPath(id string) string {
	return filepath.Join(m.store.Path, id+".commit")
}

func durableTransferFile(destination string, data []byte) error {
	tmp := destination + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err = os.Rename(tmp, destination); err != nil {
		return err
	}
	// Sync directory entries on operating systems that support it.
	if dir, openErr := os.Open(filepath.Dir(destination)); openErr == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

// Recover an interrupted remote rename using a local journal and the exact
// staged bytes. A successful but unacknowledged commit is recognized by SHA256;
// a moved-aside old target is restored before another commit is attempted.
func (m *fileTransferManager) recoverCommit(ctx context.Context, scope transferScope, info tus.FileInfo) (bool, error) {
	dir, name := info.MetaData["directory"], info.MetaData["filename"]
	temp, backup := ".voltra-upload-"+info.ID, ".voltra-backup-"+info.ID
	suffix := "/api/servers/" + url.PathEscape(str(scope.server["uuid"])) + "/files/list-directory?" + url.Values{"directory": {dir}}.Encode()
	res, err := m.app.transferRequest(ctx, scope.node, http.MethodGet, suffix, nil, "")
	if err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Status == 404 {
			_ = os.Remove(m.commitPath(info.ID))
			return false, nil
		}
		return false, err
	}
	decoder := json.NewDecoder(res.Body)
	first, err := decoder.Token()
	if err != nil || first != json.Delim('[') {
		_ = res.Body.Close()
		return false, &APIError{Status: 502, Code: "DaemonReadException", Detail: "Unable to inspect interrupted upload"}
	}
	var hasTarget, hasTemp, hasBackup bool
	for decoder.More() {
		var entry struct{ Name string }
		if err = decoder.Decode(&entry); err != nil {
			break
		}
		switch entry.Name {
		case name:
			hasTarget = true
		case temp:
			hasTemp = true
		case backup:
			hasBackup = true
		}
	}
	if err == nil {
		last, tokenErr := decoder.Token()
		if tokenErr != nil {
			err = tokenErr
		} else if last != json.Delim(']') {
			err = fmt.Errorf("invalid directory listing response")
		}
	}
	_ = res.Body.Close()
	if err != nil {
		return false, err
	}
	if hasTarget && !hasTemp {
		matches, err := m.remoteMatchesStaging(ctx, scope, info)
		if err != nil {
			return false, err
		}
		if matches {
			if hasBackup {
				m.removeRemoteTemp(scope, info, backup)
			}
			return true, nil
		}
		if hasBackup {
			return false, &APIError{Status: 409, Code: "UploadCommitRecoveryRequired", Detail: "The destination changed during an interrupted upload. The previous file is preserved as " + path.Join(dir, backup) + ". Restore or move it before retrying."}
		}
	}
	if hasBackup {
		if hasTarget {
			return false, &APIError{Status: 409, Code: "UploadCommitRecoveryRequired", Detail: "An interrupted upload has both a destination and a recovery backup at " + path.Join(dir, backup) + ". Restore or move the backup before retrying."}
		}
		if err = m.renameRemote(ctx, scope, dir, backup, name); err != nil {
			return false, err
		}
	}
	_ = os.Remove(m.commitPath(info.ID))
	return false, nil
}

func (m *fileTransferManager) remoteMatchesStaging(ctx context.Context, scope transferScope, info tus.FileInfo) (bool, error) {
	suffix := "/api/servers/" + url.PathEscape(str(scope.server["uuid"])) + "/files/contents?" + url.Values{"file": {path.Join(info.MetaData["directory"], info.MetaData["filename"])}}.Encode()
	res, err := m.app.transferRequest(ctx, scope.node, http.MethodGet, suffix, nil, "")
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	if res.ContentLength >= 0 && res.ContentLength != info.Size {
		return false, nil
	}
	remoteHash := sha256.New()
	n, err := io.Copy(remoteHash, io.LimitReader(res.Body, info.Size+1))
	if err != nil {
		return false, err
	}
	if n != info.Size {
		return false, nil
	}
	local, err := os.Open(filepath.Join(m.store.Path, info.ID))
	if err != nil {
		return false, err
	}
	defer local.Close()
	localHash := sha256.New()
	if _, err = io.Copy(localHash, local); err != nil {
		return false, err
	}
	return bytes.Equal(remoteHash.Sum(nil), localHash.Sum(nil)), nil
}

func (m *fileTransferManager) remoteJSON(ctx context.Context, scope transferScope, method, suffix string, body M) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	res, err := m.app.transferRequest(ctx, scope.node, method, "/api/servers/"+url.PathEscape(str(scope.server["uuid"]))+suffix, bytes.NewReader(b), "application/json")
	if err == nil {
		_, err = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}
	return err
}
func (m *fileTransferManager) renameRemote(ctx context.Context, scope transferScope, dir, from, to string) error {
	return m.remoteJSON(ctx, scope, http.MethodPut, "/files/rename", M{"root": dir, "files": []M{{"from": from, "to": to}}})
}
func (m *fileTransferManager) removeRemoteTemp(scope transferScope, info tus.FileInfo, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = m.remoteJSON(ctx, scope, http.MethodPost, "/files/delete", M{"root": info.MetaData["directory"], "files": []string{name}})
}

func (m *fileTransferManager) commitRemote(ctx context.Context, scope transferScope, info tus.FileInfo, tempName string) error {
	dir, name := info.MetaData["directory"], info.MetaData["filename"]
	err := m.renameRemote(ctx, scope, dir, tempName, name)
	if err == nil {
		return nil
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 400 || !strings.Contains(strings.ToLower(apiErr.Detail), "already exists") {
		return err
	}
	// Stock Wings refuses rename-over-existing. Preserve the old file in a
	// backup while committing, and roll it back if the second rename fails.
	backup := ".voltra-backup-" + info.ID
	if err = m.renameRemote(ctx, scope, dir, name, backup); err != nil {
		return err
	}
	if err = m.renameRemote(ctx, scope, dir, tempName, name); err != nil {
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		rollbackErr := m.renameRemote(rollbackCtx, scope, dir, backup, name)
		if rollbackErr != nil {
			return &APIError{Status: 502, Code: "UploadCommitRecoveryRequired", Detail: "Upload commit failed. The previous file is preserved as " + path.Join(dir, backup) + "; retry after restoring it."}
		}
		return err
	}
	m.removeRemoteTemp(scope, info, backup)
	return nil
}

// singleFileRange implements one RFC 9110 byte range. Multipart byte ranges are
// deliberately rejected. Wings currently ignores Range, so the prefix is
// discarded while streaming with constant memory.
func singleFileRange(value string, size int64) (start, length int64, err error) {
	if value == "" {
		return 0, size, nil
	}
	if size < 0 || !strings.HasPrefix(value, "bytes=") || strings.Contains(value, ",") {
		return 0, 0, bad("Unsupported byte range")
	}
	parts := strings.Split(strings.TrimPrefix(value, "bytes="), "-")
	if len(parts) != 2 {
		return 0, 0, bad("Invalid byte range")
	}
	if parts[0] == "" {
		n, e := strconv.ParseInt(parts[1], 10, 64)
		if e != nil || n <= 0 || size == 0 {
			return 0, 0, bad("Invalid byte range")
		}
		if n > size {
			n = size
		}
		return size - n, n, nil
	}
	start, e := strconv.ParseInt(parts[0], 10, 64)
	if e != nil || start < 0 || start >= size {
		return 0, 0, bad("Invalid byte range")
	}
	end := size - 1
	if parts[1] != "" {
		end, e = strconv.ParseInt(parts[1], 10, 64)
		if e != nil || end < start {
			return 0, 0, bad("Invalid byte range")
		}
		if end >= size {
			end = size - 1
		}
	}
	return start, end - start + 1, nil
}

func safeFilePreviewMIME(name string) string {
	ext := strings.ToLower(path.Ext(name))
	// Game configuration and log files are often absent from OS MIME tables.
	// They remain inert text even when their extension is executable or HTML.
	switch ext {
	case "", ".log", ".properties", ".cfg", ".conf", ".env", ".toml", ".ini", ".yaml", ".yml", ".mcmeta", ".lang", ".sh", ".bat", ".ps1", ".lua", ".json5", ".jsonc", ".sql", ".md", ".txt", ".csv":
		return "text/plain; charset=utf-8"
	}
	kind := mime.TypeByExtension(ext)
	kind, _, _ = mime.ParseMediaType(kind)
	if strings.HasPrefix(kind, "image/") && kind != "image/svg+xml" {
		return kind
	}
	if strings.HasPrefix(kind, "audio/") || strings.HasPrefix(kind, "video/") || kind == "application/pdf" {
		return kind
	}
	if strings.HasPrefix(kind, "text/") || kind == "application/json" || kind == "application/xml" || kind == "application/javascript" {
		return "text/plain; charset=utf-8"
	}
	return ""
}

func (a *App) streamServerFile(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "file.read-content")
	if err != nil {
		fail(w, err)
		return
	}
	n, err := a.node(r.Context(), num(s["node_id"]))
	if err != nil {
		fail(w, err)
		return
	}
	a.streamServerFileScope(w, r, transferScope{server: s, node: n})
}
func (a *App) streamServerFileScope(w http.ResponseWriter, r *http.Request, scope transferScope) {
	name := r.URL.Query().Get("file")
	if name == "" || strings.ContainsRune(name, '\x00') {
		fail(w, bad("file is required"))
		return
	}
	preview := strings.HasSuffix(r.URL.Path, "/preview")
	kind := "application/octet-stream"
	if preview {
		kind = safeFilePreviewMIME(name)
		if kind == "" {
			fail(w, &APIError{Status: 415, Code: "UnsupportedPreview", Detail: "This file type is available as a download"})
			return
		}
	}
	suffix := "/api/servers/" + url.PathEscape(str(scope.server["uuid"])) + "/files/contents?" + url.Values{"file": {name}}.Encode()
	res, err := a.transferRequest(r.Context(), scope.node, http.MethodGet, suffix, nil, "")
	if err != nil {
		fail(w, err)
		return
	}
	defer res.Body.Close()
	size := res.ContentLength
	// If-Range cannot be validated without a stable daemon validator. Fall back
	// to the entire response as required, rather than return an incorrect slice.
	rangeValue := r.Header.Get("Range")
	if r.Header.Get("If-Range") != "" {
		rangeValue = ""
	}
	start, length, err := singleFileRange(rangeValue, size)
	if err != nil {
		if size >= 0 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		}
		w.WriteHeader(416)
		return
	}
	if start > 0 {
		if _, err = io.CopyN(io.Discard, res.Body, start); err != nil {
			fail(w, &APIError{Status: 502, Code: "DaemonReadException", Detail: "Unable to seek within the remote file"})
			return
		}
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	if !preview {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(name)}))
		if a.DB != nil && r.Method != http.MethodHead {
			a.opAudit(r, scope.server, "server:file.download", M{"file": name, "range": rangeValue})
		}
	}
	if size >= 0 {
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
	}
	if rangeValue != "" {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, start+length-1, size))
		w.WriteHeader(206)
	}
	if r.Method == http.MethodHead {
		return
	}
	if length >= 0 {
		_, _ = io.CopyN(w, res.Body, length)
	} else {
		_, _ = io.Copy(w, res.Body)
	}
}
