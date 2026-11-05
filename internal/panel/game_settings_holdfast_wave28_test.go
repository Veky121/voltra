package panel

import (
	"bytes"
	"testing"
)

func TestHoldfastWave28Preservation(t *testing.T) {
	raw := []byte("# secret untouched\r\nserver_name Operator\r\nunknown a b\r\n!map_rotation start\r\nmap_name PalisadeArena\r\nfriendly_fire true  \r\nspawn_immunity_timer 3\r\n!map_rotation end\r\n")
	p, e := parseHoldfastSettings(raw)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"rotation_1/friendly_fire": "false"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(raw, []byte("friendly_fire true"), []byte("friendly_fire false"), 1)
	if !bytes.Equal(got, want) {
		t.Fatal("bytes changed")
	}
	for _, change := range []map[string]string{{"rotation_1/spawn_immunity_timer": "6"}, {"general/server_name": "x\nimport evil"}, {"unknown": "true"}} {
		if _, e = p.patch(change); e == nil {
			t.Fatal("unsafe accepted")
		}
	}
	p, e = parseHoldfastSettings(append([]byte("import rules.txt\n"), raw...))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"general/server_name": "x"}); e == nil {
		t.Fatal("import writable")
	}
	for _, v := range []string{"!map_rotation start\n", "server_name a\nserver_name b\n"} {
		if _, e = parseHoldfastSettings([]byte(v)); e == nil {
			t.Fatal("malformed accepted")
		}
	}
}
