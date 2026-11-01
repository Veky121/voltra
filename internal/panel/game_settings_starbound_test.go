package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestStarboundPreservationAndSecretBoundary(t *testing.T) {
	input := "\xef\xbb\xbf{\r\n \"serverName\" : \"Before\", \"maxPlayers\":8, \"allowAnonymousConnections\":true, \"allowAssetsMismatch\":false, \"rconServerPassword\":\"hidden\", \"serverUsers\":{\"private\":{\"password\":\"secret\"}}, \"unknown\":[184467440737095516170,1.234567890123456789e-42,null]}\r\n"
	p, err := parseStarboundSettings([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 4 {
		t.Fatal("unexpected exposed fields")
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "secret") || strings.Contains(f.value, "hidden") {
			t.Fatal("secret exposed")
		}
	}
	out, err := p.patch(map[string]string{"/serverName": "After", "/maxPlayers": "18446744073709551619", "/allowAnonymousConnections": "false"})
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Replace(input, `"Before"`, `"After"`, 1)
	expected = strings.Replace(expected, `"maxPlayers":8`, `"maxPlayers":18446744073709551619`, 1)
	expected = strings.Replace(expected, `"allowAnonymousConnections":true`, `"allowAnonymousConnections":false`, 1)
	if string(out) != expected {
		t.Fatal("untouched bytes changed")
	}
	for _, key := range []string{"/rconServerPassword", "/serverUsers", "/serverUsers/private/password", "/unknown", "/gameServerPort"} {
		if _, err = p.patch(map[string]string{key: "********"}); err == nil {
			t.Fatalf("accepted %s", key)
		}
	}
	noOp, err := p.patch(nil)
	if err != nil || !bytes.Equal(noOp, []byte(input)) {
		t.Fatal("no-op changed bytes")
	}
}

func TestStarboundInvalidAndMissing(t *testing.T) {
	for _, input := range []string{`[]`, `{} {}`, `{"maxPlayers":1,"maxPlayers":2}`, `{"maxPlayers":1,"MaxPlayers":2}`, `{"ServerName":"x"}`, `{"x":{"a":1,"A":2}}`, `{"serverName":false}`, `{"maxPlayers":1.5}`, `{"maxPlayers":-1}`, `{"allowAssetsMismatch":"true"}`, `{"x":NaN}`} {
		if _, err := parseStarboundSettings([]byte(input)); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	p, err := parseStarboundSettings([]byte(`{"serverName":null,"maxPlayers":null,"serverUsers":{"x":{"password":"private"}}}`))
	if err != nil || len(p.fields) != 0 {
		t.Fatal("null/missing inferred defaults")
	}
	if _, err = p.patch(map[string]string{"/maxPlayers": "8"}); err == nil {
		t.Fatal("inserted absent key")
	}
	p, err = parseStarboundSettings([]byte(`{"serverName":"x","maxPlayers":8,"allowAssetsMismatch":false}`))
	if err != nil {
		t.Fatal(err)
	}
	for key, values := range map[string][]string{"/serverName": {"line\nbreak", "nul\x00"}, "/maxPlayers": {"1e3", "1.0", "-1", "01", "8,\"serverUsers\":{}"}, "/allowAssetsMismatch": {"1", "TRUE", "null"}} {
		for _, v := range values {
			if _, err = p.patch(map[string]string{key: v}); err == nil {
				t.Fatalf("accepted injection/type %s", key)
			}
		}
	}
	out, err := p.patch(map[string]string{"/serverName": `quote", "serverUsers":{}`})
	if err != nil {
		t.Fatal(err)
	}
	next, err := parseStarboundSettings(out)
	if err != nil || next.fields[0].value != `quote", "serverUsers":{}` {
		t.Fatal("quoted text did not remain scalar")
	}
}
