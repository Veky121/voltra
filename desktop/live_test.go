package main

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/cookiejar"
	"os"
	"testing"
	"time"
)

// Opt-in acceptance check against an isolated real panel, rather than a mocked
// transport. Never point this at a production account during the test suite.
func TestDesktopLivePanel(t *testing.T) {
	panel := os.Getenv("VOLTRA_DESKTOP_TEST_PANEL")
	if panel == "" {
		t.Skip("VOLTRA_DESKTOP_TEST_PANEL requires an isolated loopback development fixture")
	}
	u, err := panelURL(panel)
	if err != nil || u.Scheme != "http" {
		t.Fatal("live fixture must be loopback HTTP")
	}
	var code struct {
		Attributes struct {
			Code string `json:"code"`
		} `json:"attributes"`
	}
	var resp *http.Response
	// A fixture with sign-in enabled supplies a code created in its own session.
	if code.Attributes.Code = os.Getenv("VOLTRA_DESKTOP_TEST_CODE"); code.Attributes.Code == "" {
		remoteClient := &http.Client{Timeout: 10 * time.Second}
		resp, err = remoteClient.Post(panel+"/api/client/account/desktop/pairing", "application/json", bytes.NewBufferString("{}"))
		if err != nil {
			t.Fatal(err)
		}
		err = json.NewDecoder(resp.Body).Decode(&code)
		_ = resp.Body.Close()
		if err != nil || resp.StatusCode != 201 {
			t.Fatal("fixture pairing code failed", err)
		}
	}
	dir := t.TempDir()
	if override := os.Getenv("VOLTRA_DESKTOP_TEST_CONFIG_DIR"); override != "" {
		dir = override
		if err = os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	assetFS, err := fs.Sub(frontend, "frontend")
	if err != nil {
		t.Fatal(err)
	}
	h := newHost(dir, assetFS)
	launch, closeHost, err := h.start()
	if err != nil {
		t.Fatal(err)
	}
	defer closeHost()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	// The asset bundle is used here too, validating the production desktop
	// entry point and route fallback instead of an artificial test document.
	assets, err := frontend.ReadDir("frontend")
	if err != nil || len(assets) == 0 {
		t.Fatal("desktop frontend missing")
	}
	resp, err = client.Get(launch)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	body, _ := json.Marshal(map[string]string{"panel_url": panel, "code": code.Attributes.Code, "name": "Native acceptance fixture"})
	resp, err = client.Post(h.origin+"/desktop/link", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("native host failed real account exchange", resp.StatusCode)
	}
	// The app reloads its page after linking; the new page is the one that may ask.
	if resp, err = client.Get(h.origin + "/"); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	resp, err = client.Get(h.origin + "/api/client/account")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Contains(b, []byte(`"username":"admin"`)) {
		t.Fatal("native proxy failed real account load")
	}
	restored := newHost(dir, h.assets)
	if restored.current().DeviceID != h.current().DeviceID {
		t.Fatal("native saved connection did not survive restart")
	}
	// The launch reads only help if a real panel answers each of them plainly.
	restored.startBootReads()
	defer restored.boot.forget()
	// The fixture account is an administrator, so its overview reads are included.
	for _, uri := range append(append(append([]string{}, bootPaths...), bootPagePaths["/"]), bootAdminPaths["/"]...) {
		read, _, _ := restored.boot.take(restored.current(), uri)
		if read == nil {
			t.Fatal("launch read was not started:", uri)
		}
		<-read.done
		if !read.ok || !json.Valid(read.body) {
			t.Fatal("the panel did not answer a launch read:", uri)
		}
	}
	if restored.boot.accountUUID(t.Context(), restored.current()) == "" {
		t.Fatal("the launch account read did not identify the account")
	}
}
