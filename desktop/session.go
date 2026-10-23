package main

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type session struct {
	PanelURL string `json:"panel_url"`
	Token    string `json:"token"`
	DeviceID string `json:"device_id"`
	Name     string `json:"name"`
}

func panelURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Host == "" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return nil, errors.New("Enter the panel's base address without a path, query, or credentials.")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || ip != nil && ip.IsLoopback())) {
		return nil, errors.New("Use HTTPS for your panel. HTTP is allowed only on localhost.")
	}
	return u, nil
}

func configDirectory() (string, error) {
	if override := os.Getenv("VOLTRA_DESKTOP_CONFIG_DIR"); override != "" {
		dir, err := filepath.Abs(override)
		if err != nil {
			return "", err
		}
		return dir, os.MkdirAll(dir, 0700)
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "Voltra")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

func loadSession(dir string) (session, error) {
	var s session
	b, err := os.ReadFile(filepath.Join(dir, "connection.dat"))
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	b, err = unprotect(b)
	if err != nil {
		return s, errors.New("Windows could not unlock the saved connection. Pair this computer again.")
	}
	if err = json.Unmarshal(b, &s); err != nil {
		return session{}, errors.New("The saved connection could not be read. Pair this computer again.")
	}
	if _, err = panelURL(s.PanelURL); err != nil {
		return session{}, err
	}
	if !strings.HasPrefix(s.Token, "vdt_") || len(s.Token) != 68 || s.DeviceID == "" {
		return session{}, errors.New("The saved connection is invalid. Pair this computer again.")
	}
	return s, nil
}

func saveSession(dir string, s session) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	b, err = protect(b)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, "connection-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, "connection.dat"))
}
