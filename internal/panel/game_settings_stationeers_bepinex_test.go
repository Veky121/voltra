package panel

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

func TestStationeersBepinexRetainedNative(t *testing.T) {
	f, err := os.Open("../../.local/stationeers-wurm-starbound/stationeers-retained-private-fixture.tar")
	if os.IsNotExist(err) {
		t.Skip("Retained private vanilla capture unavailable; no BepInEx native claim")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	tr := tar.NewReader(f)
	var data []byte
	for {
		h, e := tr.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			t.Fatal(e)
		}
		if h.Name == "setting.xml" {
			data, e = io.ReadAll(tr)
			if e != nil {
				t.Fatal(e)
			}
			break
		}
	}
	if fmt.Sprintf("%x", sha256.Sum256(data)) != "d74b2a29677c7ebc7353c9db7a6d14057c077f19883235d7a2e6a49ec4964cb0" {
		t.Fatal("Native capture identity mismatch")
	}
	p, err := parseStationeersBepinexGameSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	changes := map[string]string{"ServerName": "Scoped & <native capture>", "ServerMaxPlayers": "12", "AutoSave": "false", "SaveInterval": "301"}
	for _, f := range p.fields {
		if strings.Contains(strings.ToLower(f.key), "password") || stationeersBepinexSettingKind(f.key) == "" {
			t.Fatal("Unexpected exposed field")
		}
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(same, data) {
		t.Fatal("No-op changed bytes")
	}
	got, err := p.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Clone(data)
	for _, field := range p.fields {
		if v, ok := changes[field.key]; ok {
			old := "<" + field.key + ">" + field.value + "</" + field.key + ">"
			if field.key == "ServerName" { // Original private name never printed.
				v = "Scoped &amp; &lt;native capture&gt;"
			}
			expected = bytes.Replace(expected, []byte(old), []byte("<"+field.key+">"+v+"</"+field.key+">"), 1)
		}
	}
	if !bytes.Equal(got, expected) {
		t.Fatal("Bytes outside scalar spans changed")
	}
	if _, err = parseStationeersBepinexGameSettings(got); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"GamePort", "UpdatePort", "StartLocalHost", "ServerPassword", "AdminPassword", "ServerAuthSecret", "SavePath", "WorldName", "mods"} {
		if _, err := p.patch(map[string]string{key: "changed"}); err == nil {
			t.Fatalf("Accepted forbidden key %s", key)
		}
	}
}

func TestStationeersBepinexRefusalAndPreservation(t *testing.T) {
	for _, s := range []string{
		`<SettingData><AutoSave>true</AutoSave><AutoSave>false</AutoSave></SettingData>`,
		`<SettingData><AutoSave>true</AutoSave><autosave>false</autosave></SettingData>`,
		`<!DOCTYPE SettingData><SettingData/>`,
		`<SettingData/><SettingData/>`,
		`<SettingData><ServerMaxPlayers>31</ServerMaxPlayers></SettingData>`,
		`<SettingData><AutoSave>yes</AutoSave></SettingData>`,
		`<SettingData><Unknown a="1" a="2"/></SettingData>`,
		`<SettingData><?unsafe instruction?></SettingData>`,
		`<SettingData><AutoSave>true</SettingData>`,
	} {
		if _, err := parseStationeersBepinexGameSettings([]byte(s)); err == nil {
			t.Fatal("Unsafe input accepted")
		}
	}
	s := "\xef\xbb\xbf<?xml version=\"1.0\"?>\r\n<SettingData xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\r\n<!--keep--><ServerName>A &amp; B</ServerName><AutoSave>true</AutoSave><World><Id>opaque</Id></World><ServerPassword>private</ServerPassword></SettingData>"
	p, err := parseStationeersBepinexGameSettings([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.patch(map[string]string{"ServerName": "A & B"})
	if err != nil || string(got) != s {
		t.Fatal("Entity or envelope changed on no-op")
	}
	for k, v := range map[string]string{"ServerName": "bad\x00", "AutoSave": "TRUE", "SaveInterval": "0", "ServerMaxPlayers": "1e1"} {
		if _, err := p.patch(map[string]string{k: v}); err == nil {
			t.Fatal("Invalid mutation accepted")
		}
	}
}
