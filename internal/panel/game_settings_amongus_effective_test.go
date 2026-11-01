package panel

import "testing"

func TestAmong172Effective(t *testing.T) {
	cases := []struct {
		name, body string
		changes    map[string]string
		env        M
		valid      bool
	}{
		{"valid", `{"Server":{"PublicIp":"host","PublicPort":1234},"opaque":9007199254740993}`, map[string]string{"/Server/PublicIp": "new.test"}, nil, true},
		{"invalid-port", `{"Server":{"PublicIp":"host","PublicPort":0}}`, map[string]string{"/Server/PublicIp": "new.test"}, nil, false},
		{"mixed-repair", `{"Server":{"PublicIp":"host","PublicPort":0}}`, map[string]string{"/Server/PublicIp": "new.test", "/Server/PublicPort": "4321"}, nil, true},
		{"invalid-ip", `{"Server":{"PublicIp":"bad /","PublicPort":1234}}`, map[string]string{"/Server/PublicPort": "4321"}, nil, false},
		{"section-alias", `{"server":{},"Server":{"PublicIp":"host","PublicPort":1234}}`, map[string]string{"/Server/PublicIp": "new.test"}, nil, false},
		{"field-alias", `{"Server":{"publicip":"alias","PublicIp":"host","PublicPort":1234}}`, map[string]string{"/Server/PublicIp": "new.test"}, nil, false},
		{"bad-http-section", `{"HttpServer":null,"Server":{"PublicIp":"host","PublicPort":1234}}`, map[string]string{"/Server/PublicIp": "new.test"}, nil, false},
		{"missing-valid-seed", `{"Server":{"PublicIp":"host"}}`, map[string]string{"/Server/PublicIp": "new.test"}, M{"SERVER_PORT": "2345"}, true},
		{"missing-invalid-seed", `{"Server":{"PublicIp":"host"}}`, map[string]string{"/Server/PublicIp": "new.test"}, M{"PUBLIC_PORT": "bad"}, false},
		{"unused-invalid-seed", `{"Server":{"PublicIp":"host","PublicPort":1234}}`, map[string]string{"/Server/PublicIp": "new.test"}, M{"PUBLIC_PORT": "bad"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, e := parseAmong165("/impostor/config.json", []byte(c.body), c.env)
			if e != nil {
				t.Fatal(e)
			}
			_, e = p.patch(c.changes)
			if (e == nil) != c.valid {
				t.Fatalf("acceptance=%v expected=%v error=%v", e == nil, c.valid, e)
			}
		})
	}
}
