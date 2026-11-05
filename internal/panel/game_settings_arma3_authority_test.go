package panel

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestArma3ActiveSettingsAuthority(t *testing.T) {
	var fixture struct {
		Startup string
		Pins    map[string]string
	}
	base := "../../artifacts/game-parity-20261029/wave91-arma3-repair/"
	b, e := os.ReadFile(base + "authority-fixture.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	files := map[string][]byte{}
	for name := range fixture.Pins {
		var data []byte
		if name == ".voltra/arma3-controls.py" {
			data, e = os.ReadFile("game_library/scripts/arma3-controls.py")
		} else {
			data, e = os.ReadFile(base + strings.TrimPrefix(name, ".voltra/") + ".emitted.txt")
		}
		if e != nil {
			t.Fatal(e)
		}
		files[name] = data
	}
	revision, e := arma3ActiveSettingsAuthority(fixture.Startup, "/server.cfg", nil, files)
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range []string{"/server.cfg", "/basic.cfg"} {
		if _, e := arma3ActiveSettingsAuthority(fixture.Startup, file, nil, files); e != nil {
			t.Fatal(e)
		}
	}
	for _, startup := range []string{"./arma3server -config=other.cfg", fixture.Startup + " -config=other.cfg", ""} {
		if _, e := arma3ActiveSettingsAuthority(startup, "/server.cfg", nil, files); e == nil {
			t.Fatal("alternate startup admitted")
		}
	}
	if _, e := arma3ActiveSettingsAuthority(fixture.Startup, "/other.cfg", nil, files); e == nil {
		t.Fatal("inactive path admitted")
	}
	if _, e := arma3ActiveSettingsAuthority(fixture.Startup, "/server.cfg", map[string]string{"PYTHONPATH": "other"}, files); e == nil {
		t.Fatal("injection admitted")
	}
	next, e := arma3ActiveSettingsAuthority(fixture.Startup, "/server.cfg", map[string]string{"STARTUP_PARAMS": "-noLogs"}, files)
	if e != nil || next == revision {
		t.Fatal("environment revision not bound")
	}
	for name, data := range files {
		files[name] = append(append([]byte{}, data...), '\n')
		if _, e := arma3ActiveSettingsAuthority(fixture.Startup, "/server.cfg", nil, files); e == nil {
			t.Fatal("changed helper admitted")
		}
		files[name] = data
	}
}
