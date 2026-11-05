package panel

import (
	"bytes"
	"testing"
)

func TestHurtworldWave28Preservation(t *testing.T) {
	raw := []byte("# operator\r\nservername \"My server\" # name\r\nmaxplayers 60\r\ncreativemode 0\r\naddadmin 76561190000000001\r\naddadmin 76561190000000002\r\nplugin_option 7\r\nsetpassword private-marker\r\n")
	p, e := parseHurtworldSettings(raw)
	if e != nil {
		t.Fatal(e)
	}
	out, e := p.patch(map[string]string{"servername": "Other server", "maxplayers": "20", "creativemode": "1"})
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(out, []byte("servername \"Other server\" # name\r\n")) || !bytes.Contains(out, []byte("addadmin 76561190000000001\r\naddadmin 76561190000000002\r\nplugin_option 7\r\nsetpassword private-marker\r\n")) {
		t.Fatal("unowned bytes changed")
	}
	for _, v := range []string{"0", "2147483648", "1;quit", "01"} {
		if _, e = p.patch(map[string]string{"maxplayers": v}); e == nil {
			t.Fatal("invalid number accepted")
		}
	}
	for _, v := range []string{"bad;quit", "bad\"name", "bad\\name", "bad\nname"} {
		if _, e = p.patch(map[string]string{"servername": v}); e == nil {
			t.Fatal("injection accepted")
		}
	}
}

func TestHurtworldWave28Refusal(t *testing.T) {
	for _, suffix := range []string{"maxplayers 2\n", "MAXPLAYERS 2\n", "exec other.cfg\n", "host 1234\n", "plugin_option 1;quit\n"} {
		raw := []byte("servername \"My server\"\nmaxplayers 60\ncreativemode 0\n" + suffix)
		before := bytes.Clone(raw)
		p, e := parseHurtworldSettings(raw)
		if e != nil {
			continue
		}
		if _, e = p.patch(map[string]string{"maxplayers": "20"}); e == nil {
			t.Fatal("ambiguous command accepted")
		}
		if !bytes.Equal(raw, before) {
			t.Fatal("refusal mutated source")
		}
	}
}
