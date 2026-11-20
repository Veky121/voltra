package panel

import (
	"bytes"
	"testing"
	"voltra/internal/gamesettings"
)

func TestGTACSettingsReadOnlyPreservation(t *testing.T) {
	raw := []byte("\xef\xbb\xbf<?xml version=\"1.0\"?>\r\n<!--keep--><server><servername>A &amp; B</servername><maxplayers>12</maxplayers><serverbrowser>false</serverbrowser><password>secret</password><port>28010</port><resources><resource src='private'/></resources><unknown token='retain'/></server>\r\n")
	p, err := gamesettings.ParseGTACGameSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Fields) != 5 {
		t.Fatal(p.Fields)
	}
	for _, f := range p.Fields {
		if f.Kind != "readonly" {
			t.Fatal(f)
		}
		if f.Key == "password" && (!f.Secret || f.Value != "") {
			t.Fatal("password exposed")
		}
	}
	raw[0] = 0
	out, err := p.Patch(nil)
	if err != nil || out[0] != 239 {
		t.Fatal("snapshot not retained")
	}
	again, err := gamesettings.ParseGTACGameSettings(out)
	if err != nil {
		t.Fatal(err)
	}
	same, _ := again.Patch(nil)
	if !bytes.Equal(out, same) {
		t.Fatal("bytes changed")
	}
	for _, key := range []string{"servername", "maxplayers", "password", "port", "unknown", "../server.xml"} {
		if b, e := p.Patch(map[string]string{key: "x\n<injection/>"}); e == nil || b != nil {
			t.Fatal("accepted edit", key)
		}
	}
}

func TestGTACSettingsRefusals(t *testing.T) {
	for _, raw := range []string{`<server><port>1</port><port>2</port></server>`, `<server><Port>1</Port></server>`, `<server><password><nested>secret</nested></password></server>`, `<!DOCTYPE server><server></server>`, `<server><password a="x">secret</password></server>`, `<wrong></wrong>`, `<server><port>1</server>`} {
		if _, e := gamesettings.ParseGTACGameSettings([]byte(raw)); e == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestGTACSettingsAuthority(t *testing.T) {
	in := gamesettings.SettingsAuthorityInput{Startup: gamesettings.GtacSettingsStartup, Env: map[string]string{}, Files: map[string][]byte{"gtac/server.xml": []byte(`<server><port>28010</port></server>`)}}
	for _, name := range []string{"gtac-runtime.py", "gta-runtime.py", "native-config.py", "native-console.py"} {
		// MTA/openMP can advance shared source independently of the retained
		// GTAC adapter. Validate the helper this exact recipe emits.
		b := wave59CanonicalHelpers(t, gamesettings.GtacSettingsRecipe)[".voltra/"+name]
		if len(b) == 0 {
			t.Fatal("GTAC installer helper missing", name)
		}
		in.Files[".voltra/"+name] = b
	}
	a, e := gamesettings.GtacSettingsAuthority(gamesettings.GtacSettingsRecipe, in)
	if e != nil || a.Path != gamesettings.GtacSettingsPath {
		t.Fatal(a, e)
	}
	in.Startup += " --config other.xml"
	if _, e := gamesettings.GtacSettingsAuthority(gamesettings.GtacSettingsRecipe, in); e == nil {
		t.Fatal("argv drift")
	}
	in.Startup = gamesettings.GtacSettingsStartup
	in.Env["VOLTRA_SERVER_ROOT"] = "/other"
	if _, e := gamesettings.GtacSettingsAuthority(gamesettings.GtacSettingsRecipe, in); e == nil {
		t.Fatal("path drift")
	}
	delete(in.Env, "VOLTRA_SERVER_ROOT")
	if _, e := gamesettings.GtacSettingsAuthority("gta/other.json", in); e == nil {
		t.Fatal("recipe drift")
	}
	in.Files[".voltra/gtac-runtime.py"] = []byte("changed")
	if _, e := gamesettings.GtacSettingsAuthority(gamesettings.GtacSettingsRecipe, in); e == nil {
		t.Fatal("helper drift")
	}
}
