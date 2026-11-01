package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestINICaseSafetyAmbiguousScalars(t *testing.T) {
	for _, fixture := range []string{
		"[ServerSettings]\nServerPassword=secret1\nserverpassword=secret2\n",
		"[ServerSettings]\nServerPassword=secret1\n[serversettings]\nServerPassword=secret2\n",
		"[ServerSettings]\nServerPassword=secret1\n[SERVERSETTINGS]\nSERVERPASSWORD=secret2\n",
		"[ServerSettings]\nΣ=1\nς=2\n",
	} {
		t.Run(fixture[:strings.IndexByte(fixture, '\n')], func(t *testing.T) {
			parsed, err := parseGameSettingsLines("/WindowsServer/Game.ini", []byte(fixture))
			if err != nil {
				t.Fatal(err)
			}
			parsed = gameSettingsINICaseSafety("/WindowsServer/Game.ini", []byte(fixture), parsed)
			for _, field := range parsed.fields {
				if field.kind != "readonly" || field.structured {
					t.Fatalf("editable ambiguous field: %s", field.key)
				}
				if _, err := parsed.patch(map[string]string{field.key: "changed"}); err == nil {
					t.Fatalf("patch accepted %s", field.key)
				}
				if _, err := gameSettingsChanges(parsed.fields, M{field.key: "changed"}, M{}, "/WindowsServer/Game.ini"); err == nil {
					t.Fatalf("changes accepted %s", field.key)
				}
			}
			got, err := parsed.patch(nil)
			if err != nil || string(got) != fixture {
				t.Fatal("no-op changed bytes", err)
			}
		})
	}
}

func TestINICaseSafetyPreservesNamesArraysAndUnknownBytes(t *testing.T) {
	const file = "/Astro/Saved/Config/WindowsServer/AstroServerSettings.ini"
	source := []byte("; operator\r\n[/Script/Astro.AstroServerSettings]\r\nServerName = Before ; keep\r\n+PlayerProperties=(Name=A)\r\n+PlayerProperties=(Name=B)\r\n-playerproperties=(Name=C)\r\n.PlayerProperties=(Name=D)\r\n!PlayerProperties=ClearArray\r\nPlayerProperties=(Name=E)\r\nPlayerProperties=(Name=F)\r\nopaque unknown bytes\r\n")
	parsed, err := parseGameSettingsLines(file, source)
	if err != nil {
		t.Fatal(err)
	}
	parsed = gameSettingsINICaseSafety(file, source, parsed)
	parsed, err = expandGameSettingsStructs(parsed)
	if err != nil {
		t.Fatal(err)
	}
	name := "/Script/Astro.AstroServerSettings/ServerName"
	found := false
	for _, field := range parsed.fields {
		if field.key == name {
			found = true
			if field.kind == "readonly" {
				t.Fatal("unambiguous name blocked")
			}
			continue
		}
		if field.kind != "readonly" {
			t.Fatalf("array expanded or editable: %s", field.key)
		}
		if _, err := parsed.patch(map[string]string{field.key: "bad"}); err == nil {
			t.Fatalf("array patch accepted: %s", field.key)
		}
	}
	if !found {
		t.Fatal("original name lost")
	}
	got, err := parsed.patch(map[string]string{name: "After"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(source, []byte("Before"), []byte("After"), 1)
	if !bytes.Equal(got, want) {
		t.Fatalf("unrelated source bytes changed: %q", got)
	}
}

func TestINICaseSafetyScope(t *testing.T) {
	for _, test := range []struct {
		file, content string
		want          bool
	}{
		{"/WindowsServer/Game.ini", "", true},
		{"C:\\Game\\WindowsServer\\Engine.INI", "", true},
		{"/Game/Saved/Config/LinuxServer/Game.ini", "", true},
		{"/Engine.ini", " ; [/Script/Fake]\n[/script/Engine.GameSession]\n", true},
		{"/normal.ini", "; [/Script/Fake]\n[Normal]\n", false},
		{"/WindowsServer/game.toml", "[/Script/Foo]", false},
		{"/normal.cfg", "[/Script/Foo]", false},
	} {
		if got := gameSettingsCaseInsensitiveINI(test.file, []byte(test.content)); got != test.want {
			t.Errorf("%s scope=%v", test.file, got)
		}
	}
	data := []byte("[Normal]\nKey=1\nkey=2\n")
	parsed, err := parseGameSettingsLines("normal.ini", data)
	if err != nil {
		t.Fatal(err)
	}
	parsed = gameSettingsINICaseSafety("normal.ini", data, parsed)
	for _, field := range parsed.fields {
		if field.kind == "readonly" {
			t.Fatal("case-sensitive document affected")
		}
	}
}
