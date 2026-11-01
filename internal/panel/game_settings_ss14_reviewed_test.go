package panel

import (
	"bytes"
	"testing"
)

func TestSS14ReviewedPreservationAndExclusion(t *testing.T) {
	source := []byte("# retained\r\n[game]\r\nhostname = \"before\" # name\r\ndesc='description'\r\nsoft_max_players=8\r\n[net]\r\ntickrate=30\r\nmax_connections=8\r\nport=1212\r\n[auth]\r\nmode=1\r\nsecret='sentinel'\r\n[unknown]\r\narray=[1,2]\r\n")
	p, e := parseSS14ReviewedSettings(source)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 5 {
		t.Fatalf("fields: %v", p.fields)
	}
	got, e := p.patch(map[string]string{"game/hostname": "after"})
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(got, bytes.Replace(source, []byte("before"), []byte("after"), 1)) {
		t.Fatal("unrelated bytes changed")
	}
	for _, k := range []string{"net/port", "auth/mode", "auth/secret", "missing/key", "unknown/array", "hub/advertise"} {
		if _, e = p.patch(map[string]string{k: "1"}); e == nil {
			t.Fatalf("accepted %s", k)
		}
	}
}
func TestSS14ReviewedAmbiguityAndRefusal(t *testing.T) {
	for _, s := range []string{"[game]\nhostname='a'\nhostname='b'\n", "[game]\nhostname='a'\n\"hostname\"='b'\n", "game.hostname='a'\n[game]\nhostname='b'\n", "[game]\nhostname='a'\n[game]\ndesc='b'\n"} {
		if _, e := parseSS14ReviewedSettings([]byte(s)); e == nil {
			t.Fatalf("accepted ambiguous %q", s)
		}
	}
	for _, s := range []string{"[game]\n\"hostname\"='a'\n", "game.hostname='a'\n", "[game]\nhostname=1\n"} {
		p, e := parseSS14ReviewedSettings([]byte(s))
		if e != nil {
			continue
		}
		if _, e = p.patch(map[string]string{"game/hostname": "b"}); e == nil {
			t.Fatalf("edited unsupported %q", s)
		}
	}
	p, e := parseSS14ReviewedSettings([]byte("[game]\ndesc='a'\n"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"game/desc": "can't"}); e == nil {
		t.Fatal("literal quote accepted")
	}
}
