package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestSTKNativeDocument(t *testing.T) {
	data, err := os.ReadFile("../../.local/game-parity-20261029/stk/final-config.xml")
	if os.IsNotExist(err) {
		t.Skip("private native capture not present")
	}
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseSTKGameSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) < 15 {
		t.Fatal("missing native fields")
	}
	next, err := p.patch(map[string]string{"chat": "false", "voting-timeout": "45"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(data, []byte(`<chat value="true"`), []byte(`<chat value="false"`), 1)
	expected = bytes.Replace(expected, []byte(`<voting-timeout value="30"`), []byte(`<voting-timeout value="45"`), 1)
	if !bytes.Equal(next, expected) {
		t.Fatal("changed bytes outside selected values")
	}
	if _, err = parseSTKGameSettings(next); err != nil {
		t.Fatal(err)
	}
}

func TestSTKRoundTripPrivacyAndEntities(t *testing.T) {
	source := []byte(`<?xml version="1.0"?><!--operator--><server-config version="6"><private-server-password value="never-expose&amp;secret"/><server-port value="29100"/><unknown a="&quot;">leave me</unknown><chat extra="preserve" value='tr&#117;e'></chat><voting-timeout value="30"/></server-config>`)
	p, err := parseSTKGameSettings(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 2 || p.fields[0].value != "true" {
		t.Fatal("incorrect fields")
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "secret") {
			t.Fatal("secret exposed")
		}
	}
	same, err := p.patch(map[string]string{"chat": "true"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("entity no-op changed bytes")
	}
	changed, err := p.patch(map[string]string{"chat": "false"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(changed, bytes.Replace(source, []byte("tr&#117;e"), []byte("false"), 1)) {
		t.Fatal("unknown bytes changed")
	}
	for _, patch := range []map[string]string{{"server-port": "1"}, {"private-server-password": "replacement"}, {"chat": `true' /><injected/>`}, {"voting-timeout": "NaN"}, {"official-tracks-threshold": "+Inf"}, {"voting-timeout": "1.5"}, {"voting-timeout": "601"}, {"absent": "1"}} {
		if _, err := p.patch(patch); err == nil {
			t.Fatal("unsafe patch accepted")
		}
	}
}

func TestSTKRejectMalformed(t *testing.T) {
	for _, body := range []string{
		`<chat value="true"/><chat value="false"/>`, `<chat value="true" value="false"/>`,
		`<chat/>`, `<chat value="yes"/>`, `<chat value="true">text</chat>`,
		`<chat value="true"><child/></chat>`, `<chat value="&unknown;"/>`,
		`<voting-timeout value="0"/>`, `<official-tracks-threshold value="NaN"/>`,
		`<chat value="true">`,
	} {
		_, err := parseSTKGameSettings([]byte(`<server-config version="6">` + body + `</server-config>`))
		if err == nil {
			t.Fatalf("accepted malformed case %q", body)
		}
	}
	for _, doc := range []string{`<!DOCTYPE x><server-config version="6"/>`, `<server-config version="7"/>`, `<server-config version="6"/><server-config version="6"/>`, `<ServerSettings/>`, `<server-config version="6"/>tail`} {
		if _, err := parseSTKGameSettings([]byte(doc)); err == nil {
			t.Fatal("accepted invalid document")
		}
	}
}
