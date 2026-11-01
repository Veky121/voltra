package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestGoldSrcMeasuredSchemaProtectsManagedFields(t *testing.T) {
	input := []byte("// managed and unreviewed rows must refuse the entire document\r\nmp_friendlyfire 0\r\nmp_autoteambalance 1\r\nmp_roundtime 5\r\nbot_quota 8\r\nmp_teamname_1 \"CS2 only\"\r\nhostname \"Startup-managed\"\r\nsv_password \"private-player\"\r\nrcon_password \"private-admin\"\r\nsv_lan 0\r\nsys_ticrate 100\r\n")
	p, err := parseGoldSrcCS16Settings(input)
	if err != nil || len(p.fields) != 2 {
		t.Fatal("Measured GoldSrc fields missing", err)
	}
	for _, field := range p.fields {
		if field.kind != "readonly" {
			t.Fatal("Unknown or managed command left another field editable")
		}
	}
	for _, key := range []string{"mp_autoteambalance", "bot_quota", "mp_teamname_1", "hostname", "sv_password", "rcon_password", "sv_lan", "sys_ticrate", "map", "maxplayers", "servercfgfile"} {
		if _, err := p.patch(map[string]string{key: "1"}); err == nil {
			t.Fatal("Unreviewed, other-game or managed field writable", key)
		}
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(input, same) {
		t.Fatal("No-op altered native bytes")
	}
}

func TestGoldSrcNumericABIIsNotGameplaySchemaEvidence(t *testing.T) {
	// These are synthetic validator fixtures, not native CS1.6 cvar claims.
	specs := map[string]goldSrcScalarSpec{"fixture_number": {kind: "number", minimum: -3.4e38}, "fixture_boolean": {kind: "boolean"}}
	for _, value := range []string{"0", "1.5", "-1", ".5", "123456"} {
		if !goldSrcScalarValue(specs, "fixture_number", value) {
			t.Fatal("Representable scalar refused", value)
		}
	}
	for _, value := range []string{"NaN", "Inf", "1e3", "1;quit", "1\nquit", "99999999999999999999999999999999999999999999999999", "0." + strings.Repeat("0", 50) + "1"} {
		if goldSrcScalarValue(specs, "fixture_number", value) {
			t.Fatal("Unsafe/unrepresentable scalar accepted", value)
		}
	}
	for _, value := range []string{"2", "true", "1;quit"} {
		if goldSrcScalarValue(specs, "fixture_boolean", value) {
			t.Fatal("Non-binary fixture flag accepted")
		}
	}
}

func TestGoldSrcSchemaDoesNotLeakToSourceFamilies(t *testing.T) {
	for i := 0; i < 16; i++ {
		t.Run(string(rune('a'+i)), func(t *testing.T) {
			t.Parallel()
			gold, err := parseGoldSrcCS16Settings([]byte("mp_autoteambalance 2\nmp_roundtime 30\n"))
			if err != nil || len(gold.fields) != 1 || gold.fields[0].kind != "readonly" {
				t.Fatal("GoldSrc inherited another game's schema/bounds")
			}
			if sourceSettingKinds["mp_autoteambalance"] != "boolean" || sourceSettingValue("mp_autoteambalance", "2") {
				t.Fatal("Original CS2 map/validator changed")
			}
			css, err := parseCSSSettings([]byte("mp_autoteambalance 2\nmp_roundtime 5\n"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := css.patch(map[string]string{"mp_autoteambalance": "2"}); err != nil {
				t.Fatal("GoldSrc changed measured CSS enum")
			}
		})
	}
}

func TestGoldSrcExecutableNoOpAndInputRefusal(t *testing.T) {
	for _, tail := range []string{"exec operator.cfg", "ALIAS replay \"mp_friendlyfire 1\"", "stuffcmds", "amx_cvar mp_friendlyfire 1", "mp_friendlyfire 1;quit", "\"exec\" \"own.cfg\"", "\"mp_friendlyfire\" \"1\"", "changelevel de_dust2"} {
		input := []byte("// native\nmp_friendlyfire 0\n" + tail + "\n")
		p, err := parseGoldSrcCS16Settings(input)
		if err != nil {
			t.Fatal(err)
		}
		same, err := p.patch(nil)
		if err != nil || !bytes.Equal(same, input) {
			t.Fatal("Executable no-op changed bytes")
		}
		if _, err := p.patch(map[string]string{"mp_friendlyfire": "1"}); err == nil {
			t.Fatal("Executable or quoted-head document writable", tail)
		}
	}
	for _, input := range [][]byte{{0xef, 0xbb, 0xbf, 'x'}, {0xff}, []byte("unknown 1\rhidden 2\n"), []byte("mp_roundtime 5\r"), []byte("mp_roundtime 5\r\r\n"), []byte("// hidden\x00control\n"), []byte("mp_roundtime 5 // hidden\x7fcontrol\n")} {
		if _, err := parseGoldSrcCS16Settings(input); err == nil {
			t.Fatal("Unsupported encoding/line accepted")
		}
	}
	if _, err := parseGoldSrcCS16Settings(bytes.Repeat([]byte{'/'}, 65537)); err == nil {
		t.Fatal("Runtime-sized document cap not enforced")
	}
}

func TestGoldSrcPublisherSchemaAndEffectiveDefaults(t *testing.T) {
	// Types/ranges: shipped settings.scr, with roundtime repaired to measured
	// native map bounds 1..9. Values: fresh effective native cvarlist,
	// intentionally not the GUI's saved defaults for tkpunish/autokick/hostages.
	input := []byte("// preserved\r\nmp_timelimit 20\r\nmp_winlimit 0\r\nmp_maxrounds 0\r\nmp_roundtime 5\r\nmp_freezetime 6\r\nmp_buytime 1.5\r\nmp_startmoney 800\r\nmp_footsteps 1\r\nmp_forcecamera 0\r\nmp_fadetoblack 0\r\nmp_friendlyfire 0\r\nmp_tkpunish 0\r\nmp_autokick 1\r\nmp_hostagepenalty 13\r\nmp_flashlight 0\r\n// operator annotation remains byte-identical\r\n")
	p, err := parseGoldSrcCS16Settings(input)
	if err != nil || len(p.fields) != 15 {
		t.Fatal("Publisher-backed controls missing", err, len(p.fields))
	}
	booleans := 0
	for _, f := range p.fields {
		if f.kind == "readonly" || strings.Contains(f.value, "private") {
			t.Fatal("Measured default refused or secret exposed", f.key)
		}
		if f.kind == "boolean" {
			booleans++
		}
		if f.key == "mp_forcecamera" && f.kind != "number" {
			t.Fatal("Native three-way list rendered as a boolean")
		}
	}
	if booleans != 6 {
		t.Fatal("Publisher BOOL controls not preserved", booleans)
	}
	next, err := p.patch(map[string]string{"mp_roundtime": "9", "mp_forcecamera": "2", "mp_friendlyfire": "1"})
	expected := strings.Replace(string(input), "mp_roundtime 5", "mp_roundtime 9", 1)
	expected = strings.Replace(expected, "mp_forcecamera 0", "mp_forcecamera 2", 1)
	expected = strings.Replace(expected, "mp_friendlyfire 0", "mp_friendlyfire 1", 1)
	if err != nil || string(next) != expected {
		t.Fatal("Unknown bytes/order/CRLF/secret preservation failed", err)
	}
	again, _ := parseGoldSrcCS16Settings(next)
	if _, err := again.patch(map[string]string{"mp_roundtime": "1"}); err != nil {
		t.Fatal("Measured native minimum refused", err)
	}
	for key, values := range map[string][]string{
		"mp_roundtime": {"-1", "0", "0.5", "12", "15", "9.1", "9.0000000000000000000000001", "0.9999999999999999999999999"}, "mp_freezetime": {"-1", "61"},
		"mp_buytime": {"0", "0.249", "0.2499999999999999999999999"}, "mp_startmoney": {"799", "16001", "799.99999999999999999999999"},
		"mp_forcecamera": {"-1", "3", "1.5", "1.000000000000000000000001"}, "mp_footsteps": {"2", "true"},
		"mp_timelimit": {"-1", "1;quit"},
	} {
		for _, value := range values {
			if _, err := p.patch(map[string]string{key: value}); err == nil {
				t.Fatal("Publisher-invalid scalar accepted", key, value)
			}
		}
	}
}

func TestGoldSrcStockIncludeOrderIsReadOnly(t *testing.T) {
	input := []byte("// stock-shaped fixture\r\nsv_aim 0\r\npausable 0\r\nhostname \"managed\"\r\nsv_maxspeed 320\r\nmp_timelimit 20\r\nsv_cheats 0\r\nexec listip.cfg\r\nexec banned.cfg\r\n")
	p, err := parseGoldSrcCS16Settings(input)
	if err != nil || len(p.fields) != 1 || p.fields[0].kind != "readonly" {
		t.Fatal("Later includes cannot establish editable effective values", err)
	}
	if _, err := p.patch(map[string]string{"mp_timelimit": "30"}); err == nil {
		t.Fatal("Stock include chain was treated as authoritative scalar data")
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(same, input) {
		t.Fatal("Stock include order/comments altered")
	}
}

func TestGoldSrcControlledDocumentRefusesAllAmbiguity(t *testing.T) {
	for _, tail := range []string{
		"mp_roundtime 7\nMP_ROUNDTIME 8", // case-insensitive duplicates
		"mp_roundtime 7\nmp_roundtime=8", // malformed duplicate
		"mp_roundtime 99",                // one invalid scalar invalidates the document
		"mp_roundtime", "unreviewed_cvar 1", "hostname \"managed\"",
		"exec server.cfg", "alias mp_roundtime \"quit\"", "// fine\nwait",
		"mp_roundtime 5 extra", "mp_roundtime \"5\";quit", "mp_roundtime 5\\",
		"\"mp_roundtime\" \"5\"", "mp_roundtime 5 /* comment */",
	} {
		t.Run(tail, func(t *testing.T) {
			input := []byte("// kept\r\nmp_friendlyfire 0\r\n" + tail + "\r\n")
			p, err := parseGoldSrcCS16Settings(input)
			if err != nil {
				t.Fatal(err)
			}
			for _, f := range p.fields {
				if f.kind != "readonly" {
					t.Fatal("Ambiguous document retained editable field", f.key)
				}
			}
			if _, err := p.patch(map[string]string{"mp_friendlyfire": "1"}); err == nil {
				t.Fatal("Unrelated edit escaped whole-document refusal")
			}
			unchanged, err := p.patch(nil)
			if err != nil || !bytes.Equal(input, unchanged) {
				t.Fatal("Read-only no-op altered operator bytes")
			}
		})
	}
}

func TestGoldSrcControlledPartialDocumentPreservesShape(t *testing.T) {
	if goldSrcCS16SettingsPath != "/cstrike/voltra_gameplay.cfg" {
		t.Fatal("Legacy command file exposed instead of controlled gameplay file")
	}
	input := []byte("// operator deliberately removed other settings\r\n  MP_ROUNDTIME \"9\" // preserved\tannotation\r\nmp_friendlyfire 0")
	p, err := parseGoldSrcCS16Settings(input)
	if err != nil || len(p.fields) != 2 {
		t.Fatal("Partial valid document refused", err)
	}
	next, err := p.patch(map[string]string{"mp_roundtime": "3.5"})
	want := bytes.Replace(input, []byte("\"9\""), []byte("\"3.5\""), 1)
	if err != nil || !bytes.Equal(next, want) {
		t.Fatal("Case, quotes, CRLF or missing final newline changed", err)
	}
	if _, err := p.patch(map[string]string{"mp_timelimit": "20"}); err == nil {
		t.Fatal("Missing row silently inserted")
	}
	// Reparse/reload makes no defaults or schema rows appear. Map-change execution
	// is a separate native runtime test owned by Carrier.
	again, err := parseGoldSrcCS16Settings(next)
	if err != nil || len(again.fields) != 2 {
		t.Fatal("Reload changed the operator-selected field set", err)
	}
}
