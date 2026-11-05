package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestFoFNativeValueAndPreservation(t *testing.T) {
	data := []byte("// native app295230 historical value\r\nhostname \"operator\"\r\nmp_timelimit \"17\" // keep\r\nrcon_password secret\r\nopaque_operator 123\r\n")
	p, err := parseFoFSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	same, err := p.patch(nil)
	if err != nil || !bytes.Equal(same, data) {
		t.Fatal("no-op changed bytes")
	}
	// Unknown statements remain intact, but the closed parser refuses to assume
	// that executable unknown commands leave the cvar namespace unchanged.
	if _, err = p.patch(map[string]string{"mp_timelimit": "18"}); err == nil {
		t.Fatal("opaque executable document writable")
	}
	data = []byte("// operator\r\nhostname stock\r\nmp_timelimit \"17\" // keep\r\nrcon_password secret\r\n")
	p, err = parseFoFSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.patch(map[string]string{"mp_timelimit": "18"})
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != strings.Replace(string(data), "\"17\"", "\"18\"", 1) {
		t.Fatal("changed bytes outside value span")
	}
	for _, key := range []string{"hostname", "sv_password", "rcon_password", "port", "tv_port", "unknown"} {
		if _, err = p.patch(map[string]string{key: "1"}); err == nil {
			t.Fatalf("accepted %s", key)
		}
	}
}

func TestFoFNumericDomain(t *testing.T) {
	for _, v := range []string{"0", "17", "20", "1.5", "+17"} {
		if !fofSettingValue("mp_timelimit", v) {
			t.Fatalf("rejected %q", v)
		}
	}
	for _, v := range []string{"-1", "20.0000000001", "23", "NaN", "Inf", "1e1", "17;quit", "17\nquit", "0.000000000000000000000000000000001"} {
		if fofSettingValue("mp_timelimit", v) {
			t.Fatalf("accepted %q", v)
		}
	}
	if fofSettingValue("hostname", "17") {
		t.Fatal("expanded schema")
	}
}

func TestFoFUnsafeDocuments(t *testing.T) {
	for _, extra := range []string{"mp_timelimit 18", "MP_TIMELIMIT nope", "exec other.cfg", "alias mp_timelimit quit", "unknown;quit", "/* block", "foo \\", "foo \"unterminated"} {
		data := []byte("mp_timelimit 17\n" + extra + "\n")
		p, err := parseFoFSettings(data)
		if err != nil {
			continue
		}
		if _, err = p.patch(map[string]string{"mp_timelimit": "18"}); err == nil {
			t.Fatalf("accepted %q", extra)
		}
		same, err := p.patch(nil)
		if err != nil || !bytes.Equal(same, data) {
			t.Fatal("opaque bytes changed")
		}
	}
	for _, data := range [][]byte{{0xff}, append([]byte{0xef, 0xbb, 0xbf}, []byte("mp_timelimit 17")...), []byte("mp_timelimit 17\rhostname stock"), []byte("mp_timelimit 17\u2028")} {
		if _, err := parseFoFSettings(data); err == nil {
			t.Fatal("invalid encoding accepted")
		}
	}
}

func TestFoFCanonicalHelperPinsAndScope(t *testing.T) {
	files := wave46CanonicalHelpers(t, fofSettingsRecipe)
	if !fofSourceHelpers(files) {
		t.Fatal("canonical helper pins disagree")
	}
	for name, body := range files {
		delete(files, name)
		if fofSourceHelpers(files) {
			t.Fatalf("missing helper %s accepted", name)
		}
		files[name] = append(bytes.Clone(body), ' ')
		if fofSourceHelpers(files) {
			t.Fatalf("modified helper %s accepted", name)
		}
		files[name] = body
	}
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == fofSettingsRecipe {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": fofSettingsStartup}
			if len(entry.SettingsDocuments) != 1 || entry.SettingsDocuments[0] != "fof/cfg/server.cfg" {
				t.Fatal("document declaration")
			}
		}
	}
	if egg == nil || campaignParserRecipe(egg) != fofSettingsRecipe {
		t.Fatal("FoF not registered")
	}
	for _, key := range []string{"hostname", "sv_password", "rcon_password", "port", "tv_port"} {
		if !gameSettingsRecipeManaged(egg, fofSettingsPath, key) {
			t.Fatal("managed field writable")
		}
	}
	if gameSettingsRecipeManaged(egg, fofSettingsPath, "mp_timelimit") {
		t.Fatal("gameplay managed")
	}
	egg["_campaign_parser_path"] = fofSettingsPath
	if !campaignParserPathAllowed(egg, fofSettingsPath) || campaignParserPathAllowed(egg, "/fof/cfg/voltra-managed.cfg") {
		t.Fatal("path scope widened")
	}
}

func TestFoFImportedStartupFallbackRemainsStrict(t *testing.T) {
	egg := M{"uuid": "imported-unrelated-uuid", "startup": fofSettingsStartup}
	if campaignParserRecipe(egg) != fofSettingsRecipe {
		t.Fatal("exact imported startup lost")
	}
	for _, startup := range []string{"", fofSettingsStartup + " ", strings.Replace(fofSettingsStartup, "295230", "317670", 1)} {
		candidate := M{"uuid": "imported-unrelated-uuid", "startup": startup}
		if campaignParserRecipe(candidate) == fofSettingsRecipe {
			t.Fatal("loose imported startup accepted")
		}
	}
	field := M{"key": "mp_timelimit", "type": "number"}
	fofSettingPresentation(egg, fofSettingsPath, field)
	if field["min"] != 0 || field["max"] != 20 {
		t.Fatal("numeric bounds absent")
	}
	other := M{"key": "mp_timelimit", "type": "number"}
	fofSettingPresentation(egg, "/fof/cfg/voltra-managed.cfg", other)
	if other["max"] != nil {
		t.Fatal("managed document presented")
	}
}

func TestFoFPrimaryPortInjectedByWings(t *testing.T) {
	for _, value := range []string{"", "29178"} {
		if !fofPrimaryPortMatches(map[string]string{"SERVER_PORT": value}, "29178") {
			t.Fatal("valid panel environment rejected")
		}
	}
	if fofPrimaryPortMatches(map[string]string{"SERVER_PORT": "29179"}, "29178") {
		t.Fatal("conflicting explicit port admitted")
	}
}

func TestFoFPublisherBanIncludes(t *testing.T) {
	data := []byte("mp_timelimit 15\nsv_Maxrate 30000\nlog on\nexec banned_user.cfg\nexec banned_ip.cfg\nwriteip\nwriteid\n")
	p, err := parseFoFSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	edited, err := p.patch(map[string]string{"mp_timelimit": "17"})
	if err != nil || string(edited) != strings.Replace(string(data), "15", "17", 1) {
		t.Fatal("publisher config edit failed", err)
	}
	if !fofBanDataSafe([]byte("banid 0 STEAM_0:1:1234\n"), false) || !fofBanDataSafe([]byte("addip 0 192.0.2.1\n"), true) {
		t.Fatal("ban data refused")
	}
	for _, badData := range []string{"mp_timelimit 1", "exec other.cfg", "banid 0 STEAM_0:1:1234;quit", "alias mp_timelimit quit"} {
		if fofBanDataSafe([]byte(badData), false) {
			t.Fatal("executable nested config accepted")
		}
	}
}
