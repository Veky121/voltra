package panel

import (
	"bytes"
	"testing"
)

func TestSquadScalarRoundTrip(t *testing.T) {
	data := []byte("\xef\xbb\xbf// header\r\n ServerName = \"Name // quoted\" // note\r\nMaxPlayers=80\r\nNumReservedSlots=2\r\nShouldAdvertise=true // public\r\nServerPassword=operator-secret\r\nUnknown=(keep,this)\r\n")
	p, e := parseSquadSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	out, e := p.patch(map[string]string{"ServerName": "New // name", "ShouldAdvertise": "false"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("Name // quoted"), []byte("New // name"), 1)
	want = bytes.Replace(want, []byte("true // public"), []byte("false // public"), 1)
	if !bytes.Equal(out, want) {
		t.Fatalf("unexpected patch %q", out)
	}
	for _, f := range p.fields {
		if f.key == "ServerPassword" || f.key == "Unknown" {
			t.Fatal("unknown/secret leaked")
		}
		if f.key == "ShouldAdvertise" && (f.kind != "boolean" || f.on != "true" || f.off != "false") {
			t.Fatal(f)
		}
	}
	noop, e := p.patch(nil)
	if e != nil || !bytes.Equal(noop, data) {
		t.Fatal("no-op changed bytes")
	}
	for _, change := range []map[string]string{{"ServerPassword": "x"}, {"Port": "1234"}, {"ServerName": "bad\nline"}, {"MaxPlayers": "1"}, {"ShouldAdvertise": "1"}, {"ServerName": "bad\"quote"}} {
		if b, e := p.patch(change); e == nil || b != nil {
			t.Fatal("unsafe accepted", change)
		}
	}
}
func TestSquadGrammarRefusal(t *testing.T) {
	for _, s := range []string{"MaxPlayers=80\nmaxplayers=81", "MaxPlayers=80\nMaxPlayers=garbage", "ServerName=unquoted", "ShouldAdvertise=yes", "ServerName=\"unterminated", "MaxPlayers=80;exec other", "MaxPlayers=(80)", "MaxPlayers=80\x00"} {
		if _, e := parseSquadSettings([]byte(s)); e == nil {
			t.Fatal("accepted", s)
		}
	}
	for _, s := range []string{"// MaxPlayers=80\n", "MaxPlayers=\"80\" // comment", "servername=\"Unicode Λ\"", "Unknown=x\nAdmins=operator\n"} {
		p, e := parseSquadSettings([]byte(s))
		if e != nil {
			t.Fatal(s, e)
		}
		out, e := p.patch(nil)
		if e != nil || string(out) != s {
			t.Fatal(s, e)
		}
	}
}
