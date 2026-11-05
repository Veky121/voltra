package panel

import (
	"strings"
	"testing"
)

func TestWave91ReforgerValidation(t *testing.T) {
	for _, input := range []string{`{"game":{"maxPlayers":0}}`, `{"game":{"maxPlayers":true}}`, `{"game":{"maxPlayers":1.0}}`, `{"game":{"passwordAdmin":"has space"}}`, `{"game":{"password":"` + strings.Repeat("x", 33) + `"}}`, `{"a2s":{"port":28000}}`, `{"a2s":{"port":29000}}`, `{"rcon":{"port":28001,"password":"short"}}`, `{"publicAddress":"::1"}`, `{"game":null}`} {
		if validateReforgerSettings([]byte(input), 28000, []int{28000, 28001, 28002}) == nil {
			t.Errorf("accepted %s", input)
		}
	}
	for _, input := range []string{`{}`, `{"game":{"maxPlayers":1,"passwordAdmin":"","visible":false,"password":"` + strings.Repeat("界", 32) + `"}}`, `{"game":{"maxPlayers":256},"publicAddress":"local","a2s":{"port":28001},"rcon":{"port":28002,"password":"abcdefgh"},"unknown":{"keep":true}}`} {
		if err := validateReforgerSettings([]byte(input), 28000, []int{28000, 28001, 28002}); err != nil {
			t.Fatal(err)
		}
	}
}
func TestWave91ReforgerPatch(t *testing.T) {
	data := []byte(`{"bindPort":5,"game":{"maxPlayers":32,"passwordAdmin":"secret"},"unknown":{"keep":true}}`)
	generic, e := parseGameSettings("/config.json", data)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = generic.patch(map[string]string{"/game/maxPlayers": "0"}); e != nil {
		t.Fatalf("baseline failure not reproduced: %v", e)
	}
	p, e := parseReforgerSettings(data, 28000, []int{28000, 28001})
	if e != nil {
		t.Fatal(e)
	}
	for _, k := range []string{"/bindPort", "/game/maxPlayers", "/game/passwordAdmin"} {
		v := "0"
		if k == "/game/passwordAdmin" {
			v = "has space"
		}
		if _, e = p.patch(map[string]string{k: v}); e == nil {
			t.Fatalf("accepted %s", k)
		}
	}
	result, e := p.patch(map[string]string{"/game/maxPlayers": "256"})
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(string(result), `"keep": true`) || !strings.Contains(string(result), `"passwordAdmin": "secret"`) {
		t.Fatal(string(result))
	}
	for _, f := range p.fields {
		if f.key == "/bindPort" && f.kind != "readonly" {
			t.Fatal("bindPort writable")
		}
	}
}
