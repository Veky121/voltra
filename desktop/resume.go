package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// Persist paths only: query strings can contain credentials and transient actions.
var resumePath = regexp.MustCompile(`^/(?:$|(?:server|account|admin|game-library)(?:/[A-Za-z0-9_-]+)*/?$)`)

func writePreference(dir, name string, data []byte) error {
	f, err := os.CreateTemp(dir, ".preference-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(dir, name))
}

func (h *desktopHost) serveResume(w http.ResponseWriter, r *http.Request) {
	// Holding the session lock prevents an unlink/relink from saving into another profile.
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.session.Token == "" {
		desktopError(w, 401, "Link your account first.")
		return
	}
	sum := sha256.Sum256([]byte(h.session.PanelURL + "\x00" + h.session.DeviceID))
	name := "resume-" + hex.EncodeToString(sum[:]) + ".json"
	var state struct {
		Path string `json:"path"`
	}
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(filepath.Join(h.dir, name))
		if err == nil {
			_ = json.Unmarshal(data, &state)
		}
		if !resumePath.MatchString(state.Path) {
			state.Path = "/"
		}
		desktopJSON(w, 200, state)
	case http.MethodPost:
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
		dec.DisallowUnknownFields()
		if dec.Decode(&state) != nil || dec.Decode(new(any)) != io.EOF || len(state.Path) > 1024 || !resumePath.MatchString(state.Path) {
			desktopError(w, 422, "Invalid saved page.")
			return
		}
		data, _ := json.Marshal(state)
		if writePreference(h.dir, name, data) != nil {
			desktopError(w, 500, "Could not remember this page.")
			return
		}
		desktopJSON(w, 200, state)
	default:
		w.Header().Set("Allow", "GET, POST")
		desktopError(w, 405, "Method not allowed.")
	}
}
