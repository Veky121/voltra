package panel

import (
	"bytes"
	"testing"
)

func TestReviewedFiveMSafePatch(t *testing.T) {
	input := []byte("# operator\r\nsv_hostname \"old\" // retained\r\nsv_lan 0\r\nsv_licenseKey secret\r\nensure custom\r\n")
	p, e := parseFiveMSettings(input)
	if e != nil {
		t.Fatal(e)
	}
	b, e := p.patch(map[string]string{"sv_hostname": "new"})
	if e != nil || !bytes.Contains(b, []byte("sv_licenseKey secret\r\nensure custom\r\n")) || !bytes.Contains(b, []byte("// retained\r\n")) {
		t.Fatalf("patch preservation: %v", e)
	}
	for _, v := range []string{"bad\nexec evil", "a;quit", "a\"b"} {
		if _, e = p.patch(map[string]string{"sv_hostname": v}); e == nil {
			t.Fatal("injection accepted")
		}
	}
	for _, s := range []string{"exec private.cfg\n", "vstr private\n", "sv_lan 0\nsv_lan 1\n", "sv_hostname \"bad\n"} {
		if _, e := parseFiveMSettings([]byte(s)); e == nil {
			t.Fatal("ambiguous CFG accepted")
		}
	}
}
