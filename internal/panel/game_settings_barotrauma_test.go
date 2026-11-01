package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestBarotraumaSettingsRoundTrip(t *testing.T) {
	source := []byte("\xef\xbb\xbf<?xml version=\"1.0\"?>\r\n<!-- operator -->\r\n<ServerSettings extra=\"fake servername='do not edit'\" servername = 'Native &amp; World' maxplayers=\"8\" ispublic='True' password=\"private&amp;secret\" port=\"29100\" queryport=\"29101\"><campaign file='keep'/><!--keep--></ServerSettings>\r\n")
	parsed, err := parseBarotraumaSettings(source)
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]gameSetting{}
	for _, field := range parsed.fields {
		fields[field.key] = field
	}
	if len(fields) != 4 || fields["servername"].value != "Native & World" || !fields["password"].secret || fields["ispublic"].kind != "boolean" || fields["ispublic"].on != "true" || fields["maxplayers"].kind != "number" {
		t.Fatal("missing typed fields or secret metadata")
	}
	same, err := parsed.patch(map[string]string{"servername": "Native & World", "ispublic": "true", "password": "private&secret"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("no-op normalized original XML")
	}
	updated, err := parsed.patch(map[string]string{"servername": "New ' <&>\"", "maxplayers": "16", "ispublic": "false"})
	if err != nil {
		t.Fatal(err)
	}
	expected := bytes.Replace(source, []byte("'Native &amp; World'"), []byte("'New &#39; &lt;&amp;&gt;&#34;'"), 1)
	expected = bytes.Replace(expected, []byte(`maxplayers="8"`), []byte(`maxplayers="16"`), 1)
	expected = bytes.Replace(expected, []byte("ispublic='True'"), []byte("ispublic='false'"), 1)
	if !bytes.Equal(updated, expected) {
		t.Fatalf("modified bytes outside selected spans:\n%s", updated)
	}
	again, err := parseBarotraumaSettings(updated)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range again.fields {
		if field.key == "servername" && field.value != "New ' <&>\"" {
			t.Fatal("escaped text did not round trip")
		}
	}
}

func TestBarotraumaSettingsRejectInvalidXML(t *testing.T) {
	for _, source := range []string{
		``, `<ServerSettings/><ServerSettings/>`, `<other/>`, `<serversettings>`,
		`<!DOCTYPE serversettings><serversettings/>`, `<!ENTITY p "secret"><serversettings/>`,
		`<serversettings password="&unknown;"/>`, `<serversettings password="x" password="y"/>`,
		`<serversettings password="x" Password="y"/>`, `<serversettings Port="1" port="2"/>`,
		`<serversettings><unknown a="x" a="y"/></serversettings>`, `<serversettings/>tail`,
		`<?unsafe x?><serversettings/>`, `<serversettings><?unsafe x?></serversettings>`,
		`<serversettings xmlns:x="urn:x" x:password="p"/>`,
		`<serversettings xmlns="urn:x"/>`, `<serversettings maxplayers="17"/>`,
		`<serversettings maxplayers="NaN"/>`, `<serversettings maxplayers="1.5"/>`,
		`<serversettings ispublic="yes"/>`, `<serversettings password="bad&#10;value"/>`,
		`<serversettings password="` + strings.Repeat("x", 129) + `"/>`,
		`<serversettings servername="` + strings.Repeat("é", 31) + `"/>`,
		`<serversettings>` + strings.Repeat(`<x>`, 129) + strings.Repeat(`</x>`, 129) + `</serversettings>`,
	} {
		if _, err := parseBarotraumaSettings([]byte(source)); err == nil {
			t.Fatalf("accepted invalid XML %q", source)
		}
	}
	if _, err := parseBarotraumaSettings(bytes.Repeat([]byte(" "), 8*1024*1024+1)); err == nil {
		t.Fatal("accepted oversized document")
	}
}

func TestBarotraumaSettingsPatchBoundary(t *testing.T) {
	source := []byte(`<serversettings servername="Native" password="secret" ispublic="false" maxplayers="8" port="29100"><unknown/></serversettings>`)
	parsed, err := parseBarotraumaSettings(source)
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"port": "1"}, {"queryport": "1"}, {"enableupnp": "true"}, {"unknown": "x"},
		{"Password": "x"}, {"ispublic": "True"}, {"ispublic": `false" injected="1`},
		{"maxplayers": "0"}, {"maxplayers": "17"}, {"maxplayers": "01"},
		{"maxplayers": "1.5"}, {"maxplayers": "NaN"}, {"password": "line\nbreak"},
		{"servername": string([]byte{0xff})}, {"servername": strings.Repeat("x", 61)},
	} {
		if _, err := parsed.patch(changes); err == nil {
			t.Fatalf("accepted invalid patch %#v", changes)
		}
	}
	changed, err := parsed.patch(map[string]string{"password": `"/><injected secret="x`})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(changed, []byte(`<injected`)) {
		t.Fatal("attribute input became markup")
	}
	if _, err := parseBarotraumaSettings(changed); err != nil {
		t.Fatal(err)
	}
	missing, err := parseBarotraumaSettings([]byte(`<serversettings/>`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := missing.patch(map[string]string{"servername": "create"}); err == nil {
		t.Fatal("created missing native field")
	}
}
