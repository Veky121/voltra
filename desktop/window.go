package main

import (
	"net/http"
	"strings"
)

// setWindowControl installs the native callback before app.Run loads the window.
// The mutex also protects requests arriving while the host is already listening.
func (h *desktopHost) setWindowControl(control func(string) (bool, error)) {
	h.mu.Lock()
	h.windowControl = control
	h.mu.Unlock()
}

func (h *desktopHost) serveWindow(w http.ResponseWriter, r *http.Request) {
	action := ""
	if r.Method == http.MethodGet && r.URL.Path == "/desktop/window" {
		action = "state"
	} else if r.Method == http.MethodPost {
		action = strings.TrimPrefix(r.URL.Path, "/desktop/window/")
		switch action {
		case "minimize", "maximize", "close", "drag":
		default:
			http.NotFound(w, r)
			return
		}
	} else {
		http.NotFound(w, r)
		return
	}
	h.mu.RLock()
	control := h.windowControl
	h.mu.RUnlock()
	if control == nil {
		desktopError(w, http.StatusServiceUnavailable, "Window controls are unavailable.")
		return
	}
	maximized, err := control(action)
	if err != nil {
		desktopError(w, http.StatusInternalServerError, "Could not control the window.")
		return
	}
	desktopJSON(w, http.StatusOK, map[string]bool{"maximized": maximized})
}
