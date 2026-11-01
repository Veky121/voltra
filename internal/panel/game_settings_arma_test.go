package panel

import (
	"strings"
	"testing"
)

func TestArmaCFGRoundTrip(t *testing.T) {
	original := "// lead\r\nhostname = \"a\"\"b;{//\"; // tail\r\npasswordAdmin=\"secret\";\nmaxPlayers=32;\nclass Missions {class One {hostname=\"nested\";};};\ncustom[]={1,2};\n"
	p, e := parseArmaSettings([]byte(original))
	if e != nil {
		t.Fatal(e)
	}
	got, e := p.patch(map[string]string{"hostname": `new "quote"`, "maxPlayers": "64"})
	if e != nil {
		t.Fatal(e)
	}
	want := strings.Replace(strings.Replace(original, `"a""b;{//"`, `"new ""quote"""`, 1), "maxPlayers=32", "maxPlayers=64", 1)
	if string(got) != want {
		t.Fatalf("unexpected round trip: %s", got)
	}
	if _, e = parseArmaSettings(got); e != nil {
		t.Fatal(e)
	}
	if !gameSettingSecret.MatchString("passwordAdmin") {
		t.Fatal("secret classification")
	}
	for _, v := range []string{"0", "2147483648", "1.5", "1;hostname=1"} {
		if _, e = p.patch(map[string]string{"maxPlayers": v}); e == nil {
			t.Fatalf("accepted %q", v)
		}
	}
}
func TestArmaCFGFailClosed(t *testing.T) {
	for _, s := range []string{`hostname="oops;`, "/*oops", "class X {", "#include \"x\"\nhostname=1;", "maxPlayers=32"} {
		if _, e := parseArmaSettings([]byte(s)); e == nil {
			t.Fatalf("accepted %q", s)
		}
	}
	for _, s := range []string{`hostname="a";hostname="b";`, `hostname="a"+"b";`, `hostname=call();`, `port=2302;`} {
		p, e := parseArmaSettings([]byte(s))
		if e != nil {
			t.Fatal(e)
		}
		for _, f := range p.fields {
			if f.kind != "readonly" {
				t.Fatalf("writable %q", s)
			}
			if _, e = p.patch(map[string]string{f.key: "1"}); e == nil {
				t.Fatal("patch allowed")
			}
		}
	}
}
func TestArmaCFGBasicAndBooleans(t *testing.T) {
	p, e := parseArmaSettings([]byte("MinErrorToSend=0.001; BattlEye=1; unknown=123;"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"MinErrorToSend": "0.5", "BattlEye": "0"}); e != nil {
		t.Fatal(e)
	}
	if _, e = p.patch(map[string]string{"BattlEye": "2"}); e == nil {
		t.Fatal("invalid boolean")
	}
}
