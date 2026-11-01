package panel

import (
	"bytes"
	"testing"
)

func TestOnsetSpans(t *testing.T) {
	body := []byte("{\r\n \"servername\":\"old\", \"port\":7777, \"voice\":true, \"password\":\"secret\", \"custom\":{\"n\":9007199254740993}}")
	p, e := parseOnsetSettings(body)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"servername": "new", "voice": "false"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(bytes.Replace(body, []byte(`"old"`), []byte(`"new"`), 1), []byte(`true`), []byte(`false`), 1)
	if !bytes.Equal(got, want) {
		t.Fatalf("bytes changed: %s", got)
	}
	for _, c := range []map[string]string{{"port": "1234"}, {"voice": "1"}, {"missing": "x"}} {
		if _, e = p.patch(c); e == nil {
			t.Fatal("accepted unsafe edit")
		}
	}
	for _, b := range []string{`{"a":1,"a":2}`, `{"a":{"b":1,"b":2}}`, `[]`, `{"a":NaN}`} {
		if _, e = parseOnsetSettings([]byte(b)); e == nil {
			t.Fatal("accepted", b)
		}
	}
}
func TestOnsetAuthority(t *testing.T) {
	r := map[string]string{".voltra/onset_native.py": "digest"}
	if !onsetSettingsAuthority(onsetSettingsRecipe, onsetSettingsStartup, 0, r, r) {
		t.Fatal("refused")
	}
	if onsetSettingsAuthority(onsetSettingsRecipe, onsetSettingsStartup+" extra", 0, r, r) || onsetSettingsAuthority(onsetSettingsRecipe, onsetSettingsStartup, 1, r, r) {
		t.Fatal("unsafe authority")
	}
}
