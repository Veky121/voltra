package nodeagent

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

type privateRunnerFunc func(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error

func (f privateRunnerFunc) Run(c context.Context, r steamapi.PrivateRequest, e func(steamapi.PrivateEvent) error, g func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
	return f(c, r, e, g)
}
func privateNodeRequest() steamapi.PrivateRequest {
	return steamapi.PrivateRequest{Version: steamapi.PrivateVersion, Job: "11111111-1111-1111-1111-111111111111", Server: "22222222-2222-2222-2222-222222222222", Owner: strings.Repeat("a", 64), Nonce: strings.Repeat("b", 64), Selection: steamapi.PrivateSelection{App: 42, Branch: "preview", Platform: "linux", Architecture: "64", Language: "english", DLC: []uint32{}, Protected: []string{}}, Username: "fixture-account", Password: "fixture-password", ContentBudget: "1048576", RollbackReserve: "4096", CacheQuota: "1048576", DeadlineSeconds: 10}
}
func privatePrincipal(r *http.Request) (PrivatePrincipal, error) {
	v := privateNodeRequest()
	return PrivatePrincipal{"authenticated-fixture-session", v.Server, v.Owner}, nil
}
func privatePost(t *testing.T, url string, v any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(v)
	r, e := http.Post(url, "application/json", bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func TestPrivateSteamGuardBroker(t *testing.T) {
	request := privateNodeRequest()
	challenge := steamapi.PrivateChallenge{Job: request.Job, Nonce: request.Nonce, ChallengeID: strings.Repeat("c", 32), Kind: "device_code"}
	received := make(chan steamapi.PrivateReply, 1)
	runner := privateRunnerFunc(func(ctx context.Context, r steamapi.PrivateRequest, e func(steamapi.PrivateEvent) error, g func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		reply, err := g(ctx, challenge)
		if err == nil {
			received <- reply
			return e(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result"})
		}
		return err
	})
	server := httptest.NewServer(NewPrivateSteamHandler(runner, privatePrincipal))
	defer server.Close()
	response := privatePost(t, server.URL+"/run", request)
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() {
		t.Fatal("missing challenge")
	}
	var ev steamapi.PrivateEvent
	if json.Unmarshal(scanner.Bytes(), &ev) != nil || ev.Challenge == nil || *ev.Challenge != challenge {
		t.Fatal("bad challenge")
	}
	code := "fixture-code"
	reply := steamapi.PrivateReply{PrivateChallenge: challenge, Code: &code}
	wrong := reply
	wrong.Nonce = strings.Repeat("d", 64)
	res := privatePost(t, server.URL+"/reply", wrong)
	res.Body.Close()
	if res.StatusCode != 409 {
		t.Fatal("wrong nonce accepted")
	}
	res = privatePost(t, server.URL+"/reply", reply)
	res.Body.Close()
	if res.StatusCode != 204 {
		t.Fatal("correlated reply rejected")
	}
	res = privatePost(t, server.URL+"/reply", reply)
	res.Body.Close()
	if res.StatusCode != 409 {
		t.Fatal("duplicate reply accepted")
	}
	select {
	case got := <-received:
		if got.PrivateChallenge != challenge {
			t.Fatal("binding changed")
		}
	case <-time.After(time.Second):
		t.Fatal("Guard blocked")
	}
}
func TestPrivateSteamDisconnectCancelsGuard(t *testing.T) {
	done := make(chan struct{})
	var once sync.Once
	runner := privateRunnerFunc(func(ctx context.Context, r steamapi.PrivateRequest, e func(steamapi.PrivateEvent) error, g func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		defer once.Do(func() { close(done) })
		_, err := g(ctx, steamapi.PrivateChallenge{Job: r.Job, Nonce: r.Nonce, ChallengeID: strings.Repeat("c", 32), Kind: "email_code"})
		return err
	})
	server := httptest.NewServer(NewPrivateSteamHandler(runner, privatePrincipal))
	defer server.Close()
	res := privatePost(t, server.URL+"/run", privateNodeRequest())
	scanner := bufio.NewScanner(res.Body)
	if !scanner.Scan() {
		t.Fatal("missing challenge")
	}
	res.Body.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("disconnected Guard survived")
	}
}
func TestPrivateSteamActualWorkerEndToEnd(t *testing.T) {
	exe := os.Getenv("PRIVATE_STEAM_WORKER_EXECUTABLE")
	if exe == "" {
		t.Skip("requires actual pinned Linux worker")
	}
	r := privateNodeRequest()
	base := t.TempDir()
	set := steamexec.PrivateDirectorySet{Target: filepath.Join(base, "target"), Work: filepath.Join(base, "work"), Cache: filepath.Join(base, "cache")}
	for _, p := range []string{set.Target, set.Work, set.Cache} {
		if e := os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	s := r.Scope()
	prefix := filepath.Join(set.Work, s.Server, s.Owner, s.Nonce)
	os.MkdirAll(prefix, 0700)
	os.WriteFile(filepath.Join(prefix, "admission.json"), []byte("exclusive existing admission"), 0600)
	binary, e := os.ReadFile(exe)
	if e != nil {
		t.Fatal(e)
	}
	hash := sha256.Sum256(binary)
	manifestData, manifestErr := os.ReadFile(os.Getenv("PRIVATE_STEAM_BUNDLE_MANIFEST"))
	if manifestErr != nil {
		t.Fatal(manifestErr)
	}
	var bundle steamexec.PrivateWorkerBundle
	if json.Unmarshal(manifestData, &bundle) != nil {
		t.Fatal("invalid test bundle inventory")
	}
	runner := &steamexec.PrivateJobRunner{Bundle: &bundle, Admission: &steamexec.PrivateDirectoryAdmission{Roots: map[string]steamexec.PrivateDirectorySet{r.Server + ":" + r.Owner: set}}, Executable: exe, RuntimeRoot: os.Getenv("PRIVATE_STEAM_WORKER_RUNTIME_ROOT"), WorkerSHA256: hex.EncodeToString(hash[:]), Provider: steamapi.PrivateProvider}
	handler := NewPrivateSteamHandler(runner, privatePrincipal)
	nodeConn, panelConn := net.Pipe()
	streamDone := make(chan error, 1)
	go func() { streamDone <- ServePrivateSteamStream(context.Background(), nodeConn, handler) }()
	transport := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return panelConn, nil }, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	payload, _ := json.Marshal(r)
	response, postErr := (&http.Client{Transport: transport}).Post("http://authenticated-private-stream/run", "application/json", bytes.NewReader(payload))
	if postErr != nil {
		t.Fatal(postErr)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !bytes.Contains(data, []byte("worker_started")) || !bytes.Contains(data, []byte(`"type":"error"`)) || bytes.Contains(data, []byte(`"type":"result"`)) || bytes.Contains(data, []byte(r.Password)) {
		t.Fatalf("wrong actual boundary outcome %s", data)
	}
	select {
	case e := <-streamDone:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("actual worker stream not reaped")
	}
	files, _ := os.ReadDir(set.Target)
	if len(files) != 0 {
		t.Fatal("target changed")
	}
}
func TestPrivateStrictUnicode(t *testing.T) {
	for _, s := range []string{`{"password":"literal??"}`, `{"password":"\ud83d\ude00"}`, `{"password":"\\ud800"}`, `{"password":"quote\"slash\\"}`} {
		if !strictPrivateJSON([]byte(s)) {
			t.Fatal("valid literal rejected")
		}
	}
	for _, b := range [][]byte{[]byte(`{"password":"\ud800"}`), []byte(`{"password":"\udc00"}`), []byte(`{"password":"\ud800\u0041"}`), []byte{'"', 0xff, '"'}} {
		if strictPrivateJSON(b) {
			t.Fatal("lossy input accepted")
		}
	}
	called := false
	runner := privateRunnerFunc(func(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		called = true
		return nil
	})
	h := NewPrivateSteamHandler(runner, privatePrincipal)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/run", strings.NewReader(`{"password":"\ud800"}`)))
	if w.Code != 400 || called {
		t.Fatal("malformed literal reached runner")
	}
}
func TestPrivateExpiredGuardReplyRace(t *testing.T) {
	r := privateNodeRequest()
	c := steamapi.PrivateChallenge{Job: r.Job, Nonce: r.Nonce, ChallengeID: strings.Repeat("c", 32), Kind: "device_code"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h := NewPrivateSteamHandler(privateRunnerFunc(func(context.Context, steamapi.PrivateRequest, func(steamapi.PrivateEvent) error, func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		return nil
	}), privatePrincipal).(*privateSteamHandler)
	p, _ := privatePrincipal(nil)
	h.pending[p.Session+":"+c.Job+":"+c.Nonce+":"+c.ChallengeID] = &privatePending{principal: p, challenge: c, reply: make(chan steamapi.PrivateReply, 1), context: ctx}
	code := "expired"
	data, _ := json.Marshal(steamapi.PrivateReply{PrivateChallenge: c, Code: &code})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/reply", bytes.NewReader(data)))
	if w.Code != 409 {
		t.Fatal("expired reply accepted before cleanup")
	}
}
func TestPrivateConnectorStreamComposition(t *testing.T) {
	r := privateNodeRequest()
	runner := privateRunnerFunc(func(ctx context.Context, r steamapi.PrivateRequest, emit func(steamapi.PrivateEvent) error, guard func(context.Context, steamapi.PrivateChallenge) (steamapi.PrivateReply, error)) error {
		return emit(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "progress", Stage: "authenticated_stream_fixture"})
	})
	handler := NewPrivateSteamHandler(runner, privatePrincipal)
	a, b := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- ServePrivateSteamStream(context.Background(), a, handler) }()
	transport := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return b, nil }, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	raw, _ := json.Marshal(r)
	response, e := (&http.Client{Transport: transport}).Post("http://connector-private/run", "application/json", bytes.NewReader(raw))
	if e != nil {
		t.Fatal(e)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !bytes.Contains(data, []byte("authenticated_stream_fixture")) || bytes.Contains(data, []byte(r.Password)) {
		t.Fatal("connector stream boundary failed")
	}
	select {
	case e := <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("connector stream not released")
	}
}
