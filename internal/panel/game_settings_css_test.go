package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestCSSSchemaMeasuredDefaultsAndPreservation(t *testing.T) {
	source := []byte("// operator\r\nmp_friendlyfire \"0\" // keep\r\nmp_autoteambalance 2\r\nmp_roundtime \"2.5\"\r\nmp_freezetime 6\r\nmp_limitteams 2\r\nmp_maxrounds 0\r\nmp_timelimit 0\r\nrcon_password \"private-fixture\"\r\nhostname \"operator\"\r\nunknown \"native bytes\"")
	p, err := parseCSSSettings(source)
	if err != nil || len(p.fields) != 7 {
		t.Fatal(err, len(p.fields))
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private") || f.key == "hostname" || f.kind == "readonly" {
			t.Fatal("secret/setup field exposed or native field refused", f.key)
		}
		if f.key == "mp_autoteambalance" && f.kind != "number" {
			t.Fatal("native enum incorrectly rendered boolean")
		}
	}
	updated, err := p.patch(map[string]string{"mp_friendlyfire": "1", "mp_roundtime": "3.5"})
	expected := bytes.Replace(source, []byte("mp_friendlyfire \"0\""), []byte("mp_friendlyfire \"1\""), 1)
	expected = bytes.Replace(expected, []byte("mp_roundtime \"2.5\""), []byte("mp_roundtime \"3.5\""), 1)
	if err != nil || !bytes.Equal(updated, expected) {
		t.Fatal("changed unrelated native bytes", err)
	}
	for _, key := range []string{"rcon_password", "hostname", "port", "clientport", "tv_port", "sv_setsteamaccount"} {
		if _, err := p.patch(map[string]string{key: "12345"}); err == nil {
			t.Fatal("setup credential/allocation writable", key)
		}
	}
}

func TestCSSSchemaBoundsAndExecutableAmbiguity(t *testing.T) {
	for key, values := range map[string][]string{"mp_friendlyfire": {"2", "1;quit"}, "mp_autoteambalance": {"3", "1.5"}, "mp_roundtime": {"0.5", "10", "NaN", "1\nquit"}, "mp_limitteams": {"31", "-1"}, "mp_freezetime": {"61", "2.5"}, "mp_maxrounds": {"-1", "1000001"}, "mp_timelimit": {"-1", "10081"}} {
		for _, value := range values {
			if cssScalarValue(cssScalarSchema(), key, value) {
				t.Fatal("invalid scalar accepted", key, value)
			}
		}
	}
	for _, tail := range []string{"exec own.cfg", "EXECIFEXISTS optional.cfg", "alias replay \"mp_friendlyfire 0\"", "cmd mp_friendlyfire 0", "script_execute cfg", "sm_cvar mp_friendlyfire 0", "MP_FRIENDLYFIRE 0", "mp_friendlyfire=0", "mp_roundtime 4; quit", "\"mp_friendlyfire\" \"1\"", "\"exec\" \"own.cfg\"", "\"alias\" replay \"mp_friendlyfire 0\""} {
		p, err := parseCSSSettings([]byte("mp_friendlyfire 1\n" + tail + "\n"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.patch(map[string]string{"mp_friendlyfire": "0"}); err == nil {
			t.Fatal("ambiguous executable cfg writable", tail)
		}
	}
}

func TestCSSSchemaDoesNotChangeCS2(t *testing.T) {
	for i := 0; i < 16; i++ {
		t.Run(string(rune('a'+i)), func(t *testing.T) {
			t.Parallel()
			css, err := parseCSSSettings([]byte("mp_autoteambalance 2\nmp_roundtime 2.5\n"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = css.patch(map[string]string{"mp_autoteambalance": "2"}); err != nil {
				t.Fatal(err)
			}
			if sourceSettingKinds["mp_autoteambalance"] != "boolean" || sourceSettingValue("mp_autoteambalance", "2") {
				t.Fatal("CSS mutated CS2 schema")
			}
			cs2, err := parseSourceSettings([]byte("mp_autoteambalance 1\nmp_roundtime 5\n"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = cs2.patch(map[string]string{"mp_autoteambalance": "2"}); err == nil {
				t.Fatal("CS2 boolean validator weakened")
			}
			if _, err = cs2.patch(map[string]string{"mp_roundtime": "20"}); err != nil {
				t.Fatal("CSS bounds leaked to CS2")
			}
		})
	}
}
