package panel

import (
	"bytes"
	"strconv"
	"strings"
	"testing"
)

func luantiTestFields(t *testing.T, data string) (gameSettingsParsed, map[string]gameSetting) {
	t.Helper()
	parsed, err := parseLuantiSettings([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]gameSetting{}
	for _, field := range parsed.fields {
		fields[field.key] = field
	}
	return parsed, fields
}

func TestLuantiSettingsLiteralSpansAndCRLF(t *testing.T) {
	original := "# untouched\r\n  server_name \t= Native \t\r\nmotd = \"literal \\path # not comment = value\"\r\nunknown_number = 0017\r\nserver_description =   \r\n"
	parsed, fields := luantiTestFields(t, original)
	if fields["motd"].value != `"literal \path # not comment = value"` || fields["unknown_number"].kind != "text" {
		t.Fatalf("literal values or unknown type changed: %#v", fields)
	}
	updated, err := parsed.patch(map[string]string{"server_name": "Changed", "motd": `new # text = "quoted" \literal`, "server_description": "Description"})
	if err != nil {
		t.Fatal(err)
	}
	want := "# untouched\r\n  server_name \t= Changed \t\r\nmotd = new # text = \"quoted\" \\literal\r\nunknown_number = 0017\r\nserver_description =   Description\r\n"
	if string(updated) != want {
		t.Fatalf("unexpected span rewrite:\n%q\nwant:\n%q", updated, want)
	}
	_, roundtrip := luantiTestFields(t, string(updated))
	if roundtrip["motd"].value != `new # text = "quoted" \literal` {
		t.Fatal("literal round trip changed")
	}
}

func TestLuantiSettingsOpaqueBodiesNeverExposeNestedSecrets(t *testing.T) {
	original := "server_name = Top\nopaque = {\n default_password = nested-secret\n nested = {\n  motd = hidden\n }\n text = \"\"\"\n}\nname = fake-admin\n\"\"\"\n}\nmotd = \"\"\"\nsecret_token = multiline-secret\n\"\"\"\nmax_users = 15\n"
	parsed, fields := luantiTestFields(t, original)
	if len(fields) != 4 || fields["opaque"].kind != "readonly" || fields["motd"].kind != "readonly" {
		t.Fatalf("unexpected opaque fields: %#v", fields)
	}
	for _, f := range parsed.fields {
		if strings.Contains(f.value, "nested-secret") || strings.Contains(f.value, "multiline-secret") || f.key == "default_password" || f.key == "name" {
			t.Fatal("opaque body leaked into editor fields")
		}
	}
	updated, err := parsed.patch(map[string]string{"server_name": "New", "max_users": "21"})
	if err != nil || string(updated) != strings.Replace(strings.Replace(original, "server_name = Top", "server_name = New", 1), "max_users = 15", "max_users = 21", 1) {
		t.Fatalf("opaque bytes changed: %v", err)
	}
	for _, key := range []string{"opaque", "motd", "default_password", "name"} {
		if _, err := parsed.patch(map[string]string{key: "changed"}); err == nil {
			t.Fatalf("opaque/nested setting %q became writable", key)
		}
	}
}

func TestLuantiSettingsRawMultilineTerminator(t *testing.T) {
	// CRLF closing quotes are payload in Luanti's LF-only getMultiline.
	original := "motd = \"\"\"\r\nfirst\r\n\"\"\"\r\npassword = still-inside\n\"\"\"\nserver_name = Outside\r\n"
	parsed, fields := luantiTestFields(t, original)
	if len(fields) != 2 || fields["server_name"].value != "Outside" || fields["motd"].kind != "readonly" {
		t.Fatal("raw multiline boundary changed")
	}
	if _, ok := fields["password"]; ok {
		t.Fatal("CRLF closing quotes exposed inner password")
	}
	updated, err := parsed.patch(map[string]string{"server_name": "New"})
	if err != nil || string(updated) != strings.Replace(original, "Outside", "New", 1) {
		t.Fatal("multiline bytes not preserved")
	}
}

func TestLuantiSettingsDuplicateAndCaseSemantics(t *testing.T) {
	original := "server_name = first\nserver_name = second\nServer_Name = Case-sensitive\ncustom = first\ncustom = {\npassword = hidden\n}\n"
	parsed, fields := luantiTestFields(t, original)
	if fields["server_name"].kind != "readonly" || fields["custom"].kind != "readonly" || fields["Server_Name"].kind != "text" {
		t.Fatal("case-sensitive duplicate handling changed")
	}
	if strings.Contains(fields["server_name"].value, "first") || strings.Contains(fields["custom"].value, "hidden") {
		t.Fatal("ambiguous values exposed")
	}
	updated, err := parsed.patch(map[string]string{"Server_Name": "Literal"})
	if err != nil || string(updated) != strings.Replace(original, "Case-sensitive", "Literal", 1) {
		t.Fatal("case-sensitive field patch failed")
	}
	for _, key := range []string{"server_name", "custom"} {
		if _, err := parsed.patch(map[string]string{key: "value"}); err == nil {
			t.Fatal("duplicate became writable")
		}
	}
}

func TestLuantiSettingsRuntimeAndSecretBoundaries(t *testing.T) {
	parsed, fields := luantiTestFields(t, "port = 23560\nbind_address = 0.0.0.0\ndefault_game = minetest\ndefault_password = \"quoted#\\secret\"\ncustom_token = opaque-literal\nPort = unrelated\n")
	for _, key := range []string{"port", "bind_address", "default_game"} {
		if fields[key].kind != "readonly" {
			t.Fatalf("Runtime field %s writable", key)
		}
		if _, err := parsed.patch(map[string]string{key: "new"}); err == nil {
			t.Fatal("Runtime patch accepted")
		}
	}
	if !fields["default_password"].secret || !fields["custom_token"].secret || fields["Port"].kind != "text" {
		t.Fatal("secret or case boundary changed")
	}
	updated, err := parsed.patch(map[string]string{"default_password": `new"#\literal`})
	if err != nil || !strings.Contains(string(updated), "default_password = new\"#\\literal\n") {
		t.Fatal("secret literal quoting/backslashes changed")
	}
}

func TestLuantiSettingsBooleanPairsAndNoNameGuessing(t *testing.T) {
	for _, pair := range [][2]string{{"true", "false"}, {"TRUE", "FALSE"}, {"True", "False"}, {"yes", "no"}, {"YES", "NO"}, {"Yes", "No"}, {"y", "n"}, {"Y", "N"}, {"1", "0"}} {
		t.Run(pair[0], func(t *testing.T) {
			parsed, fields := luantiTestFields(t, "server_announce = "+pair[0]+"\ncreative_mode = "+pair[1]+"\nunknown_enabled = true\n")
			if fields["server_announce"].kind != "boolean" || fields["server_announce"].on != pair[0] || fields["server_announce"].off != pair[1] || fields["unknown_enabled"].kind != "text" {
				t.Fatal("boolean spelling or unknown-key type changed")
			}
			updated, err := parsed.patch(map[string]string{"server_announce": pair[1]})
			if err != nil || !bytes.HasPrefix(updated, []byte("server_announce = "+pair[1]+"\n")) {
				t.Fatal("boolean spelling not retained")
			}
		})
	}
	for _, value := range []string{"on", "off", "2", "true # literal", `"true"`} {
		_, fields := luantiTestFields(t, "server_announce = "+value+"\n")
		if fields["server_announce"].kind != "readonly" {
			t.Fatalf("unreviewed native truth form %q became a misleading switch", value)
		}
	}
}

func TestLuantiSettingsKnownDomainAndInjectionRefusals(t *testing.T) {
	parsed, _ := luantiTestFields(t, "name = Owner\nserver_name = Native\nmax_users = 15\nmotd = Hello\nserver_announce = true\n")
	for key, values := range map[string][]string{
		"name":        {"", "longer-than-twenty-characters", "bad name", `"Owner"`},
		"server_name": {""}, "max_users": {"0", "65536", "1.5", "1e2", "+7", "-1"},
		"motd":            {"line\nnext", "line\rnext", "nul\x00", " leading", "trailing\t", "{", `"""`},
		"server_announce": {"on", "1", "true\nname = injected"},
		"new_key":         {"not inserted"},
	} {
		for _, value := range values {
			if _, err := parsed.patch(map[string]string{key: value}); err == nil {
				t.Errorf("unsafe/invalid %q=%q accepted", key, value)
			}
		}
	}
	for _, value := range []string{"1", "65535", "0015"} {
		if _, err := parsed.patch(map[string]string{"max_users": value}); err != nil {
			t.Fatalf("valid max_users rejected: %v", err)
		}
	}
}

func TestLuantiSettingsLFOnlyUnicodeAndNativeComments(t *testing.T) {
	original := "# comment\nserver_name = Native\u2028Name\nmotd = Hello\u0085# literal\nodd = (key=value,secret=literal)\ninvalid nonassignment\n"
	parsed, fields := luantiTestFields(t, original)
	if len(fields) != 3 || fields["server_name"].value != "Native\u2028Name" || fields["motd"].value != "Hello\u0085# literal" || fields["odd"].structured {
		t.Fatal("Unicode or literal tuple was interpreted as syntax")
	}
	updated, err := parsed.patch(map[string]string{"server_name": "Next\u2029Name", "odd": "{literal#not-group}"})
	if err != nil || !bytes.Contains(updated, []byte("Next\u2029Name")) || !bytes.Contains(updated, []byte("odd = {literal#not-group}\n")) {
		t.Fatal("literal Unicode or braces were rewritten")
	}
}

func TestLuantiSettingsMalformedAndPrivacyLimits(t *testing.T) {
	for _, data := range [][]byte{
		[]byte("group = {\npassword = hidden\n"),
		[]byte("motd = \"\"\"\npassword = hidden\n\"\"\"\r\n"),
		[]byte("name = Owner\x00"), {0xff}, {0xef, 0xbb, 0xbf, 'a', '=', 'b'},
		[]byte(strings.Repeat("x = {\n", 66) + strings.Repeat("}\n", 66)),
	} {
		if _, err := parseLuantiSettings(data); err == nil {
			t.Fatal("malformed/unsupported input accepted")
		}
	}
	parsed, fields := luantiTestFields(t, "invalid name = {\npassword = hidden\n}\nserver_name = Visible\n")
	if len(fields) != 1 || fields["server_name"].value != "Visible" {
		t.Fatal("invalid object name exposed opaque children")
	}
	if updated, err := parsed.patch(nil); err != nil || !bytes.Contains(updated, []byte("password = hidden")) {
		t.Fatal("no-op did not retain opaque source bytes")
	}
}

func TestLuantiSettingsEditorBounds(t *testing.T) {
	var many strings.Builder
	for i := 0; i < 4001; i++ {
		many.WriteString("key" + strconv.Itoa(i) + " = literal\n")
	}
	for _, data := range []string{many.String(), strings.Repeat("#\n", 100001), strings.Repeat(" ", 8*1024*1024+1)} {
		if _, err := parseLuantiSettings([]byte(data)); err == nil {
			t.Fatal("editor bound not enforced")
		}
	}
}

func TestLuantiSettingsNoINISectionsOrInlineComments(t *testing.T) {
	original := "[not a native section]\nserver_name = #literal-not-comment\n# skipped = value\nunknown = \"quoted\" #still-literal\n"
	parsed, fields := luantiTestFields(t, original)
	if len(fields) != 2 || fields["server_name"].value != "#literal-not-comment" || fields["unknown"].value != `"quoted" #still-literal` {
		t.Fatal("INI sections or inline comments were inferred")
	}
	updated, err := parsed.patch(map[string]string{"unknown": "new # still literal"})
	if err != nil || string(updated) != strings.Replace(original, `"quoted" #still-literal`, "new # still literal", 1) {
		t.Fatal("literal section/comment bytes changed")
	}
}
