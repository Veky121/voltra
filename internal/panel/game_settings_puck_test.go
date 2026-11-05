package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestPuckSettingsPreserveBytes(t *testing.T) {
	// Adversarial schema fixture; not a captured native configuration.
	input := []byte("\xef\xbb\xbf{\r\n  \"useWhitelist\": false, \"port\":28011, \"password\":\"secret\", \"unknown\":900719925474099312345, \"mods\":[{\"id\":\"x\"}], \"fraction\":1.2300e-20\r\n}\n")
	p, err := parsePuckSettings(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 1 || p.fields[0].kind != "boolean" {
		t.Fatal("unexpected fields")
	}
	got, err := p.patch(map[string]string{"/useWhitelist": "true"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(input, []byte("false"), []byte("true"), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("unrelated bytes changed")
	}
	unchanged, err := p.patch(nil)
	if err != nil || !bytes.Equal(unchanged, input) {
		t.Fatal("no-op changed bytes")
	}
	for _, key := range []string{"/port", "/password", "/name", "/tickRate", "/mods", "/gameMode", "/usewhitelist"} {
		if b, e := p.patch(map[string]string{key: "true"}); e == nil || b != nil {
			t.Fatalf("editable %s", key)
		}
	}
	for _, v := range []string{"True", "1", "false\n", "null"} {
		if _, e := p.patch(map[string]string{"/useWhitelist": v}); e == nil {
			t.Fatal(v)
		}
	}
}
func TestPuckSettingsRefuseAmbiguity(t *testing.T) {
	for _, s := range []string{`[]`, `null`, `{"useWhitelist":null}`, `{"useWhitelist":1}`, `{"useWhitelist":"false"}`, `{"UseWhitelist":true}`, `{"useWhitelist":true,"useWhitelist":false}`, `{"x":{"a":1,"A":2}}`, `{"x":NaN}`, `{"x":Infinity}`, `{"x":1} {}`, strings.Repeat("[", 130) + strings.Repeat("]", 130)} {
		if _, err := parsePuckSettings([]byte(s)); err == nil {
			t.Fatalf("accepted %s", s)
		}
	}
	p, err := parsePuckSettings([]byte(`{"unknown":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 0 {
		t.Fatal("invented default")
	}
	if _, err = p.patch(map[string]string{"/useWhitelist": "true"}); err == nil {
		t.Fatal("seeded absent field")
	}
}

func TestPuckSettingsHelperEmission(t *testing.T) {
	data, err := os.ReadFile("../../artifacts/game-parity-20261029/puck-settings-source/helper-emitted.json")
	if err != nil {
		t.Fatal(err)
	}
	p, err := parsePuckSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 1 || p.fields[0].value != "false" {
		t.Fatal("unexpected helper emission")
	}
	got, err := p.patch(map[string]string{"/useWhitelist": "true"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, bytes.Replace(data, []byte(`"useWhitelist": false`), []byte(`"useWhitelist": true`), 1)) {
		t.Fatal("emission not preserved")
	}
}
