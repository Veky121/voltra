package panel

import (
	"bytes"
	"testing"
)

func TestFoundryVTTSettings(t *testing.T) {
	p, e := parseFoundryVTTSettings([]byte(`{"hostname":"en.core","proxySSL":false,"passwordSalt":"private","unknown":{"a":12345678901234567890}}`))
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 2 {
		t.Fatal("exposed private or unknown properties")
	}
	b, e := p.patch(map[string]string{"proxySSL": "true"})
	if e != nil || !bytes.Contains(b, []byte(`12345678901234567890`)) || !bytes.Contains(b, []byte(`"private"`)) {
		t.Fatalf("preservation failed: %v", e)
	}
	for _, change := range []map[string]string{{"passwordSalt": "bad"}, {"port": "9"}, {"proxySSL": "yes"}} {
		if _, e := p.patch(change); e == nil {
			t.Fatal("unsafe patch accepted")
		}
	}
	for _, s := range []string{`{"hostname":"a","hostname":"b"}`, `{} {}`, `{"proxySSL":"true"}`, `{"proxyPort":0}`} {
		if _, e := parseFoundryVTTSettings([]byte(s)); e == nil {
			t.Fatal("invalid accepted", s)
		}
	}
}
