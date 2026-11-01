package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestResoniteSessionsPatchPrecision(t *testing.T) {
	data := append([]byte{0xef, 0xbb, 0xbf}, []byte(`{ "loginPassword":"fixture-secret", "cloudToken":"fixture-token", "unknown":900719925474099312345, "startWorlds":[null,{"sessionName":"Same","maxUsers":16,"saveOnExit":false,"accessLevel":"Private","unknown":{"x":1.23000e+99}},{"sessionName":"Same","description":null,"autoSleep":true}] }`)...)
	p, e := parseResoniteSessionSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 6 {
		t.Fatalf("fields %d", len(p.fields))
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "fixture-") || f.secret {
			t.Fatal("secret exposed")
		}
	}
	got, e := p.patch(map[string]string{"/startWorlds/1/sessionName": "New \"name\"", "/startWorlds/1/saveOnExit": "true", "/startWorlds/2/autoSleep": "false"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte(`"sessionName":"Same"`), []byte(`"sessionName":"New \"name\""`), 1)
	want = bytes.Replace(want, []byte(`"saveOnExit":false`), []byte(`"saveOnExit":true`), 1)
	want = bytes.Replace(want, []byte(`"autoSleep":true`), []byte(`"autoSleep":false`), 1)
	if !bytes.Equal(got, want) {
		t.Fatalf("unexpected bytes: %s", got)
	}
	noop, e := p.patch(nil)
	if e != nil || !bytes.Equal(noop, data) {
		t.Fatal("no-op changed bytes")
	}
	for _, key := range []string{"/startWorlds/01/maxUsers", "/startWorlds/-1/maxUsers", "/startWorlds/0/sessionName", "/startWorlds/3/sessionName", "/startWorlds/1/unknown/x", "/loginPassword", "/startWorlds/2/description"} {
		if out, e := p.patch(map[string]string{key: "1"}); e == nil || out != nil {
			t.Fatalf("accepted %s", key)
		}
	}
	for _, v := range []string{"0", "-1", "01", "1.5", "1e2", "2147483648", "true"} {
		if _, e := p.patch(map[string]string{"/startWorlds/1/maxUsers": v}); e == nil {
			t.Fatalf("accepted %s", v)
		}
	}
	for key, value := range map[string]string{"/startWorlds/1/accessLevel": "Public", "/startWorlds/1/saveOnExit": "1", "/startWorlds/1/sessionName": "line\nbreak"} {
		if _, e := p.patch(map[string]string{key: value}); e == nil {
			t.Fatal("invalid value accepted")
		}
	}
	// Patch results own their memory and cannot mutate the original closure.
	got[0] = 0
	again, _ := p.patch(nil)
	if !bytes.Equal(again, data) {
		t.Fatal("mutable snapshot")
	}
}

func TestResoniteSessionsAmbiguity(t *testing.T) {
	for _, s := range []string{
		`{"startWorlds":[],"StartWorlds":[]}`, `{"STARTWORLDS":[]}`, `{"startWorlds":{ "0":{"sessionName":"x"}}}`,
		`{"startWorlds":[{"sessionName":"x","sessionName":"y"}]}`, `{"startWorlds":[{"sessionName":"x","SessionName":"y"}]}`,
		`{"startWorlds":[{"unknown":{"x":1,"x":2}}]}`, `{"startWorlds":[[]]}`, `{"startWorlds":[{"maxUsers":true}]}`,
		`{"startWorlds":[{"accessLevel":null}]}`, `{"startWorlds":[{"saveOnExit":"false"}]}`, `{} {}`,
	} {
		if _, e := parseResoniteSessionSettings([]byte(s)); e == nil {
			t.Fatalf("accepted %s", s)
		}
	}
	for _, s := range []string{`{}`, `{"startWorlds":null}`, `{"startWorlds":[]}`, `{"startWorlds":[null,{"sessionName":null,"description":null}]}`} {
		p, e := parseResoniteSessionSettings([]byte(s))
		if e != nil || len(p.fields) != 0 {
			t.Fatalf("missing/null semantics %s: %v", s, e)
		}
		got, e := p.patch(nil)
		if e != nil || string(got) != s {
			t.Fatal("default synthesized")
		}
	}
	p, e := parseResoniteSessionSettings([]byte(`{"StartWorlds":[{"maxUsers":16}]}`))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"/startWorlds/0/maxUsers": "20"}); e == nil {
		t.Fatal("alias path accepted")
	}
	if _, e = p.patch(map[string]string{"/StartWorlds/0/maxUsers": "20"}); e != nil {
		t.Fatal(e)
	}
}
