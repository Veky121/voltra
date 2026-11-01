package panel

import (
	"bytes"
	"strings"
	"testing"
)

const cubicFixture = "\ufeff//retain\r\nGameParams\r\n{\r\n m_server ServerParams\r\n {\r\n serverName \"Native name\" //name note\r\n privateServer FALSE #privacy note\r\n galaxySeed 000123\r\n nativePassword \"opaque-secret-sentinel\"\r\n addons {\r\n  serverName \"nested untouched\"\r\n  unknown [1 2 { text \"brace } and \\\"quote\\\"\" }]\r\n }\r\n }\r\n m_difficulty DifficultySettings\r\n {\r\n  damagePlayerScale 1\r\n  serverName \"not the server namespace\"\r\n }\r\n}\r\n"

func TestCubicSettingsTypedRoundTrip(t *testing.T) {
	p, err := parseCubicSettings([]byte(cubicFixture))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 4 {
		t.Fatalf("wrong fields %#v", p.fields)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "opaque-secret-sentinel") {
			t.Fatal("unknown credential exposed")
		}
		if f.key == "privateServer" && (f.kind != "boolean" || f.on != "TRUE" || f.off != "FALSE") {
			t.Fatal("privacy is not a native boolean")
		}
		if f.key == "galaxySeed" && (f.kind != "number" || f.value != "000123") {
			t.Fatal("seed type/bytes changed")
		}
	}
	changes, err := gameSettingsChanges(p.fields, M{"serverName": "New ;#{} 漢字", "privateServer": true, "galaxySeed": "99999999999"}, M{}, cubicSettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(cubicFixture, `"Native name"`, `"New ;#{} 漢字"`, 1)
	want = strings.Replace(want, "privateServer FALSE", "privateServer TRUE", 1)
	want = strings.Replace(want, "galaxySeed 000123", "galaxySeed 99999999999", 1)
	if string(got) != want {
		t.Fatalf("unrelated bytes changed\n%q", got)
	}
	if _, err = parseCubicSettings(got); err != nil {
		t.Fatal(err)
	}
	unchanged, err := p.patch(map[string]string{"galaxySeed": "000123"})
	if err != nil || !bytes.Equal(unchanged, []byte(cubicFixture)) {
		t.Fatal("unchanged patch rewrote native document")
	}
}

func TestCubicSettingsPatchGuards(t *testing.T) {
	p, err := parseCubicSettings([]byte(cubicFixture))
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"serverName": "escape\"\nprivateServer TRUE"}, {"serverName": "back\\slash"}, {"serverName": "bad\u2028line"}, {"serverName": strings.Repeat("x", 4097)},
		{"privateServer": "true"}, {"privateServer": "1"}, {"galaxySeed": "1e5"}, {"galaxySeed": "-1"}, {"galaxySeed": "100000000000"},
		{"nativePassword": "overwrite"}, {"port": "9999"}, {"addons/serverName": "overwrite"},
	} {
		if _, err := p.patch(changes); err == nil {
			t.Fatalf("unsafe patch accepted %#v", changes)
		}
	}
}

func TestCubicSettingsAmbiguityAndBounds(t *testing.T) {
	rows := "serverName \"Name\"\nprivateServer TRUE\ngalaxySeed 123\n"
	plain := "GameParams\n{\n m_server ServerParams\n {\n" + rows + " }\n}\n"
	for _, data := range []string{
		plain + "serverName \"Duplicate\"\n", strings.Replace(plain, "serverName", "ServerName", 1), plain + "galaxySeed=123\n",
		strings.Replace(plain, "privateServer TRUE", "privateServer true", 1), strings.Replace(plain, "galaxySeed 123", "galaxySeed 1e5", 1),
		strings.Replace(plain, "serverName \"Name\"", "serverName \"bad\\\"name\"", 1),
		"{\n" + plain, "{\n" + plain + "}\ntrailing", plain + "/*unterminated", plain + "broken ]", plain + "\x00", "\xff" + plain,
		"{\n addons {\n" + plain + "}\n}\n", plain + strings.Repeat("unknown row\n", 8001),
		rows, "{\n" + rows + "}\n", strings.Replace(plain, "m_server ServerParams", "m_Server ServerParams", 1), strings.Replace(plain, " }\n}\n", " }\n m_server ServerParams\n {\n }\n}\n", 1),
	} {
		if _, err := parseCubicSettings([]byte(data)); err == nil {
			t.Fatalf("ambiguous/malformed document accepted %q", data[:min(len(data), 140)])
		}
	}
	if _, err := parseCubicSettings(bytes.Repeat([]byte{'x'}, 8*1024*1024+1)); err == nil {
		t.Fatal("oversized document accepted")
	}
	if _, err := parseCubicSettings([]byte("/* serverName \"fake\" */\n" + plain)); err != nil {
		t.Fatal(err)
	}
}

func TestCubicSettingsRecipePathBoundary(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if entry.Path != cubicSettingsRecipe {
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry)}
		if !cubicSettingsDocument(egg, cubicSettingsPath) {
			t.Fatal("valid exact recipe/path rejected")
		}
		for _, file := range []string{"config/server_config.txt", "/other/server_config.txt", "/config/../server_config.txt", "/config/Server_Config.txt"} {
			if cubicSettingsDocument(egg, file) {
				t.Fatalf("unsafe/wrong document accepted %q", file)
			}
		}
		if cubicSettingsDocument(M{"name": "Cubic Odyssey"}, cubicSettingsPath) {
			t.Fatal("display name selected parser")
		}
		return
	}
	t.Fatal("Cubic recipe missing")
}

func TestCubicSettingsCommentPrefixedNamespaceAndRows(t *testing.T) {
	original := strings.Replace(cubicFixture, " serverName", " /* retained prefix */ serverName", 1)
	p, err := parseCubicSettings([]byte(original))
	if err != nil {
		t.Fatal(err)
	}
	out, err := p.patch(map[string]string{"serverName": "Comment-safe"})
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != strings.Replace(original, `"Native name"`, `"Comment-safe"`, 1) {
		t.Fatal("comment or unknown bytes changed")
	}
	for _, bad := range []string{strings.Replace(cubicFixture, " nativePassword", " /* prefix */ serverName \"duplicate\"\r\n nativePassword", 1), strings.Replace(cubicFixture, " m_difficulty", " /* prefix */ m_server ServerParams\r\n {\r\n }\r\n m_difficulty", 1)} {
		if _, err := parseCubicSettings([]byte(bad)); err == nil {
			t.Fatal("comment-prefixed duplicate accepted")
		}
	}
}

const cubicActualPublisherSample = "GameParams\r\n{\r\n\tm_server ServerParams\r\n\t{\r\n\t\tstartingPort 0\r\n\t\tendingPort 0\r\n\t\tserverName \"Cubic Odyssey Dedicated Server\"\r\n\t\tserverPassword \"\"\r\n\t\tmaxPlayers 48\r\n\t\tgalaxySeed 0\r\n\t\tallowRelaying FALSE\r\n\t\tprivateServer FALSE\r\n\t\tenableCrashDumps FALSE\r\n\t\tenableLogging FALSE\r\n\t}\r\n\r\n\tm_difficulty DifficultySettings\r\n\t{\r\n\t\tdamagePlayerScale 1\r\n\t\tdamagePirateScale 1\r\n\t\tdamageCreatureScale 1\r\n\t\tdamageDarknessScale 1\r\n\t\tdamagePlayerShipScale 1\r\n\t\tdamagePirateShipScale 1\r\n\t\tcraftingCostScale 1\r\n\t\ttradingCostScale 1\r\n\t\tdamageGearOnDeath true\r\n\t\tloseQbitsOnDeath true\r\n\t}\r\n}\r\n"

func TestCubicSettingsActualPublisherSample(t *testing.T) {
	p, err := parseCubicSettings([]byte(cubicActualPublisherSample))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 16 {
		t.Fatalf("unexpected exposed fields: %#v", p.fields)
	}
	out, err := p.patch(map[string]string{"serverName": "Operator chosen", "privateServer": "TRUE", "galaxySeed": "00042"})
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(cubicActualPublisherSample, "\"Cubic Odyssey Dedicated Server\"", "\"Operator chosen\"", 1)
	want = strings.Replace(want, "privateServer FALSE", "privateServer TRUE", 1)
	want = strings.Replace(want, "galaxySeed 0", "galaxySeed 00042", 1)
	if string(out) != want {
		t.Fatal("publisher unknown Difficulty/server fields were changed")
	}
	if _, err = parseCubicSettings(out); err != nil {
		t.Fatal(err)
	}
}

func TestCubicSettingsPublisherDifficultyAndServerBooleans(t *testing.T) {
	p, err := parseCubicSettings([]byte(cubicActualPublisherSample))
	if err != nil {
		t.Fatal(err)
	}
	fields := map[string]gameSetting{}
	for _, f := range p.fields {
		fields[f.key] = f
	}
	changes := M{"allowRelaying": true, "enableLogging": true, "enableCrashDumps": true, "difficulty/damageGearOnDeath": false, "difficulty/loseQbitsOnDeath": false}
	want := cubicActualPublisherSample
	for _, key := range []string{"allowRelaying", "enableLogging", "enableCrashDumps"} {
		if fields[key].kind != "boolean" || fields[key].on != "TRUE" {
			t.Fatal("wrong server boolean")
		}
		want = strings.Replace(want, key+" FALSE", key+" TRUE", 1)
	}
	for _, key := range []string{"damageGearOnDeath", "loseQbitsOnDeath"} {
		f := fields["difficulty/"+key]
		if f.kind != "boolean" || f.on != "true" || f.off != "false" {
			t.Fatal("native Difficulty boolean spelling changed")
		}
		want = strings.Replace(want, key+" true", key+" false", 1)
	}
	for key := range cubicDifficultyNumbers {
		if fields["difficulty/"+key].kind != "number" {
			t.Fatal("wrong Difficulty scalar type")
		}
		changes["difficulty/"+key] = "1.25"
		want = strings.Replace(want, key+" 1", key+" 1.25", 1)
	}
	for _, hidden := range []string{"serverPassword", "startingPort", "endingPort", "maxPlayers", "gameMode"} {
		if _, ok := fields[hidden]; ok {
			t.Fatal("CLI-authoritative field exposed")
		}
	}
	patch, err := gameSettingsChanges(p.fields, changes, M{}, cubicSettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	out, err := p.patch(patch)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != want {
		t.Fatal("non-target native bytes changed")
	}
	if _, err = parseCubicSettings(out); err != nil {
		t.Fatal(err)
	}
}

func TestCubicSettingsDifficultyGuardsAndOptionalFields(t *testing.T) {
	p, err := parseCubicSettings([]byte(cubicActualPublisherSample))
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"NaN", "Infinity", "1e309", "+1", "01", ".5", "1\nserverName injected", "true"} {
		if _, err := p.patch(map[string]string{"difficulty/damagePlayerScale": value}); err == nil {
			t.Fatalf("unsafe scalar accepted %q", value)
		}
	}
	for _, value := range []string{"-1.25", "0", "1e-5", "1E+2"} {
		if _, err := p.patch(map[string]string{"difficulty/damagePlayerScale": value}); err != nil {
			t.Fatal("invented engine bound", value, err)
		}
	}
	for _, patch := range []map[string]string{{"difficulty/damageGearOnDeath": "TRUE"}, {"enableLogging": "true"}, {"serverPassword": "overwrite"}, {"difficulty/unknown": "overwrite"}} {
		if _, err := p.patch(patch); err == nil {
			t.Fatal("wrong namespace/type/authority accepted")
		}
	}
	for _, bad := range []string{strings.Replace(cubicActualPublisherSample, "damagePlayerScale 1", "damagePlayerScale 1\n\t\t/*prefix*/ damagePlayerScale 2", 1), strings.Replace(cubicActualPublisherSample, "m_difficulty DifficultySettings", "m_Difficulty DifficultySettings", 1), strings.Replace(cubicActualPublisherSample, "damagePlayerScale", "DamagePlayerScale", 1), strings.Replace(cubicActualPublisherSample, "\tm_difficulty DifficultySettings", "\tm_difficulty DifficultySettings\n\t{\n\t}\n\tm_difficulty DifficultySettings", 1)} {
		if _, err := parseCubicSettings([]byte(bad)); err == nil {
			t.Fatal("ambiguous Difficulty accepted")
		}
	}
	minimal := "GameParams\n{\n m_server ServerParams\n {\n serverName \"Name\"\n privateServer FALSE\n galaxySeed 0\n }\n}\n"
	q, err := parseCubicSettings([]byte(minimal))
	if err != nil || len(q.fields) != 3 {
		t.Fatal("optional absent native fields invented", err)
	}
}
