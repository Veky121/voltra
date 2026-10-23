package panel

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	tus "github.com/tus/tusd/v2/pkg/handler"
)

func transferTestScope() transferScope {
	return transferScope{user: M{"id": int64(42), "uuid": "user-42"}, server: M{"id": int64(9), "uuid": "server-9", "node_id": int64(3)}, node: M{"id": int64(3), "upload_size": int64(100), "daemon_token": "secret", "scheme": "http"}}
}

func transferTestManager(t *testing.T) *fileTransferManager {
	t.Helper()
	m, err := newFileTransferManager(&App{}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func transferTestRequest(m *fileTransferManager, scope transferScope, method, id string, body io.Reader, headers map[string]string) *httptest.ResponseRecorder {
	target := "/api/client/servers/server-9/files/transfers"
	if id != "" {
		target += "/" + id
	}
	r := httptest.NewRequest(method, target, body)
	r.SetPathValue("server", "server-9")
	if id != "" {
		r.SetPathValue("transfer", strings.TrimSuffix(id, "/complete"))
	}
	r.Header.Set("Tus-Resumable", "1.0.0")
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	m.serve(w, r, scope)
	return w
}

func transferTestCreate(t *testing.T, m *fileTransferManager, s transferScope, name string, size int64) string {
	t.Helper()
	metadata := "filename " + base64.StdEncoding.EncodeToString([]byte(name)) + ",directory " + base64.StdEncoding.EncodeToString([]byte("/uploads"))
	w := transferTestRequest(m, s, http.MethodPost, "", nil, map[string]string{"Upload-Length": strconv.FormatInt(size, 10), "Upload-Metadata": metadata})
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	u, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(u.Path, "/api/client/servers/server-9/files/transfers/") {
		t.Fatalf("bad Location: %s", u)
	}
	return path.Base(u.Path)
}

func transferTestPatch(m *fileTransferManager, s transferScope, id string, offset int64, data string) *httptest.ResponseRecorder {
	return transferTestRequest(m, s, http.MethodPatch, id, strings.NewReader(data), map[string]string{"Content-Type": "application/offset+octet-stream", "Upload-Offset": strconv.FormatInt(offset, 10)})
}

func TestFileTransferResumeAfterRestartAndOwnership(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	id := transferTestCreate(t, m, s, "config.yml", 11)
	if w := transferTestPatch(m, s, id, 0, "hello "); w.Code != 204 {
		t.Fatalf("patch: %d %s", w.Code, w.Body.String())
	}
	// Reconstructing the manager simulates process restart. Offset and identity
	// come from tusd's disk store, not an in-memory session map.
	restarted, err := newFileTransferManager(m.app, m.store.Path)
	if err != nil {
		t.Fatal(err)
	}
	w := transferTestRequest(restarted, s, http.MethodHead, id, nil, nil)
	if w.Code != 200 || w.Header().Get("Upload-Offset") != "6" || w.Header().Get("Upload-Length") != "11" {
		t.Fatalf("resume HEAD: %d %#v", w.Code, w.Header())
	}
	wrong := s
	wrong.user = M{"id": int64(43)}
	for _, method := range []string{http.MethodHead, http.MethodDelete, http.MethodPatch} {
		w = transferTestRequest(restarted, wrong, method, id, nil, nil)
		if w.Code != 404 {
			t.Fatalf("cross-user %s: %d", method, w.Code)
		}
	}
	wrong = s
	wrong.server = M{"uuid": "another-server"}
	if w = transferTestRequest(restarted, wrong, http.MethodHead, id, nil, nil); w.Code != 404 {
		t.Fatalf("cross-server: %d", w.Code)
	}
	if w = transferTestPatch(restarted, s, id, 0, "world"); w.Code != 409 {
		t.Fatalf("stale offset: %d", w.Code)
	}
	if w = transferTestPatch(restarted, s, id, 6, "world"); w.Code != 204 {
		t.Fatalf("resume PATCH: %d %s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(m.store.Path, id))
	if err != nil || string(data) != "hello world" {
		t.Fatalf("disk contents %q %v", data, err)
	}
	if w = transferTestRequest(restarted, s, http.MethodDelete, id, nil, nil); w.Code != 204 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	if _, err = os.Stat(filepath.Join(m.store.Path, id)); !os.IsNotExist(err) {
		t.Fatalf("staging not deleted: %v", err)
	}
}

func TestFileTransferRejectsUnsafeMetadataAndLimits(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	s.node["upload_size"] = int64(1)
	for _, test := range []struct {
		name, dir string
		length    int64
		status    int
	}{
		{"../escape", "/", 1, 400}, {"a/b", "/", 1, 400}, {"..", "/", 1, 400}, {"safe", "/a/../b", 1, 400}, {"safe", "/", (1 << 20) + 1, 413},
	} {
		metadata := "filename " + base64.StdEncoding.EncodeToString([]byte(test.name)) + ",directory " + base64.StdEncoding.EncodeToString([]byte(test.dir))
		w := transferTestRequest(m, s, http.MethodPost, "", nil, map[string]string{"Upload-Length": strconv.FormatInt(test.length, 10), "Upload-Metadata": metadata})
		if w.Code != test.status {
			t.Fatalf("%q %q: %d %s", test.name, test.dir, w.Code, w.Body.String())
		}
	}
	id := transferTestCreate(t, m, s, "safe", 10)
	r := httptest.NewRequest(http.MethodPatch, "/api/client/servers/server-9/files/transfers/"+id, strings.NewReader("x"))
	r.ContentLength = transferChunkSize + 1
	r.SetPathValue("server", "server-9")
	r.SetPathValue("transfer", id)
	w := httptest.NewRecorder()
	m.serve(w, r, s)
	if w.Code != 413 {
		t.Fatalf("oversized chunk: %d", w.Code)
	}
	for _, id := range []string{"..", "../secret", "abc", strings.Repeat("z", 32)} {
		if w = transferTestRequest(m, s, http.MethodHead, id, nil, nil); w.Code != 404 {
			t.Fatalf("invalid id %q: %d", id, w.Code)
		}
	}
}

func TestFileTransferStagingQuotaAndExpiry(t *testing.T) {
	m := transferTestManager(t)
	m.stagingLimit = 12
	s := transferTestScope()
	id := transferTestCreate(t, m, s, "first", 8)
	metadata := "filename " + base64.StdEncoding.EncodeToString([]byte("second"))
	w := transferTestRequest(m, s, http.MethodPost, "", nil, map[string]string{"Upload-Length": "8", "Upload-Metadata": metadata})
	if w.Code != 507 {
		t.Fatalf("reservation quota: %d %s", w.Code, w.Body.String())
	}
	old := time.Now().Add(-transferTTL - time.Hour)
	if err := os.Chtimes(filepath.Join(m.store.Path, id+".info"), old, old); err != nil {
		t.Fatal(err)
	}
	m.cleanup(time.Now())
	if _, err := os.Stat(filepath.Join(m.store.Path, id)); !os.IsNotExist(err) {
		t.Fatalf("expired body remains: %v", err)
	}
	_ = transferTestCreate(t, m, s, "second", 8)
}

type transferFakeWings struct {
	mu            sync.Mutex
	files         map[string][]byte
	failUpload    bool
	failCommit    bool
	renames       int
	partialTarget bool
}

func (f *transferFakeWings) handler(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.URL.Path == "/upload/file":
		if f.failUpload {
			http.Error(w, "offline", 503)
			return
		}
		reader, err := r.MultipartReader()
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		part, err := reader.NextPart()
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if part.FormName() != "files" {
			http.Error(w, "wrong part", 400)
			return
		}
		if !strings.HasPrefix(part.FileName(), ".voltra-upload-") {
			f.partialTarget = true
		}
		data, err := io.ReadAll(part)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		f.files[path.Join(r.URL.Query().Get("directory"), part.FileName())] = data
		w.WriteHeader(204)
	case strings.HasSuffix(r.URL.Path, "/files/rename"):
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "auth", 401)
			return
		}
		var d struct {
			Root  string
			Files []struct{ From, To string }
		}
		if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		f.renames++
		for _, rename := range d.Files {
			from, to := path.Join(d.Root, rename.From), path.Join(d.Root, rename.To)
			if _, exists := f.files[to]; exists {
				writeJSON(w, 400, M{"error": "Cannot move or rename file, destination already exists."})
				return
			}
			if f.failCommit && strings.HasPrefix(rename.From, ".voltra-upload-") {
				writeJSON(w, 500, M{"error": "commit failed"})
				return
			}
			if data, exists := f.files[from]; exists {
				f.files[to] = data
				delete(f.files, from)
			}
		}
		w.WriteHeader(204)
	case strings.HasSuffix(r.URL.Path, "/files/delete"):
		var d struct {
			Root  string
			Files []string
		}
		_ = json.NewDecoder(r.Body).Decode(&d)
		for _, name := range d.Files {
			delete(f.files, path.Join(d.Root, name))
		}
		w.WriteHeader(204)
	case strings.HasSuffix(r.URL.Path, "/files/contents"):
		data, exists := f.files[r.URL.Query().Get("file")]
		if !exists {
			writeJSON(w, 404, M{"error": "missing"})
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = w.Write(data)
	case strings.HasSuffix(r.URL.Path, "/files/list-directory"):
		entries := []M{}
		for name := range f.files {
			if path.Dir(name) == r.URL.Query().Get("directory") {
				entries = append(entries, M{"name": path.Base(name)})
			}
		}
		writeJSON(w, 200, entries)
	default:
		http.NotFound(w, r)
	}
}
func transferAttachWings(t *testing.T, m *fileTransferManager, s *transferScope, f *transferFakeWings) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(f.handler))
	t.Cleanup(server.Close)
	u, _ := url.Parse(server.URL)
	port, _ := strconv.Atoi(u.Port())
	s.node["fqdn"] = u.Hostname()
	s.node["daemon_listen"] = int64(port)
	s.node["scheme"] = "http"
	m.app.HTTP = server.Client()
}

func TestFileTransferFinalizeRetryAndIdempotence(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	fake := &transferFakeWings{files: map[string][]byte{}, failUpload: true}
	transferAttachWings(t, m, &s, fake)
	id := transferTestCreate(t, m, s, "hello.txt", 5)
	if w := transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil); w.Code != 409 {
		t.Fatalf("incomplete commit: %d", w.Code)
	}
	if w := transferTestPatch(m, s, id, 0, "hello"); w.Code != 204 {
		t.Fatalf("patch: %d", w.Code)
	}
	w := transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil)
	if w.Code != 502 {
		t.Fatalf("offline commit: %d %s", w.Code, w.Body.String())
	}
	if data, err := os.ReadFile(filepath.Join(m.store.Path, id)); err != nil || string(data) != "hello" {
		t.Fatal("failed commit lost staging")
	}
	fake.mu.Lock()
	fake.failUpload = false
	fake.mu.Unlock()
	w = transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil)
	if w.Code != 200 {
		t.Fatalf("retry commit: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Attributes struct {
			Status string
			Size   int64
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Attributes.Status != "completed" || result.Attributes.Size != 5 {
		t.Fatalf("bad completion: %s", w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(m.store.Path, id)); !os.IsNotExist(err) {
		t.Fatalf("committed staging body remains: %v", err)
	}
	w = transferTestRequest(m, s, http.MethodHead, id, nil, nil)
	if w.Code != 200 || w.Header().Get("Upload-Offset") != "5" {
		t.Fatalf("completed HEAD: %d %#v", w.Code, w.Header())
	}
	before := fake.renames
	w = transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil)
	if w.Code != 200 || fake.renames != before {
		t.Fatalf("non-idempotent completion %d", w.Code)
	}
	if fake.partialTarget || string(fake.files["/uploads/hello.txt"]) != "hello" || len(fake.files) != 1 {
		t.Fatalf("bad remote commit: %#v partial=%v", fake.files, fake.partialTarget)
	}
}

func TestFileTransferReplacementRollback(t *testing.T) {
	for _, failCommit := range []bool{false, true} {
		t.Run(fmt.Sprint(failCommit), func(t *testing.T) {
			m := transferTestManager(t)
			s := transferTestScope()
			fake := &transferFakeWings{files: map[string][]byte{"/uploads/config.txt": []byte("old")}, failCommit: failCommit}
			transferAttachWings(t, m, &s, fake)
			id := transferTestCreate(t, m, s, "config.txt", 3)
			if w := transferTestPatch(m, s, id, 0, "new"); w.Code != 204 {
				t.Fatal(w.Body.String())
			}
			w := transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil)
			want, status := "new", 200
			if failCommit {
				want, status = "old", 502
			}
			if w.Code != status || string(fake.files["/uploads/config.txt"]) != want {
				t.Fatalf("replacement: %d %s files=%#v", w.Code, w.Body.String(), fake.files)
			}
			if _, exists := fake.files["/uploads/.voltra-backup-"+id]; exists {
				t.Fatal("backup was not restored or cleaned")
			}
		})
	}
}

func TestFileTransferRangeParser(t *testing.T) {
	for _, tc := range []struct {
		header              string
		size, start, length int64
		valid               bool
	}{
		{"", 10, 0, 10, true}, {"bytes=0-3", 10, 0, 4, true}, {"bytes=4-", 10, 4, 6, true}, {"bytes=-3", 10, 7, 3, true}, {"bytes=7-100", 10, 7, 3, true}, {"bytes=-100", 10, 0, 10, true}, {"bytes=0-0", 1, 0, 1, true},
		{"bytes=10-", 10, 0, 0, false}, {"bytes=1-0", 10, 0, 0, false}, {"bytes=0-0", 0, 0, 0, false}, {"bytes=-0", 10, 0, 0, false}, {"bytes=0-1,4-5", 10, 0, 0, false}, {"items=0-1", 10, 0, 0, false}, {"bytes=abc-", 10, 0, 0, false},
	} {
		start, length, err := singleFileRange(tc.header, tc.size)
		if (err == nil) != tc.valid || (tc.valid && (start != tc.start || length != tc.length)) {
			t.Errorf("%q size%d got %d %d %v", tc.header, tc.size, start, length, err)
		}
	}
}

func TestFileTransferStreamingPreviewAndDownload(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	fake := &transferFakeWings{files: map[string][]byte{"/hello.html": []byte("<b>Hello world</b>"), "/archive.zip": []byte("PKbinary")}}
	transferAttachWings(t, m, &s, fake)
	for _, tc := range []struct {
		endpoint, file, rangeHeader string
		status                      int
		want                        string
	}{
		{"preview", "/hello.html", "bytes=3-7", 206, "Hello"}, {"download-stream", "/hello.html", "bytes=-4", 206, "</b>"}, {"preview", "/hello.html", "bytes=999-", 416, ""}, {"preview", "/archive.zip", "", 415, ""}, {"download-stream", "/archive.zip", "", 200, "PKbinary"},
	} {
		r := httptest.NewRequest(http.MethodGet, "/files/"+tc.endpoint+"?file="+url.QueryEscape(tc.file), nil)
		r.Header.Set("Range", tc.rangeHeader)
		w := httptest.NewRecorder()
		m.app.streamServerFileScope(w, r, s)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.endpoint, w.Code, w.Body.String())
		}
		if tc.status < 300 && w.Body.String() != tc.want {
			t.Errorf("body %q want %q", w.Body.String(), tc.want)
		}
		if tc.status < 300 && w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing nosniff")
		}
		if tc.endpoint == "preview" && tc.status < 300 && !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
			t.Fatal("active HTML preview")
		}
		if tc.endpoint == "download-stream" && tc.status < 300 && !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
			t.Fatal("missing attachment disposition")
		}
		if tc.status == 206 && !strings.HasPrefix(w.Header().Get("Content-Range"), "bytes ") {
			t.Fatal("missing content range")
		}
	}
	for _, name := range []string{"server.properties", "latest.log", "Dockerfile", "config.yml"} {
		if !strings.HasPrefix(safeFilePreviewMIME(name), "text/plain") {
			t.Errorf("missing config preview %s", name)
		}
	}
	if safeFilePreviewMIME("unsafe.svg") != "" {
		t.Fatal("SVG must not execute in origin")
	}
}

func TestFileTransferMetadataIdentityCannotBeSpoofed(t *testing.T) {
	s := transferTestScope()
	metadata, err := transferMetadata(tus.FileInfo{MetaData: tus.MetaData{"filename": "ok", "directory": "config", "owner": "1", "server": "other"}}, s)
	if err != nil {
		t.Fatal(err)
	}
	if metadata["directory"] != "/config" || metadata["owner"] != "42" || metadata["server"] != "server-9" {
		t.Fatalf("spoofed identity: %#v", metadata)
	}
	if _, _, err = singleFileRange("bytes=0-1", -1); err == nil {
		t.Fatal("unknown-length range accepted")
	}
}

func TestFileTransferDoesNotBufferLargeDownload(t *testing.T) {
	// The daemon body is streamed directly. A Range of a large remote response
	// reaches the reader incrementally and stops after the requested bytes.
	const size = 32 << 20
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(size))
		chunk := bytes.Repeat([]byte("x"), 32<<10)
		for i := 0; i < size/len(chunk); i++ {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	u, _ := url.Parse(server.URL)
	port, _ := strconv.Atoi(u.Port())
	s := transferTestScope()
	s.node["fqdn"] = u.Hostname()
	s.node["daemon_listen"] = int64(port)
	a := &App{HTTP: server.Client()}
	r := httptest.NewRequest(http.MethodGet, "/files/download-stream?file=/large.bin", nil)
	r.Header.Set("Range", "bytes=16777216-16777231")
	w := httptest.NewRecorder()
	a.streamServerFileScope(w, r, s)
	if w.Code != 206 || w.Body.String() != strings.Repeat("x", 16) || w.Header().Get("Content-Length") != "16" {
		t.Fatalf("large slice %d %s", w.Code, w.Body.String())
	}
}

func TestFileTransferCrashRecovery(t *testing.T) {
	for _, scenario := range []string{"backup-moved", "commit-applied", "changed-after-commit"} {
		t.Run(scenario, func(t *testing.T) {
			m := transferTestManager(t)
			s := transferTestScope()
			fake := &transferFakeWings{files: map[string][]byte{}}
			transferAttachWings(t, m, &s, fake)
			id := transferTestCreate(t, m, s, "config.txt", 3)
			if w := transferTestPatch(m, s, id, 0, "new"); w.Code != 204 {
				t.Fatal(w.Body.String())
			}
			if err := durableTransferFile(m.commitPath(id), []byte("pending")); err != nil {
				t.Fatal(err)
			}
			fake.files["/uploads/.voltra-backup-"+id] = []byte("old")
			switch scenario {
			case "backup-moved":
				fake.files["/uploads/.voltra-upload-"+id] = []byte("new")
			case "commit-applied":
				fake.files["/uploads/config.txt"] = []byte("new")
			case "changed-after-commit":
				fake.files["/uploads/config.txt"] = []byte("external edit")
			}
			restarted, err := newFileTransferManager(m.app, m.store.Path)
			if err != nil {
				t.Fatal(err)
			}
			w := transferTestRequest(restarted, s, http.MethodPost, id+"/complete", nil, nil)
			if scenario == "changed-after-commit" {
				if w.Code != 409 {
					t.Fatalf("changed destination: %d %s", w.Code, w.Body.String())
				}
				if string(fake.files["/uploads/config.txt"]) != "external edit" || string(fake.files["/uploads/.voltra-backup-"+id]) != "old" {
					t.Fatal("recovery overwrote external edits or backup")
				}
				return
			}
			if w.Code != 200 {
				t.Fatalf("recover %s: %d %s", scenario, w.Code, w.Body.String())
			}
			if string(fake.files["/uploads/config.txt"]) != "new" || len(fake.files) != 1 {
				t.Fatalf("recovery remote state: %#v", fake.files)
			}
			if _, err = os.Stat(restarted.commitPath(id)); !os.IsNotExist(err) {
				t.Fatalf("journal not cleaned: %v", err)
			}
			if scenario == "commit-applied" && fake.renames != 0 {
				t.Fatal("unacknowledged commit needlessly repeated")
			}
		})
	}
}

type transferInterruptedBody struct{ data []byte }

func (r *transferInterruptedBody) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.ErrUnexpectedEOF
	}
	n := copy(p, r.data)
	r.data = r.data[n:]
	return n, nil
}

func TestFileTransferInterruptedChunkKeepsAcknowledgedOffset(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	id := transferTestCreate(t, m, s, "resume.txt", 8)
	w := transferTestRequest(m, s, http.MethodPatch, id, &transferInterruptedBody{data: []byte("half")}, map[string]string{"Content-Type": "application/offset+octet-stream", "Upload-Offset": "0"})
	if w.Code == 204 {
		t.Fatal("interrupted chunk returned success")
	}
	w = transferTestRequest(m, s, http.MethodHead, id, nil, nil)
	if w.Code != 200 || w.Header().Get("Upload-Offset") != "4" {
		t.Fatalf("interrupted offset %d %#v", w.Code, w.Header())
	}
	w = transferTestPatch(m, s, id, 4, "done")
	if w.Code != 204 {
		t.Fatalf("resume: %d %s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(m.store.Path, id))
	if err != nil || string(data) != "halfdone" {
		t.Fatalf("resumed bytes %q %v", data, err)
	}
}

func TestFileTransferConcurrentAppendOnlyOneWins(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	id := transferTestCreate(t, m, s, "concurrent.txt", 10)
	results := make(chan int, 2)
	for _, data := range []string{"first", "other"} {
		go func(data string) { results <- transferTestPatch(m, s, id, 0, data).Code }(data)
	}
	one, two := <-results, <-results
	if !((one == 204 && two == 409) || (one == 409 && two == 204)) {
		t.Fatalf("concurrent offset responses %d %d", one, two)
	}
	w := transferTestRequest(m, s, http.MethodHead, id, nil, nil)
	if w.Header().Get("Upload-Offset") != "5" {
		t.Fatal("concurrent chunks corrupted offset")
	}
}

func TestFileTransferCrossManagerLock(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	id := transferTestCreate(t, m, s, "multiple-processes.txt", 10)
	other, err := newFileTransferManager(m.app, m.store.Path)
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan int, 2)
	go func() { results <- transferTestPatch(m, s, id, 0, "first").Code }()
	go func() { results <- transferTestPatch(other, s, id, 0, "other").Code }()
	one, two := <-results, <-results
	if !((one == 204 && two == 409) || (one == 409 && two == 204)) {
		t.Fatalf("cross-manager offset responses %d %d", one, two)
	}
}

func TestFileTransferHTTPPermissionRevocationAndScope(t *testing.T) {
	t.Setenv("VOLTRA_UPLOAD_DIR", t.TempDir())
	f := operationsFixtureNew(t)
	ctx := context.Background()
	if err := f.a.exec(ctx, "UPDATE subusers SET permissions=$1 WHERE user_id=$2 AND server_id=$3", []string{"file.create"}, f.sub["id"], f.server["id"]); err != nil {
		t.Fatal(err)
	}
	request := func(method, target string, body io.Reader, headers map[string]string, user M) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, body)
		r = WithUser(r, num(user["id"]))
		r.Header.Set("Tus-Resumable", "1.0.0")
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		f.mux.ServeHTTP(w, r)
		return w
	}
	base := f.serverPath("/files/transfers")
	metadata := "filename " + base64.StdEncoding.EncodeToString([]byte("config.txt"))
	w := request(http.MethodPost, base, nil, map[string]string{"Upload-Length": "5", "Upload-Metadata": metadata}, f.sub)
	if w.Code != 201 {
		t.Fatalf("create-only subuser upload: %d %s", w.Code, w.Body.String())
	}
	u, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	transferURL := u.Path
	w = request(http.MethodPatch, transferURL, strings.NewReader("hello"), map[string]string{"Content-Type": "application/offset+octet-stream", "Upload-Offset": "0"}, f.sub)
	if w.Code != 204 {
		t.Fatalf("create-only subuser chunk: %d %s", w.Code, w.Body.String())
	}
	// Server owner and administrators cannot take over a different user's
	// staged upload simply by learning its opaque URL.
	for _, actor := range []M{f.owner, f.admin} {
		if w = request(http.MethodHead, transferURL, nil, nil, actor); w.Code != 404 {
			t.Fatalf("cross-owner HEAD: %d", w.Code)
		}
	}
	other, err := f.a.insert(ctx, "servers", M{"uuid": newUUID(), "uuid_short": randomToken(4), "identifier": randomToken(4), "name": "Other", "owner_id": f.owner["id"], "node_id": f.node["id"], "nest_id": f.server["nest_id"], "egg_id": f.server["egg_id"], "image": "alpine:3.23", "installed_at": now()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.a.insert(ctx, "subusers", M{"user_id": f.sub["id"], "server_id": other["id"], "permissions": []string{"file.create"}}); err != nil {
		t.Fatal(err)
	}
	otherURL := strings.Replace(transferURL, str(f.server["uuid"]), str(other["uuid"]), 1)
	if w = request(http.MethodHead, otherURL, nil, nil, f.sub); w.Code != 404 {
		t.Fatalf("cross-server HEAD: %d %s", w.Code, w.Body.String())
	}
	if err = f.a.exec(ctx, "UPDATE subusers SET permissions='[]'::jsonb WHERE user_id=$1", f.sub["id"]); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodHead, http.MethodPatch, http.MethodDelete, http.MethodPost} {
		target := transferURL
		if method == http.MethodPost {
			target += "/complete"
		}
		if w = request(method, target, nil, nil, f.sub); w.Code != 403 {
			t.Fatalf("revoked %s: %d %s", method, w.Code, w.Body.String())
		}
	}
	if err = f.a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", f.owner["id"]); err != nil {
		t.Fatal(err)
	}
	if w = request(http.MethodGet, base, nil, nil, f.owner); w.Code != 403 {
		t.Fatalf("disabled owner capabilities: %d", w.Code)
	}
	// Read-only metadata access cannot open preview or native streamed download.
	for _, endpoint := range []string{"preview", "download-stream"} {
		if w = request(http.MethodGet, f.serverPath("/files/"+endpoint+"?file=config.txt"), nil, nil, f.sub); w.Code != 403 {
			t.Fatalf("read-content permission %s: %d", endpoint, w.Code)
		}
	}
}

func TestFileTransferEmptyFileAndCreateWithUpload(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	fake := &transferFakeWings{files: map[string][]byte{}}
	transferAttachWings(t, m, &s, fake)
	id := transferTestCreate(t, m, s, "empty.txt", 0)
	w := transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil)
	if w.Code != 200 {
		t.Fatalf("empty file finalize: %d %s", w.Code, w.Body.String())
	}
	if data, exists := fake.files["/uploads/empty.txt"]; !exists || len(data) != 0 {
		t.Fatal("empty file missing")
	}
	metadata := "filename " + base64.StdEncoding.EncodeToString([]byte("with-body.txt"))
	w = transferTestRequest(m, s, http.MethodPost, "", strings.NewReader("body"), map[string]string{"Upload-Length": "4", "Upload-Metadata": metadata, "Content-Type": "application/offset+octet-stream"})
	if w.Code != 201 {
		t.Fatalf("creation-with-upload: %d %s", w.Code, w.Body.String())
	}
	u, _ := url.Parse(w.Header().Get("Location"))
	id = path.Base(u.Path)
	w = transferTestRequest(m, s, http.MethodHead, id, nil, nil)
	if w.Code != 200 || w.Header().Get("Upload-Offset") != "4" {
		t.Fatalf("creation body offset: %d %#v", w.Code, w.Header())
	}
}

func TestFileTransferLinuxFilenameCompatibility(t *testing.T) {
	m := transferTestManager(t)
	s := transferTestScope()
	fake := &transferFakeWings{files: map[string][]byte{}}
	transferAttachWings(t, m, &s, fake)
	name, dir := "line\nbreak\\config.txt", "/nested\\folder\nname"
	metadata := "filename " + base64.StdEncoding.EncodeToString([]byte(name)) + ",directory " + base64.StdEncoding.EncodeToString([]byte(dir))
	w := transferTestRequest(m, s, http.MethodPost, "", nil, map[string]string{"Upload-Length": "4", "Upload-Metadata": metadata})
	if w.Code != 201 {
		t.Fatalf("Linux filename: %d %s", w.Code, w.Body.String())
	}
	u, _ := url.Parse(w.Header().Get("Location"))
	id := path.Base(u.Path)
	if w = transferTestPatch(m, s, id, 0, "data"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w = transferTestRequest(m, s, http.MethodPost, id+"/complete", nil, nil); w.Code != 200 {
		t.Fatalf("Linux commit: %d %s", w.Code, w.Body.String())
	}
	if string(fake.files[path.Join(dir, name)]) != "data" {
		t.Fatal("Linux target filename changed")
	}
	r := httptest.NewRequest(http.MethodGet, "/files/download-stream?file="+url.QueryEscape(path.Join(dir, name)), nil)
	w = httptest.NewRecorder()
	m.app.streamServerFileScope(w, r, s)
	if w.Code != 200 || w.Body.String() != "data" {
		t.Fatalf("Linux filename download: %d %s", w.Code, w.Body.String())
	}
	if strings.ContainsAny(w.Header().Get("Content-Disposition"), "\r\n") {
		t.Fatal("unsafe Content-Disposition header")
	}
}
