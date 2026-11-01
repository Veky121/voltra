package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestTerraTechSettingsPreservation(t *testing.T) {
	raw := []byte("\xef\xbb\xbf{\r\n  \"Password\": \"s\\u0065cret\",\r\n  \"SlotCount\": 4, \"Port\": 7777, \"unknown\": [900719925474099312345,1.2300e-15,{\"x\":true}]\r\n}\r\n")
	p, err := parseTerraTechSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 2 || p.fields[0].key != "Password" || !p.fields[0].secret || p.fields[1].kind != "integer" {
		t.Fatalf("wrong field metadata")
	}
	for _, changes := range []map[string]string{nil, {"Password": "secret"}, {"SlotCount": "4"}} {
		got, err := p.patch(changes)
		if err != nil || !bytes.Equal(raw, got) {
			t.Fatal("no-op changed bytes", err)
		}
	}
	got, err := p.patch(map[string]string{"SlotCount": "6"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(raw, []byte(`"SlotCount": 4`), []byte(`"SlotCount": 6`), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("changed unrelated bytes")
	}
	got, err = p.patch(map[string]string{"Password": "new\"pass", "SlotCount": "1"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := parseTerraTechSettings(got)
	if err != nil || again.fields[0].value != "new\"pass" || again.fields[1].value != "1" {
		t.Fatal("round trip failed", err)
	}
	raw[0] = 0 // parser owns its snapshot
	if _, err = p.patch(nil); err != nil {
		t.Fatal(err)
	}
}

func TestTerraTechSettingsRefusal(t *testing.T) {
	cases := []string{`[]`, `null`, `{} {}`, `{"Password":null}`, `{"Password":3}`, `{"SlotCount":1.0}`, `{"SlotCount":1e0}`, `{"SlotCount":true}`, `{"SlotCount":0}`, `{"SlotCount":7}`, `{"SlotCount":"4"}`, `{"Password":"a\n"}`, `{"Password":"a\u007f"}`, `{"Password":"` + strings.Repeat("a", 129) + `"}`, `{"Password":"a","password":"b"}`, `{"slotcount":3}`, `{"port":3}`, `{"x":{"a":1,"A":2}}`, `{"x":[{"a":1,"a":2}]}`, `{"x":NaN}`, `{"x":1,}`, "{\"x\":\"\xff\"}"}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			if _, err := parseTerraTechSettings([]byte(raw)); err == nil {
				t.Fatal("accepted unsafe input")
			}
		})
	}
	p, err := parseTerraTechSettings([]byte(`{"Password":"keep","SlotCount":3,"Port":7777}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []map[string]string{{"Port": "7778"}, {"password": "oops"}, {"unknown": "x"}, {"SlotCount": "06"}, {"SlotCount": "+3"}, {"SlotCount": " 3"}, {"SlotCount": "7"}, {"Password": "bad\n"}, {"SlotCount": "4", "Port": "1"}} {
		if got, err := p.patch(c); err == nil || got != nil {
			t.Fatal("unsafe edit returned bytes")
		}
	}
}

func TestTerraTechSettingsNoDefaults(t *testing.T) {
	for _, raw := range []string{`{}`, `{"unknown":900719925474099312345}`, `{"SlotCount":6}`} {
		p, err := parseTerraTechSettings([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		got, err := p.patch(nil)
		if err != nil || string(got) != raw {
			t.Fatal("inserted defaults")
		}
		if got, err := p.patch(map[string]string{"Password": "new"}); err == nil || got != nil {
			t.Fatal("created absent secret")
		}
	}
	p, err := parseTerraTechSettings([]byte(`{"Password":""}`))
	if err != nil {
		t.Fatal(err)
	}
	if !p.fields[0].secret || p.fields[0].value != "" {
		t.Fatal("empty password")
	}
	if !terraTechSettingValue("Password", strings.Repeat("é", 128)) {
		t.Fatal("canonical character count")
	}
}
