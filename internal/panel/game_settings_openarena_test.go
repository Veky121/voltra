package panel

import (
	"strings"
	"testing"
)

func TestOpenArenaTypedRoundTrip(t *testing.T) {
	before := "// native operator\r\n\tSeTa\tfraglimit \"20\" // preserve\r\nset timelimit 0\r\ng_friendlyFire 0\r\nseta Unknown \"literal text\"\r\necho operator-note\r\nset rconPassword \"private-sentinel\"\r\n"
	parsed, err := parseOpenArenaSettings([]byte(before))
	if err != nil || len(parsed.fields) != 3 {
		t.Fatalf("typed fields: %+v %v", parsed.fields, err)
	}
	for _, f := range parsed.fields {
		if strings.Contains(f.key, "rcon") || strings.Contains(f.value, "private-sentinel") {
			t.Fatal("secret exposed")
		}
	}
	same, err := parsed.patch(nil)
	if err != nil || string(same) != before {
		t.Fatal("no-op changed bytes", err)
	}
	after, err := parsed.patch(map[string]string{"fraglimit": "35", "timelimit": "12.5", "g_friendlyfire": "1"})
	expected := strings.Replace(before, `"20"`, `"35"`, 1)
	expected = strings.Replace(expected, "timelimit 0", "timelimit 12.5", 1)
	expected = strings.Replace(expected, "g_friendlyFire 0", "g_friendlyFire 1", 1)
	if err != nil || string(after) != expected {
		t.Fatal("prefix/comment/unknown byte preservation", string(after), err)
	}
}

func TestOpenArenaTypedAmbiguityAndInjection(t *testing.T) {
	for _, data := range []string{"set fraglimit 20\nSETA FRAGLIMIT 30\n", "set fraglimit 20\nsets FragLimit 30\n", "set fraglimit 20\nSETU fraglimit 30\n", "set fraglimit 20\nexec bad.cfg; quit\n", "set fraglimit 20\nset unknown \"bad\\value\"\n", "set fraglimit 20\nset fraglimit 1;quit\n"} {
		parsed, err := parseOpenArenaSettings([]byte(data))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = parsed.patch(map[string]string{"fraglimit": "40"}); err == nil {
			t.Fatal("ambiguous/unsafe document was writable", data)
		}
	}
	parsed, _ := parseOpenArenaSettings([]byte("set fraglimit 20\nset timelimit 0\nset g_friendlyFire 0\n"))
	for key, values := range map[string][]string{"fraglimit": {"-1", "1.0", "1;quit", "2147483648"}, "timelimit": {"NaN", "Inf", "-1", "1\nquit"}, "g_friendlyfire": {"2", "true"}, "sv_hostname": {"managed override"}} {
		for _, value := range values {
			if _, err := parsed.patch(map[string]string{key: value}); err == nil {
				t.Fatalf("unsafe %s accepted", key)
			}
		}
	}
}

func TestOpenArenaTypedControlFlowReadonly(t *testing.T) {
	for _, command := range []string{"exec operator.cfg", "exec\"operator.cfg\"", "\"exec\" \"operator.cfg\"", "\"fraglimit\" \"30\"", "set \"fraglimit\" \"30\"", "seta \"fraglimit\" \"30\"", "seta\"fraglimit\" \"30\"", "\"seta\" fraglimit 30", "vstr rotation", "toggle fraglimit", "reset fraglimit", "unset fraglimit", "cvar_restart", "map aggressor", "devmap aggressor", "map_restart", "wait"} {
		before := "set fraglimit 20\r\n" + command + "\r\n"
		parsed, err := parseOpenArenaSettings([]byte(before))
		if err != nil || len(parsed.fields) != 1 || parsed.fields[0].kind != "readonly" {
			t.Fatal("unmodeled engine control was writable", command, err)
		}
		if _, err := parsed.patch(map[string]string{"fraglimit": "21"}); err == nil {
			t.Fatal("readonly control patch accepted", command)
		}
		after, err := parsed.patch(nil)
		if err != nil || string(after) != before {
			t.Fatal("readonly no-op changed bytes", command, err)
		}
	}
	for _, prefix := range []string{"set", "seta", "sets", "setu"} {
		before := "\t" + prefix + "\tfraglimit 20 // preserve\r\n"
		parsed, _ := parseOpenArenaSettings([]byte(before))
		after, err := parsed.patch(map[string]string{"fraglimit": "40"})
		if err != nil || string(after) != strings.Replace(before, "20", "40", 1) {
			t.Fatal("native setter prefix lost", prefix, err)
		}
	}
}

func TestOpenArenaTypedRefusal(t *testing.T) {
	for _, data := range [][]byte{[]byte("\ufeffset fraglimit 20"), {0xff}, []byte("set fraglimit 20\rquit"), []byte("set fraglimit 20\u2028quit"), []byte(strings.Repeat("x", 65537))} {
		if _, err := parseOpenArenaSettings(data); err == nil {
			t.Fatal("unsafe format accepted")
		}
	}
}
