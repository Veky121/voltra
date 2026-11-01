package panel

import (
	"bytes"
	"testing"
)

func TestWurmLauncherEdits(t *testing.T) {
	original := []byte("; operator\r\n[Options]\r\nCleanLogsOnStart = false  \r\nSecret=unchanged\r\nUnknown=1\r\n")
	p, e := parseWurmSettings(original)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 1 || p.fields[0].kind != "boolean" {
		t.Fatal("wrong typed coverage")
	}
	next, e := p.patch(map[string]string{"CleanLogsOnStart": "true"})
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(next, bytes.Replace(original, []byte("false"), []byte("true"), 1)) {
		t.Fatal("unrelated bytes changed")
	}
	for _, change := range []map[string]string{{"Secret": "x"}, {"CleanLogsOnStart": "true\nSecret=x"}} {
		if _, e = p.patch(change); e == nil {
			t.Fatal("unsafe edit accepted")
		}
	}
	if !bytes.Equal(original, []byte("; operator\r\n[Options]\r\nCleanLogsOnStart = false  \r\nSecret=unchanged\r\nUnknown=1\r\n")) {
		t.Fatal("input mutated")
	}
}
func TestWurmRefusals(t *testing.T) {
	for _, s := range []string{"", "CleanLogsOnStart=true\ncleanlogsonstart=false", "cleanlogsonstart=true", "CleanLogsOnStart=yes", "CleanLogsOnStart=true\x00"} {
		if _, e := parseWurmSettings([]byte(s)); e == nil {
			t.Fatalf("accepted %q", s)
		}
	}
}
