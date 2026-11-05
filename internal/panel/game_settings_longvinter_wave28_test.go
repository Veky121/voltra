package panel

import (
	"bytes"
	"testing"
)

func TestLongvinterWave28Preservation(t *testing.T) {
	data := []byte("; keep\r\n[" + stringsTrimLongvinterSection() + "]\r\nCheckVPN = true ; comment\r\n+Unknown=one\r\n+Unknown=two\r\n")
	p, e := parseLongvinterSettings(data)
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{longvinterGeneral + "CheckVPN": "false"})
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(got, bytes.Replace(data, []byte("true"), []byte("false"), 1)) {
		t.Fatal("unrelated bytes changed")
	}
	if _, e = p.patch(map[string]string{longvinterGeneral + "CheckVPN": "1"}); e == nil {
		t.Fatal("invalid boolean accepted")
	}
}
func stringsTrimLongvinterSection() string { return longvinterGeneral[:len(longvinterGeneral)-1] }
func TestLongvinterWave28Authority(t *testing.T) {
	if longvinterSettingsAuthority(M{"startup": "custom"}, M{"startup": "custom"}) {
		t.Fatal("custom launcher accepted")
	}
}
