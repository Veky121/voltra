package panel

import "testing"

func TestIOSoccerNativeCFG(t *testing.T) {
	original := "// operator\r\nmp_timelimit_warmup 0.5 // minutes\r\nrcon_password secret\r\nunknown value\r\n"
	p, e := parseIOSoccerSettings([]byte(original))
	if e != nil {
		t.Fatal(e)
	}
	b, e := p.patch(map[string]string{"mp_timelimit_warmup": "-1"})
	if e != nil {
		t.Fatal(e)
	}
	want := "// operator\r\nmp_timelimit_warmup -1 // minutes\r\nrcon_password secret\r\nunknown value\r\n"
	if string(b) != want {
		t.Fatalf("changed unrelated bytes: %q", b)
	}
	for _, v := range []string{"NaN", "1e40", "0;quit", "1\nquit"} {
		if _, e = p.patch(map[string]string{"mp_timelimit_warmup": v}); e == nil {
			t.Fatal(v)
		}
	}
	for _, d := range []string{"mp_timelimit_warmup 1\nMP_TIMELIMIT_WARMUP 2\n", "mp_timelimit_warmup 1;quit\n", "mp_timelimit_warmup 1\nexec \\\"other\\\"\n"} {
		p, e := parseIOSoccerSettings([]byte(d))
		if e == nil {
			if _, e = p.patch(map[string]string{"mp_timelimit_warmup": "2"}); e == nil {
				t.Fatalf("accepted %q", d)
			}
		}
	}
}
