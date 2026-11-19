package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

type themePreferences struct {
	Version            int    `json:"version"`
	BackgroundA        string `json:"backgroundA"`
	BackgroundB        string `json:"backgroundB"`
	AccentA            string `json:"accentA"`
	AccentB            string `json:"accentB"`
	BackgroundGradient *bool  `json:"backgroundGradient"`
	AccentGradient     *bool  `json:"accentGradient"`
	GlassCards         *bool  `json:"glassCards,omitempty"`
	CardOpacity        *int   `json:"cardOpacity,omitempty"`
}

var themeColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (t themePreferences) valid() bool {
	return t.Version == 1 && t.BackgroundGradient != nil && t.AccentGradient != nil && themeColor.MatchString(t.BackgroundA) && themeColor.MatchString(t.BackgroundB) && themeColor.MatchString(t.AccentA) && themeColor.MatchString(t.AccentB) && (t.CardOpacity == nil || *t.CardOpacity >= 35 && *t.CardOpacity <= 100)
}

// The WebView origin can change between launches when its usual port is taken.
// Keep non-secret appearance settings in the app directory instead, scoped to
// the authenticated panel and account.
func (h *desktopHost) serveTheme(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		desktopError(w, 405, "Method not allowed.")
		return
	}
	conn := h.connection()
	s := conn.session
	if s.Token == "" {
		desktopError(w, 401, "Link your account first.")
		return
	}
	if !conn.loadedFor(r) {
		connectionChanged(w)
		return
	}
	ctx, done := conn.during(r.Context())
	defer done()
	// The launch read has just identified this connection's account. Later
	// requests, and any launch where it is missing, ask the panel.
	account := h.boot.accountUUID(ctx, s)
	if account == "" {
		var message string
		var rejected bool
		if account, message, rejected = h.linkedAccount(ctx, s); message != "" {
			if conn.ended() {
				connectionChanged(w)
				return
			}
			if rejected {
				h.rejectSnapshots(conn)
			}
			desktopError(w, 502, message)
			return
		}
		h.panelAccepted(conn)
	}
	if account != r.Header.Get("X-Voltra-Account") {
		desktopError(w, 409, "The linked account changed. Reload the app.")
		return
	}
	sum := sha256.Sum256([]byte(s.PanelURL + "\x00" + account))
	key := hex.EncodeToString(sum[:])
	h.themeMu.Lock()
	defer h.themeMu.Unlock()
	if current := h.current(); conn.ended() || current.Token != s.Token || current.PanelURL != s.PanelURL {
		desktopError(w, 409, "The linked account changed. Reload the app.")
		return
	}
	filename := filepath.Join(h.dir, "themes.json")
	themes := map[string]themePreferences{}
	file, err := os.Open(filename)
	if err == nil {
		data, readErr := io.ReadAll(io.LimitReader(file, 1024*1024+1))
		_ = file.Close()
		if readErr != nil || len(data) > 1024*1024 || json.Unmarshal(data, &themes) != nil || themes == nil {
			desktopError(w, 500, "The local themes file could not be read.")
			return
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		desktopError(w, 500, "The local themes file could not be read.")
		return
	}
	if r.Method == http.MethodGet {
		if theme, ok := themes[key]; ok {
			if !theme.valid() {
				desktopError(w, 500, "Saved theme settings are invalid.")
				return
			}
			desktopJSON(w, 200, map[string]any{"theme": theme})
		} else {
			desktopJSON(w, 200, map[string]any{"theme": nil})
		}
		return
	}
	var theme themePreferences
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&theme) != nil || !theme.valid() || decoder.Decode(new(any)) != io.EOF {
		desktopError(w, 422, "Choose valid theme colors and gradient settings.")
		return
	}
	if _, exists := themes[key]; !exists && len(themes) >= 256 {
		desktopError(w, 409, "The local theme profile limit has been reached.")
		return
	}
	themes[key] = theme
	data, err := json.Marshal(themes)
	if err == nil {
		err = writeThemeFile(h.dir, data)
	}
	if err != nil {
		desktopError(w, 500, "Could not save your theme on this device.")
		return
	}
	desktopJSON(w, 200, map[string]any{"theme": theme})
}

// linkedAccount asks the panel which account the saved connection belongs to.
// On failure it returns the message to show, and whether the panel refused
// the connection itself.
func (h *desktopHost) linkedAccount(ctx context.Context, s session) (string, string, bool) {
	req, err := http.NewRequestWithContext(ctx, "GET", s.PanelURL+"/api/client/account", nil)
	if err != nil {
		return "", "Could not identify the linked account.", false
	}
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return "", "Could not load theme settings. Check your panel connection.", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", "Could not identify the linked account.", resp.StatusCode == http.StatusUnauthorized
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, accountLimit+1))
	if account := accountID(body); err == nil && len(body) <= accountLimit && account != "" {
		return account, "", false
	}
	return "", "Could not identify the linked account.", false
}

func writeThemeFile(dir string, data []byte) error {
	file, err := os.CreateTemp(dir, ".themes-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, "themes.json"))
}
