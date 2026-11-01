package panel

import (
	"bytes"
	"strings"
	"testing"
)

const windroseFixture = `{
 "ServerDescription_Persistent": {"PersistentServerId":"publisher-id","WorldIslandId":"publisher-world", "ServerName" : "Existing", "UseDirectConnection":false,"Password":"native-secret","MaxPlayerCount":8,"InviteCode":"ABC123","IsPasswordProtected":true,"P2pProxyAddress":"127.0.0.1","DirectConnectionServerPort":7777},
 "unknown": [900719925474099312345,1.2300e+90,{"x":"\\u1234"}]
}`

func TestWindrosePreservesBytesAndAuthority(t *testing.T) {
	data := append([]byte{0xef, 0xbb, 0xbf}, []byte(windroseFixture)...)
	p, err := parseWindroseSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 6 {
		t.Fatalf("unexpected fields: %v", p.fields)
	}
	if !p.fields[2].secret || p.fields[2].kind != "password" || p.fields[4].kind != "readonly" || p.fields[5].kind != "boolean" {
		t.Fatal("secret/type policy")
	}
	unchanged, err := p.patch(nil)
	if err != nil || !bytes.Equal(data, unchanged) {
		t.Fatal("no-op changed bytes", err)
	}
	next, err := p.patch(map[string]string{windroseSettingsPrefix + "ServerName": "New name", windroseSettingsPrefix + "UseDirectConnection": "true", windroseSettingsPrefix + "MaxPlayerCount": "12"})
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(string(data), `"Existing"`, `"New name"`), `"UseDirectConnection":false`, `"UseDirectConnection":true`), `"MaxPlayerCount":8`, `"MaxPlayerCount":12`)
	if string(next) != expected {
		t.Fatal("unrelated bytes changed")
	}
	if !bytes.Equal(data, append([]byte{0xef, 0xbb, 0xbf}, []byte(windroseFixture)...)) {
		t.Fatal("input mutated")
	}
}

func TestWindroseRefusesAmbiguityAndMalformedTypes(t *testing.T) {
	for _, data := range []string{
		strings.Replace(windroseFixture, `"ServerName" : "Existing"`, `"ServerName":"A","ServerName":"B"`, 1),
		strings.Replace(windroseFixture, `"ServerName"`, `"servername"`, 1),
		strings.Replace(windroseFixture, `"unknown"`, `"UNKNOWN":0,"unknown"`, 1),
		strings.Replace(windroseFixture, `"x":"\\u1234"`, `"x":1,"X":2`, 1),
		strings.Replace(windroseFixture, `"MaxPlayerCount":8`, `"MaxPlayerCount":8.0`, 1),
		strings.Replace(windroseFixture, `"UseDirectConnection":false`, `"UseDirectConnection":0`, 1),
		strings.Replace(windroseFixture, `"IsPasswordProtected":true`, `"IsPasswordProtected":false`, 1),
		strings.Replace(windroseFixture, `"PersistentServerId":"publisher-id"`, `"PersistentServerId":""`, 1),
		strings.Replace(windroseFixture, `1.2300e+90`, `NaN`, 1),
		windroseFixture + `{}`, string([]byte{0xff}),
	} {
		if _, err := parseWindroseSettings([]byte(data)); err == nil {
			t.Fatalf("accepted invalid input: %s", data)
		}
	}
}

func TestWindrosePatchRefusalAndSecretPair(t *testing.T) {
	data := []byte(windroseFixture)
	p, err := parseWindroseSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{windroseSettingsPrefix + "InviteCode": "NEW123"},
		{windroseSettingsPrefix + "DirectConnectionServerPort": "1234"},
		{windroseSettingsPrefix + "PersistentServerId": "invented"},
		{windroseSettingsPrefix + "P2pProxyAddress": "1.1.1.1"},
		{windroseSettingsPrefix + "Missing": "value"},
		{windroseSettingsPrefix + "Password": ""},
		{windroseSettingsPrefix + "ServerName": strings.Repeat("x", 41)},
		{windroseSettingsPrefix + "MaxPlayerCount": "0"},
		{windroseSettingsPrefix + "MaxPlayerCount": "1e2"},
		{windroseSettingsPrefix + "UseDirectConnection": "1"},
	} {
		if result, err := p.patch(changes); err == nil || result != nil {
			t.Fatalf("expected preflight refusal: %v", changes)
		}
		if string(data) != windroseFixture {
			t.Fatal("mutated input")
		}
	}
	next, err := p.patch(map[string]string{windroseSettingsPrefix + "Password": "", windroseSettingsPrefix + "IsPasswordProtected": "false"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(next, []byte(`"Password":""`)) || !bytes.Contains(next, []byte(`"IsPasswordProtected":false`)) {
		t.Fatal("pair not updated")
	}
}

func TestWindroseMissingFieldsNeverSeeded(t *testing.T) {
	data := []byte(`{"ServerDescription_Persistent":{"PersistentServerId":"real","WorldIslandId":"real"}}`)
	p, err := parseWindroseSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 0 {
		t.Fatal("invented fields")
	}
	next, err := p.patch(nil)
	if err != nil || !bytes.Equal(next, data) {
		t.Fatal("seeded defaults")
	}
	if _, err = p.patch(map[string]string{windroseSettingsPrefix + "ServerName": "New"}); err == nil {
		t.Fatal("created absent field")
	}
}
func TestWindroseEscapedAliasesBoundsAndPartialSecrets(t *testing.T) {
	for _, s := range []string{
		strings.Replace(windroseFixture, `"ServerName" : "Existing"`, `"ServerName":"A","\u0053erverName":"B"`, 1),
		strings.Replace(windroseFixture, `"MaxPlayerCount":8`, `"MaxPlayerCount":2147483648`, 1),
		strings.Replace(windroseFixture, `"ServerDescription_Persistent"`, `"serverdescription_persistent"`, 1),
	} {
		if _, err := parseWindroseSettings([]byte(s)); err == nil {
			t.Fatal("accepted alias/bounds")
		}
	}
	p, err := parseWindroseSettings([]byte(windroseFixture))
	if err != nil {
		t.Fatal(err)
	}
	next, err := p.patch(map[string]string{windroseSettingsPrefix + "ServerName": "?? ??", windroseSettingsPrefix + "Password": "changed-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(next, []byte(`"IsPasswordProtected":true`)) {
		t.Fatal("protection lost")
	}
	partial := strings.Replace(windroseFixture, `"IsPasswordProtected":true,`, "", 1)
	// Fixture has protection last, so remove its leading comma instead.
	partial = strings.Replace(partial, `,"IsPasswordProtected":true`, "", 1)
	p, err = parseWindroseSettings([]byte(partial))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.patch(map[string]string{windroseSettingsPrefix + "Password": "replacement"}); err == nil {
		t.Fatal("inferred missing protection")
	}
}
