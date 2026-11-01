package panel

import (
	"bytes"
	"testing"
)

func TestAmong168Scalars(t *testing.T) {
	cases := []struct{ name, input, key, value, want string }{
		{"single-quote", "integratedRelay:\r\n  defaultPassword: 'one''two' # keep\r\nunknown: 9007199254740993\r\n", "/integratedRelay/defaultPassword", "fresh", "integratedRelay:\r\n  defaultPassword: \"fresh\" # keep\r\nunknown: 9007199254740993\r\n"},
		{"plain-hash", "integratedRelay:\n  defaultPassword: abc#def # keep\n", "/integratedRelay/defaultPassword", "fresh", "integratedRelay:\n  defaultPassword: \"fresh\" # keep\n"},
		{"escaped-quote", "integratedRelay:\n  defaultUsername: \"one\\\"two\" # keep\n", "/integratedRelay/defaultUsername", "fresh", "integratedRelay:\n  defaultUsername: \"fresh\" # keep\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, e := parseAmong165("/crewlink/config/peerConfig.yml", []byte(c.input))
			if e != nil {
				t.Fatal(e)
			}
			got, e := p.patch(map[string]string{c.key: c.value})
			if e != nil {
				t.Fatal(e)
			}
			if string(got) != c.want {
				t.Fatalf("unexpected bytes %q", got)
			}
		})
	}
	t.Run("json-bom", func(t *testing.T) {
		input := append([]byte{239, 187, 191}, []byte("{\r\n\"Server\":{\"PublicPort\":1234,\"PublicIp\":\"host\"},\"unknown\":9007199254740993}\r\n")...)
		p, e := parseAmong165("/impostor/config.json", input)
		if e != nil {
			t.Fatal(e)
		}
		got, e := p.patch(map[string]string{"/Server/PublicPort": "00042"})
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(got, bytes.Replace(input, []byte("1234"), []byte("42"), 1)) {
			t.Fatalf("unexpected bytes %q", got)
		}
	})
	for _, input := range []string{"integratedRelay:\n  debugLevel: 123\n", "integratedRelay:\n  defaultPassword: |\n    text\n", "unknown: yes\n"} {
		t.Run("readonly", func(t *testing.T) {
			p, e := parseAmong165("/crewlink/config/peerConfig.yml", []byte(input))
			if e != nil {
				t.Fatal(e)
			}
			for _, f := range p.fields {
				if f.kind != "readonly" {
					t.Fatalf("unsupported field editable: %s", f.key)
				}
				if _, e = p.patch(map[string]string{f.key: "fresh"}); e == nil {
					t.Fatal("unsupported edit accepted")
				}
			}
		})
	}
	t.Run("controls", func(t *testing.T) {
		p, e := parseAmong165("/crewlink/config/peerConfig.yml", []byte("integratedRelay:\n  defaultPassword: old\n"))
		if e != nil {
			t.Fatal(e)
		}
		for _, v := range []string{"bad\x00value", "bad\x7fvalue", "bad\nvalue"} {
			if _, e = p.patch(map[string]string{"/integratedRelay/defaultPassword": v}); e == nil {
				t.Fatal("control accepted")
			}
		}
	})
}
