package panel

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func gunzipBody(t *testing.T, body []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func largeJSON() M {
	rows := []M{}
	for i := 0; i < 200; i++ {
		rows = append(rows, M{"id": i, "name": "server name that repeats"})
	}
	return M{"data": rows}
}

func compressedRequest(handler http.Handler, method, accept string, headers ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/client/example", nil)
	if accept != "" {
		r.Header.Set("Accept-Encoding", accept)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	serveCompressedAPI(w, r, handler)
	return w
}

func TestCompressedAPIGzipsLargeJSON(t *testing.T) {
	value := largeJSON()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "999999")
		writeJSON(w, 200, value)
	})
	w := compressedRequest(handler, "GET", "gzip, deflate, br")
	if w.Code != 200 || w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	if w.Header().Get("Content-Length") != "" {
		t.Fatal("identity length kept on a compressed body")
	}
	var decoded M
	if err := json.Unmarshal(gunzipBody(t, w.Body.Bytes()), &decoded); err != nil || len(asSlice(decoded["data"])) != 200 {
		t.Fatalf("round trip failed: %v", err)
	}
	plain := compressedRequest(handler, "GET", "")
	if plain.Header().Get("Content-Encoding") != "" || plain.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("plain response %v", plain.Header())
	}
	if w.Body.Len()*3 > plain.Body.Len() {
		t.Fatalf("compressed %d of %d bytes", w.Body.Len(), plain.Body.Len())
	}
	if refused := compressedRequest(handler, "GET", "gzip;q=0, br"); refused.Header().Get("Content-Encoding") != "" {
		t.Fatal("gzip sent although refused")
	}
	if head := compressedRequest(handler, "HEAD", "gzip"); head.Header().Get("Content-Encoding") != "" {
		t.Fatal("HEAD answered with an encoding")
	}
}

func TestCompressedAPISkipsSmallEncodedAndNonJSONBodies(t *testing.T) {
	small := compressedRequest(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, M{"ok": true}) }), "GET", "gzip")
	if small.Header().Get("Content-Encoding") != "" || small.Header().Get("Content-Length") != "12" || small.Body.String() != "{\"ok\":true}\n" {
		t.Fatalf("small body %v %q", small.Header(), small.Body.String())
	}
	errorBody := compressedRequest(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fail(w, notFound()) }), "GET", "gzip")
	if errorBody.Code != 404 || errorBody.Header().Get("Content-Encoding") != "" {
		t.Fatal("error rewritten")
	}
	large := bytes.Repeat([]byte("a"), 8192)
	for name, prepare := range map[string]func(http.Header){
		"already encoded": func(h http.Header) { h.Set("Content-Type", "application/json"); h.Set("Content-Encoding", "gzip") },
		"binary":          func(h http.Header) { h.Set("Content-Type", "application/octet-stream") },
		"download": func(h http.Header) {
			h.Set("Content-Type", "application/json")
			h.Set("Content-Disposition", "attachment")
		},
		"untyped": func(h http.Header) {},
	} {
		w := compressedRequest(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			prepare(w.Header())
			_, _ = w.Write(large)
		}), "GET", "gzip")
		if name == "already encoded" && w.Header().Get("Content-Encoding") != "gzip" || name != "already encoded" && w.Header().Get("Content-Encoding") != "" || !bytes.Equal(w.Body.Bytes(), large) {
			t.Fatalf("%s: %v", name, w.Header())
		}
	}
	noContent := compressedRequest(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 204, nil) }), "GET", "gzip")
	if noContent.Code != 204 || noContent.Header().Get("Content-Encoding") != "" || noContent.Body.Len() != 0 {
		t.Fatal("204 changed")
	}
	if ranged := compressedRequest(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, largeJSON()) }), "GET", "gzip", "Range", "bytes=0-10"); ranged.Header().Get("Content-Encoding") != "" {
		t.Fatal("range request compressed")
	}
}

func TestCompressedAPIKeepsRevalidationTags(t *testing.T) {
	cached, err := newRevalidatedJSON(largeJSON())
	if err != nil {
		t.Fatal(err)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { cached.write(w, r) })
	first := compressedRequest(handler, "GET", "gzip")
	tag := first.Header().Get("ETag")
	if first.Header().Get("Content-Encoding") != "gzip" || tag != "W/"+cached.tag {
		t.Fatalf("compressed answer must carry a weak tag: %v", first.Header())
	}
	if !bytes.Equal(gunzipBody(t, first.Body.Bytes()), cached.body) {
		t.Fatal("body changed")
	}
	again := compressedRequest(handler, "GET", "gzip", "If-None-Match", tag)
	if again.Code != 304 || again.Body.Len() != 0 || again.Header().Get("Content-Encoding") != "" || again.Header().Get("ETag") != cached.tag {
		t.Fatalf("304 %d %v", again.Code, again.Header())
	}
	plain := compressedRequest(handler, "GET", "")
	if plain.Header().Get("ETag") != cached.tag || !bytes.Equal(plain.Body.Bytes(), cached.body) {
		t.Fatal("identity answer must keep the strong tag")
	}
	if revalidated := compressedRequest(handler, "GET", "", "If-None-Match", tag); revalidated.Code != 304 {
		t.Fatal("a weak tag from a compressed answer must revalidate an identity request")
	}
}

func TestCompressedAPIStreamsFlushedResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveCompressedAPI(w, r, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("{\"step\":1}\n"))
			if err := http.NewResponseController(w).Flush(); err != nil {
				t.Error(err)
			}
			_, _ = w.Write(bytes.Repeat([]byte(" "), 4096))
		}))
	}))
	defer server.Close()
	req, _ := http.NewRequest("GET", server.URL, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Encoding") != "" {
		t.Fatal("a flushed stream was compressed")
	}
	body, _ := io.ReadAll(res.Body)
	if !strings.HasPrefix(string(body), "{\"step\":1}\n") || len(body) != 11+4096 {
		t.Fatalf("stream body %d", len(body))
	}
}

func TestCompressedAPIBypassesWebSocketUpgrades(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveCompressedAPI(w, r, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			_ = conn.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", 4096)))
		}))
	}))
	defer server.Close()
	header := http.Header{"Accept-Encoding": {"gzip"}}
	conn, res, err := (&websocket.Dialer{HandshakeTimeout: 2 * time.Second}).Dial("ws"+strings.TrimPrefix(server.URL, "http"), header)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if res.Header.Get("Content-Encoding") != "" || res.Header.Get("Vary") != "" {
		t.Fatalf("upgrade touched: %v", res.Header)
	}
	_, message, err := conn.ReadMessage()
	if err != nil || len(message) != 4096 {
		t.Fatalf("message %d %v", len(message), err)
	}
	if compressibleAPIRequest(httptest.NewRequest("GET", "/", nil)) == false {
		t.Fatal("ordinary GET must be eligible")
	}
}

func TestCompressedAPIDiscardsBufferedBodyOnPanic(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/client/example", nil)
	r.Header.Set("Accept-Encoding", "gzip")
	func() {
		defer func() { _ = recover() }()
		serveCompressedAPI(w, r, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("{\"partial\":"))
			panic("boom")
		}))
	}()
	if w.Body.Len() != 0 || w.Code != 200 || w.Flushed {
		t.Fatal("partial body written before the panic handler")
	}
	fail(w, APIError{Status: 500, Code: "InternalServerError", Detail: "x"})
	if w.Code != 500 {
		t.Fatal("panic handler could not write its error")
	}
}
