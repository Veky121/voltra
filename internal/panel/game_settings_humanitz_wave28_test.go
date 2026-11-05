package panel

import (
	"bytes"
	"testing"
)

func TestHumanitzWave28Preservation(t *testing.T) {
	data := []byte("\ufeff[Host Settings]\r\n;private\r\nPassword=secret\r\n[World Settings]\r\nPVP = 1  \r\n+Unknown=a\r\n+Unknown=b\r\n")
	p, e := parseHumanitzSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"World Settings/PVP": "0"})
	if e != nil || !bytes.Equal(got, bytes.Replace(data, []byte("PVP = 1"), []byte("PVP = 0"), 1)) {
		t.Fatal("preservation", e)
	}
	for _, v := range []string{"2", "true", "0\nx=y"} {
		if b, e := p.patch(map[string]string{"World Settings/PVP": v}); e == nil || b != nil {
			t.Fatal("accepted invalid boolean")
		}
	}
	if _, e = p.patch(map[string]string{"World Settings/Missing": "1"}); e == nil {
		t.Fatal("inserted missing")
	}
	for _, tail := range []string{"PVP=0\n", "pvp=0\n", "+PVP=0\n"} {
		if _, e := parseHumanitzSettings(append(bytes.Clone(data), []byte(tail)...)); e == nil {
			t.Fatal("accepted ambiguous key")
		}
	}
}
