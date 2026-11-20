package panel

import (
	"bufio"
	"compress/gzip"
	"errors"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// JSON API responses are gzipped when the client accepts it. The decision is
// made when the handler first writes: only JSON bodies of at least
// apiCompressionMinimum bytes that are not already encoded are compressed.
// WebSocket upgrades bypass this writer entirely, and anything flushed before
// that point (event streams, proxied downloads, progress) is sent unchanged.
const apiCompressionMinimum = 1024

var apiGzipWriters = sync.Pool{New: func() any {
	w, _ := gzip.NewWriterLevel(nil, gzip.DefaultCompression)
	return w
}}

func compressibleAPIRequest(r *http.Request) bool {
	if r.Method == http.MethodHead || r.Header.Get("Range") != "" {
		return false
	}
	// WebSocket and other protocol upgrades hijack the connection.
	if r.Header.Get("Upgrade") != "" || headerHasToken(r.Header, "Connection", "upgrade") {
		return false
	}
	return true
}

func headerHasToken(h http.Header, name, token string) bool {
	for _, value := range h.Values(name) {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

func compressibleContentType(value string) bool {
	media, _, err := mime.ParseMediaType(value)
	if err != nil {
		return false
	}
	return media == "application/json" || strings.HasPrefix(media, "application/") && strings.HasSuffix(media, "+json")
}

// serveCompressedAPI runs next with a writer that may gzip its response. It
// is not deferred: if next panics, the buffered start of the response is
// discarded so the panic handler can still write its error.
func serveCompressedAPI(w http.ResponseWriter, r *http.Request, next http.Handler) {
	if !compressibleAPIRequest(r) {
		next.ServeHTTP(w, r)
		return
	}
	// Every answer from a URL that might be compressed varies by encoding,
	// including the plain ones, so shared caches keep them apart.
	w.Header().Add("Vary", "Accept-Encoding")
	if !acceptsGzip(r.Header.Get("Accept-Encoding")) {
		next.ServeHTTP(w, r)
		return
	}
	cw := &compressedAPIResponse{ResponseWriter: w}
	next.ServeHTTP(cw, r)
	cw.finish()
}

type compressedAPIResponse struct {
	http.ResponseWriter
	status   int  // status the handler wrote, 0 until then
	decided  bool // headers were sent
	compress bool
	buffer   []byte
	gzip     *gzip.Writer
	hijacked bool
}

func (w *compressedAPIResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *compressedAPIResponse) WriteHeader(status int) {
	if w.decided || w.status != 0 || w.hijacked {
		if !w.decided && status >= 100 && status < 200 {
			w.ResponseWriter.WriteHeader(status)
		}
		return
	}
	if status >= 100 && status < 200 {
		// Informational responses (103 Early Hints) go straight out.
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.status = status
	if !w.eligible() {
		w.decide(false)
	}
}

// eligible reports whether the response, as described so far, may be
// compressed once it proves large enough.
func (w *compressedAPIResponse) eligible() bool {
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}
	h := w.Header()
	if status < 200 || status == http.StatusNoContent || status == http.StatusNotModified || status == http.StatusPartialContent {
		return false
	}
	// Downloads keep their exact bytes and length, whatever their type.
	if h.Get("Content-Encoding") != "" || h.Get("Content-Range") != "" || h.Get("Content-Disposition") != "" {
		return false
	}
	return compressibleContentType(h.Get("Content-Type"))
}

func (w *compressedAPIResponse) Write(p []byte) (int, error) {
	if w.hijacked {
		return 0, http.ErrHijacked
	}
	if !w.decided {
		if w.status == 0 {
			w.status = http.StatusOK
			// An untyped body is left to net/http, which sniffs its type.
			if !w.eligible() {
				w.decide(false)
				return w.ResponseWriter.Write(p)
			}
		}
		w.buffer = append(w.buffer, p...)
		if len(w.buffer) < apiCompressionMinimum {
			return len(p), nil
		}
		w.decide(true)
		return len(p), w.flushBuffer()
	}
	if w.compress {
		return w.gzip.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

func (w *compressedAPIResponse) decide(compress bool) {
	w.decided, w.compress = true, compress
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}
	h := w.Header()
	if compress {
		h.Set("Content-Encoding", "gzip")
		// Ranges and lengths of the identity body do not apply.
		h.Del("Content-Length")
		h.Del("Accept-Ranges")
		w.gzip = apiGzipWriters.Get().(*gzip.Writer)
		w.gzip.Reset(w.ResponseWriter)
		// The compressed bytes differ from the identity bytes, so a strong tag
		// would be wrong for them. The weak tag still matches If-None-Match,
		// which compares weakly (revalidatedJSON drops the W/ prefix). A 304
		// is left alone: handlers that compare tags exactly keep working.
		if tag := h.Get("ETag"); tag != "" && !strings.HasPrefix(tag, "W/") {
			h.Set("ETag", "W/"+tag)
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *compressedAPIResponse) flushBuffer() error {
	if len(w.buffer) == 0 {
		return nil
	}
	data := w.buffer
	w.buffer = nil
	var err error
	if w.compress {
		_, err = w.gzip.Write(data)
	} else {
		_, err = w.ResponseWriter.Write(data)
	}
	return err
}

// Flush sends what the handler wrote so far. A response flushed before it
// reached the size threshold is a stream and is never compressed.
func (w *compressedAPIResponse) Flush() {
	if w.hijacked {
		return
	}
	if !w.decided {
		w.decide(false)
		_ = w.flushBuffer()
	} else if w.compress {
		_ = w.gzip.Flush()
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

func (w *compressedAPIResponse) FlushError() error {
	w.Flush()
	return nil
}

func (w *compressedAPIResponse) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if w.decided {
		return nil, nil, errors.New("response already started")
	}
	conn, rw, err := http.NewResponseController(w.ResponseWriter).Hijack()
	if err == nil {
		w.hijacked = true
	}
	return conn, rw, err
}

// finish writes a response that stayed below the threshold as it is, with
// its length, or completes the gzip stream.
func (w *compressedAPIResponse) finish() {
	if w.hijacked {
		return
	}
	if !w.decided {
		if w.status == 0 && len(w.buffer) == 0 {
			// The handler wrote nothing; net/http sends its default 200.
			return
		}
		if w.eligible() && w.Header().Get("Content-Length") == "" {
			w.Header().Set("Content-Length", strconv.Itoa(len(w.buffer)))
		}
		w.decide(false)
		_ = w.flushBuffer()
		return
	}
	if w.compress {
		_ = w.gzip.Close()
		w.gzip.Reset(nil)
		apiGzipWriters.Put(w.gzip)
		w.gzip = nil
	}
}
