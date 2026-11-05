package panel

import (
	"bytes"
	"testing"
)

func TestWave40StrictNativeScalars(t *testing.T) {
	for _, recipe := range []string{jc3SettingsRecipe, plainsSettingsRecipe} {
		for _, body := range []string{`{"password":"x","password":"y"}`, `{"Password":"alias"}`, `{"maxPlayers":true}`, `{"maxPlayers":0}`, `{"password":"bad\nline"}`, `{"unknown":{"a":1,"a":2}}`, `{} {}`} {
			if _, e := parseWave40Settings(recipe, []byte(body)); e == nil {
				t.Fatalf("accepted %s", body)
			}
		}
		data := []byte(`{ "password":"secret", "maxPlayers":10,"port":28000,"unknown":900719925474099399999,"mods":[{"x":1.000000000000000001}] }`)
		p, e := parseWave40Settings(recipe, data)
		if e != nil {
			t.Fatal(e)
		}
		for _, k := range []string{"/port", "/unknown", "/mods", "/Password"} {
			if _, e = p.patch(map[string]string{k: "1"}); e == nil {
				t.Fatal(k)
			}
		}
		next, e := p.patch(map[string]string{"/maxPlayers": "20", "/password": "replacement"})
		if e != nil {
			t.Fatal(e)
		}
		expected := bytes.Replace(data, []byte(`"maxPlayers":10`), []byte(`"maxPlayers":20`), 1)
		expected = bytes.Replace(expected, []byte(`"secret"`), []byte(`"replacement"`), 1)
		if !bytes.Equal(next, expected) {
			t.Fatal("untouched bytes changed")
		}
	}
	p, e := parseWave40Settings(jc3SettingsRecipe, []byte(`{"announce":true,"maxTickRate":60}`))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"/announce": "false", "/maxTickRate": "30"}); e != nil {
		t.Fatal(e)
	}
}
