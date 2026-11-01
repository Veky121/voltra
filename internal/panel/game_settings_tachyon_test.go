package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestTachyonSettingsPreserveNativeBytes(t *testing.T) {
	source := []byte("-- publisher CRCRLF\r\r\nSERVER_PORT=30303\r\r\nAUTOSAVE_TIME=300\r\r\n  RESPAWN_TIME=+20 \r\r\nALLOW_SERVER_RESET=1\r\r\nUNKNOWN_AUTH_TOKEN=private-fixture\r\r\nUNIVERSE_WIDTH=100")
	p, err := parseTachyonSettings(source)
	if err != nil || len(p.fields) != 4 {
		t.Fatalf("parse=%v fields=%d", err, len(p.fields))
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private") {
			t.Fatal("unknown secret exposed")
		}
		if f.key == "SERVER_PORT" && f.kind != "readonly" {
			t.Fatal("allocation-owned port editable")
		}
		if f.key == "ALLOW_SERVER_RESET" && (f.kind != "boolean" || f.on != "1" || f.off != "0") {
			t.Fatal("boolean metadata")
		}
	}
	same, err := p.patch(map[string]string{"RESPAWN_TIME": "20"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("no-op normalized bytes")
	}
	updated, err := p.patch(map[string]string{"AUTOSAVE_TIME": "600", "ALLOW_SERVER_RESET": "0"})
	expected := bytes.Replace(source, []byte("AUTOSAVE_TIME=300"), []byte("AUTOSAVE_TIME=600"), 1)
	expected = bytes.Replace(expected, []byte("ALLOW_SERVER_RESET=1"), []byte("ALLOW_SERVER_RESET=0"), 1)
	if err != nil || !bytes.Equal(updated, expected) {
		t.Fatal("patch changed unrelated bytes", err)
	}
	if _, err := p.patch(map[string]string{"SERVER_PORT": "12345"}); err == nil {
		t.Fatal("managed port patched")
	}
}

func TestTachyonSettingsNativeGrammarAndAmbiguity(t *testing.T) {
	for _, content := range []string{
		"AUTOSAVE_TIME=300\nAUTOSAVE_TIME=600\n", "AUTOSAVE_TIME=300\nautosave_time=600\n",
		"AUTOSAVE_TIME =300\n", "AUTOSAVE_TIME= 300\n", "AUTOSAVE_TIME=300 -- inline\n", "AUTOSAVE_TIME=300=600\n",
		"AUTOSAVE_TIME=2147483648\n", "AUTOSAVE_TIME=-1\n",
	} {
		t.Run(content, func(t *testing.T) {
			p, err := parseTachyonSettings([]byte(content))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = p.patch(map[string]string{"AUTOSAVE_TIME": "600"}); err == nil {
				t.Fatal("unsafe scalar patched")
			}
		})
	}
}

func TestTachyonSettingsRejectInjectionAndUnknown(t *testing.T) {
	p, err := parseTachyonSettings([]byte("-- AUTOSAVE_TIME=unsafeignored\nAUTOSAVE_TIME=300\nALLOW_SERVER_RESET=1\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]string{{"AUTOSAVE_TIME": "0"}, {"AUTOSAVE_TIME": "86401"}, {"AUTOSAVE_TIME": "3\nSERVER_PORT=1"}, {"ALLOW_SERVER_RESET": "2"}, {"UNIVERSE_WIDTH": "1"}, {"UNKNOWN_AUTH_TOKEN": "exposed"}} {
		if _, err = p.patch(change); err == nil {
			t.Fatal("invalid patch", change)
		}
	}
	for _, content := range [][]byte{[]byte("\ufeffAUTOSAVE_TIME=300"), []byte("AUTOSAVE_TIME=300\x00"), []byte("AUTOSAVE_TIME=300\rALLOW_SERVER_RESET=1"), {0xff}} {
		if _, err := parseTachyonSettings(content); err == nil {
			t.Fatal("unsafe document accepted")
		}
	}
}

func TestTachyonSettingsBooleanIntegerEncoding(t *testing.T) {
	source := []byte("ALLOW_SERVER_RESET=+01\r\r\n")
	p, err := parseTachyonSettings(source)
	if err != nil || len(p.fields) != 1 || p.fields[0].value != "1" || p.fields[0].kind != "boolean" {
		t.Fatal("Java integer boolean not normalized for switch", err)
	}
	same, err := p.patch(map[string]string{"ALLOW_SERVER_RESET": "1"})
	if err != nil || !bytes.Equal(same, source) {
		t.Fatal("no-op boolean integer changed bytes")
	}
}
