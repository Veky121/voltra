package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

// revalidatedJSON is an encoded response with a content tag. The browser keeps
// a private copy and asks on every use whether it changed, so an unchanged
// catalog costs a 304 instead of the whole body. Authentication still runs
// before the tag is compared: a signed-out request never receives a 304.
type revalidatedJSON struct {
	body []byte
	tag  string
}

func newRevalidatedJSON(value any) (revalidatedJSON, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return revalidatedJSON{}, err
	}
	sum := sha256.Sum256(body)
	return revalidatedJSON{body: append(body, '\n'), tag: `"` + hex.EncodeToString(sum[:16]) + `"`}, nil
}

func (c revalidatedJSON) write(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("ETag", c.tag)
	w.Header().Set("Cache-Control", "private, no-cache")
	for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		if strings.TrimPrefix(strings.TrimSpace(candidate), "W/") == c.tag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(c.body)
}

// writeRevalidatedJSON is for small bodies that are cheap to encode per request.
func writeRevalidatedJSON(w http.ResponseWriter, r *http.Request, value any) {
	response, err := newRevalidatedJSON(value)
	if err != nil {
		fail(w, err)
		return
	}
	response.write(w, r)
}
