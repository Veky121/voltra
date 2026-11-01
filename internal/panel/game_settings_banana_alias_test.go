package panel

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestBananaAliasSpanRoundTrip(t *testing.T) {
	data := []byte("\ufeff{\r\n \"Server\" : { \"Login_Token\": \"old\",\"STEAM_GSLT\":\"old\",\"Unknown\":9007199254740993 },\r\n \"Browser\":{\"Server_Name\":\"Before\"},\"Game\":{\"Rotation\":[ \"one\", \"one\" ],\"escaped\":\"\\u0061\"}\r\n}\r\n")
	parsed, err := parseBananaAliasSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(map[string]string{"/Server/Login_Token": "new", "/Browser/Server_Name": "After"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.ReplaceAll(data, []byte(`"old"`), []byte(`"new"`))
	want = bytes.Replace(want, []byte(`"Before"`), []byte(`"After"`), 1)
	if !bytes.Equal(updated, want) {
		t.Fatalf("unrelated JSON bytes changed: %q", updated)
	}
	if _, err = parseBananaAliasSettings(updated); err != nil {
		t.Fatal(err)
	}
	if _, err = parsed.patch(map[string]string{"/Server/Login_Token": "one", "/Server/STEAM_GSLT": "two"}); err == nil {
		t.Fatal("conflicting alias changes accepted")
	}
	noop, err := parsed.patch(map[string]string{"/Server/Login_Token": "old"})
	if err != nil || !bytes.Equal(noop, data) {
		t.Fatal("unchanged alias normalized operator bytes")
	}
}

func TestBananaAliasAbsenceAndBlankLAN(t *testing.T) {
	for _, input := range []string{`{"Server":{"Login_Token":"old"}}`, `{"Server":{"STEAM_GSLT":"old"}}`} {
		parsed, err := parseBananaAliasSettings([]byte(input))
		if err != nil {
			t.Fatal(err)
		}
		key := "/Server/Login_Token"
		if strings.Contains(input, "STEAM_GSLT") {
			key = "/Server/STEAM_GSLT"
		}
		changed, err := parsed.patch(map[string]string{key: ""})
		if err != nil {
			t.Fatal(err)
		}
		if string(changed) != strings.Replace(input, `"old"`, `""`, 1) {
			t.Fatal("missing alias was invented or unrelated bytes changed")
		}
	}
	if _, err := parseBananaAliasSettings([]byte(`{"Server":{"Login_Token":"","STEAM_GSLT":""}}`)); err != nil {
		t.Fatal("blank LAN aliases refused")
	}
}

func TestBananaAliasInputBoundary(t *testing.T) {
	for _, input := range []string{
		`{"Server":{"Login_Token":"one","STEAM_GSLT":"two"}}`, `{"Server":{"Login_Token":"","STEAM_GSLT":"two"}}`,
		`{"Server":{"Login_Token":123}}`, `{"Server":{"Login_Token":"x","Login_Token":"x"}}`, `{"server":{}}`,
		`{"Server":{"Login_Token":null}}`, `{"Browser":{"Server_Name":null}}`,
		`{"Server":{"login_token":"x"}}`, `{"Browser":{"server_name":"x"}}`, `{"Browser":[]}`, `{"Server":null}`, `[]`,
		`{"Game":{"Rotation":[{"unknown":1,"unknown":2}]}}`, `{"Game":{"unknown":NaN}}`,
	} {
		if _, err := parseBananaAliasSettings([]byte(input)); err == nil {
			t.Fatalf("accepted ambiguous native JSON %s", input)
		}
	}
	parsed, err := parseBananaAliasSettings([]byte(`{"Server":{"Login_Token":"old","STEAM_GSLT":"old"},"Browser":{"Server_Name":"Before"},"Game":{"Enabled":true,"Rotation":[1,2]}}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{{"/Server/Login_Token": "bad\nvalue"}, {"/Server/STEAM_GSLT": strings.Repeat("x", 257)}, {"/Browser/Server_Name": strings.Repeat("x", 26)}, {"/unlisted": "bad"}, {"/Game/Enabled": "maybe"}} {
		if _, err := parsed.patch(changes); err == nil {
			t.Fatal("invalid direct native change accepted")
		}
	}
	updated, err := parsed.patch(map[string]string{"/Game/Rotation": "[2,3]"})
	var decoded struct{ Game struct{ Rotation []int } }
	if err != nil || json.Unmarshal(updated, &decoded) != nil || len(decoded.Game.Rotation) != 2 || decoded.Game.Rotation[0] != 2 || decoded.Game.Rotation[1] != 3 {
		t.Fatalf("generic typed list validation was not retained: %s %v", updated, err)
	}
}
