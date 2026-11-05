package panel

import (
	"strings"
	"testing"
)

func TestWave11ResoniteLosslessSettings(t *testing.T) {
	original := []byte("{\n  \"comment\": \"old\", \"loginPassword\": \"secret\", \"startWorlds\": [{\"saveOnExit\": true}], \"opaque\": [1, 2]\n}")
	p, err := parseResoniteSettings(original)
	if err != nil {
		t.Fatal(err)
	}
	next, err := p.patch(map[string]string{"/comment": "new"})
	if err != nil || string(next) != strings.Replace(string(original), `"old"`, `"new"`, 1) {
		t.Fatalf("lossless patch failed: %v", err)
	}
	for _, changes := range []map[string]string{{"/tickRate": "60"}, {"/startWorlds/0/saveOnExit": "false"}, {"/comment": "bad\nvalue"}, {"/usernameOverride": "absent"}} {
		if _, err := p.patch(changes); err == nil {
			t.Fatal("unsupported patch accepted")
		}
	}
	for _, raw := range []string{`{"comment":"a","comment":"b"}`, `{"comment":"a","Comment":"b"}`, `{"comment":true}`, `[]`, `{"comment":"a"} trailing`} {
		if _, err := parseResoniteSettings([]byte(raw)); err == nil {
			t.Fatal("ambiguous input accepted")
		}
	}
}
