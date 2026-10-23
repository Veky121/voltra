package panel

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSteamCatalogBridgeRetainsEveryImportedControl(t *testing.T) {
	var catalog templateCatalog
	if err := json.Unmarshal(gameTemplateCatalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range catalog.Entries {
		game := steamCatalogBridgeID(entry.Path)
		if game == "" {
			continue
		}
		count++
		fields := map[string]bool{}
		for _, field := range steamCatalogFields(game) {
			fields[field.Key] = true
		}
		for _, raw := range asSlice(entry.Egg["variables"]) {
			key := str(asMap(raw)["env_variable"])
			if !fields[key] {
				t.Errorf("%s lost original control %s", game, key)
			}
		}
		if len(fields) != len(asSlice(entry.Egg["variables"])) {
			t.Errorf("%s unexpected control count", game)
		}
	}
	if count != 2 {
		t.Fatalf("Mapped %d exact catalog entries, want two", count)
	}
}

func TestSteamCatalogBridgeTypedControls(t *testing.T) {
	configuration, err := steamCatalogParse("satisfactory", M{"MAX_PLAYERS": "12", "NUM_AUTOSAVES": "7", "INIT_CONNECT_TIMEOUT": "45.5", "CONNECT_TIMEOUT": 25, "RELIABLE_PORT": "29000", "VALIDATE": true, "SRCDS_BETAID": "experimental", "SRCDS_BETAPASS": "private-fixture"}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if configuration.Players != 12 || !configuration.Validate || configuration.Branch != "experimental" || str(configuration.Values["INIT_CONNECT_TIMEOUT"]) != "45.5" {
		t.Fatalf("Wrong typed controls: %+v", configuration.Values)
	}
	if configuration.Secrets["SRCDS_BETAPASS"] != "private-fixture" || configuration.Values["SRCDS_BETAPASS"] != "" {
		t.Fatal("Secret was lost or entered plain server variable map")
	}
	encoded, err := json.Marshal(configuration)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private-fixture") {
		t.Fatal("Secret exposed by JSON serialization")
	}
	game, engine := steamCatalogSatisfactoryINI(configuration)
	if game["/Script/Engine.GameSession"]["MaxPlayers"] != "12" || engine["/Script/FactoryGame.FGSaveSession"]["mNumRotatingAutosaves"] != "7" || engine["/Script/OnlineSubsystemUtils.IpNetDriver"]["InitialConnectTimeout"] != "45.5" {
		t.Fatal("Imported INI control mapping differs")
	}
	seven, err := steamCatalogParse("7days", M{"TELNET_PORT": 9081, "PASSWORD": "console-fixture", "SERVER_DISABLED_NETWORK_PROTOCOLS": "SteamNetworking,LiteNetLib", "GAME_DIFFICULTY": "5", "AUTO_UPDATE": "0"}, 8)
	if err != nil {
		t.Fatal(err)
	}
	if seven.Automatic || seven.Secrets["PASSWORD"] != "console-fixture" || seven.Values["PASSWORD"] != "" {
		t.Fatal("Private console/update control mapping differs")
	}
}

func TestSteamCatalogBridgeRejectsInvalidControls(t *testing.T) {
	cases := []struct {
		game  string
		input M
	}{
		{"satisfactory", M{"SRCDS_APPID": "730"}}, {"satisfactory", M{"SRCDS_BETAID": "public +quit"}},
		{"satisfactory", M{"SRCDS_BETAPASS": "unselected-private-branch"}}, {"satisfactory", M{"VALIDATE": "true"}},
		{"satisfactory", M{"MAX_PLAYERS": "1.5"}}, {"satisfactory", M{"MAX_PLAYERS": "2147483648"}},
		{"satisfactory", M{"NUM_AUTOSAVES": "0"}}, {"satisfactory", M{"INIT_CONNECT_TIMEOUT": "NaN"}},
		{"satisfactory", M{"CONNECT_TIMEOUT": "+Inf"}}, {"satisfactory", M{"RELIABLE_PORT": "80"}},
		{"satisfactory", M{"CONNECT_TIMEOUT": "2\n[Injected]"}}, {"7days", M{"GAME_DIFFICULTY": 6}},
		{"7days", M{"TELNET_PORT": "65536"}}, {"7days", M{"SERVER_DISABLED_NETWORK_PROTOCOLS": "SteamNetworking;quit"}},
		{"7days", M{"LD_LIBRARY_PATH": ".\nexec evil"}}, {"7days", M{"UNKNOWN_CONTROL": "x"}},
	}
	for _, test := range cases {
		if _, err := steamCatalogParse(test.game, test.input, 0); err == nil {
			t.Errorf("Accepted invalid %s controls: %v", test.game, test.input)
		}
	}
}

func TestSteamCatalogBridgeManagedDefaults(t *testing.T) {
	satisfactory, err := steamCatalogParse("satisfactory", nil, 4)
	if err != nil {
		t.Fatal(err)
	}
	if satisfactory.Branch != "public" || satisfactory.Validate || !satisfactory.Automatic || satisfactory.Values["RELIABLE_PORT"] != "0" || satisfactory.Players != 4 {
		t.Fatal("Existing managed default behavior changed")
	}
	seven, err := steamCatalogParse("7days", nil, 8)
	if err != nil {
		t.Fatal(err)
	}
	if seven.Values["TELNET_PORT"] != "8081" || seven.Secrets["PASSWORD"] != "" || seven.Values["GAME_DIFFICULTY"] != "2" {
		t.Fatal("Existing private console/default difficulty changed")
	}
}

func TestSteamCatalogBridgeINIPreservesUnknownContent(t *testing.T) {
	original := "; operator comment\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=4\r\nOperatorFuture=kept\r\n[Other]\r\nKeep=42\r\n"
	changes := map[string]map[string]string{"/Script/Engine.GameSession": {"MaxPlayers": "12", "NewControl": "3"}, "NewSection": {"Value": "25.5"}}
	updated, err := steamCatalogPatchINI([]byte(original), changes)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"; operator comment", "MaxPlayers=12", "OperatorFuture=kept", "NewControl=3\n[Other]", "Keep=42", "[NewSection]\nValue=25.5"} {
		if !strings.Contains(string(updated), want) {
			t.Errorf("Lost/misplaced %q: %s", want, updated)
		}
	}
	again, err := steamCatalogPatchINI(updated, changes)
	if err != nil || string(again) != string(updated) {
		t.Fatalf("INI patch not idempotent: %v", err)
	}
}

func TestSteamCatalogBridgeINIRejectsAmbiguityAndInjection(t *testing.T) {
	changes := map[string]map[string]string{"Managed": {"Value": "2"}}
	for _, content := range []string{"[Managed]\nValue=1\nValue=2\n", "[Managed]\nValue=1\n[Managed]\nValue=2\n", "[Managed]\nValue=1\x00"} {
		if _, err := steamCatalogPatchINI([]byte(content), changes); err == nil {
			t.Fatal("Accepted ambiguous/invalid INI")
		}
	}
	if _, err := steamCatalogPatchINI(nil, map[string]map[string]string{"Managed": {"Value": "2\nInjected=1"}}); err == nil {
		t.Fatal("Accepted INI value injection")
	}
}

func TestSteamCatalogBridgePrivateConsoleUsesCredentialFile(t *testing.T) {
	secret := "console-fixture-'$safe"
	launcher, configuration, err := steamCatalogSevenDaysConsole(9081, secret)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(launcher), secret) || strings.Contains(string(launcher), "rcon -p ") {
		t.Fatal("Console credential entered launcher/argv")
	}
	if strings.Count(string(launcher), "/home/container/.voltra/console-client -t telnet -c /home/container/.voltra/sevendays-console.yaml") != 2 || !strings.Contains(string(launcher), "00000000:2379") {
		t.Fatal("Authenticated shutdown or customized readiness port missing")
	}
	if !strings.Contains(string(launcher), "timeout 10 /home/container/.voltra/console-client -t telnet -c /home/container/.voltra/sevendays-console.yaml shutdown") || strings.Contains(string(launcher), "sleep 3") {
		t.Fatal("Shutdown must use the authenticated reviewed client without sleep-based success")
	}
	checksum := strings.Index(string(launcher), "sha256sum -c -")
	chmod := strings.Index(string(launcher), "chmod 700")
	if checksum < 0 || chmod < checksum || !strings.Contains(string(launcher), "chmod 600 /home/container/serverconfig.xml /home/container/.voltra/sevendays-console.yaml") {
		t.Fatal("Private executable/configuration mode changed before checksum verification")
	}
	if !strings.Contains(string(launcher), "wait \"$game_pid\" || game_status=$?\nkill \"$console_pid\"") || !strings.Contains(string(launcher), "exit \"$game_status\"") {
		t.Fatal("Authenticated console must be reaped after native shutdown")
	}
	var decoded map[string]map[string]string
	if err = json.Unmarshal(configuration, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["default"]["password"] != secret || decoded["default"]["log"] != "" || decoded["default"]["address"] != "127.0.0.1:9081" {
		t.Fatal("Wrong private console client configuration")
	}
	defaultLauncher, configuration, err := steamCatalogSevenDaysConsole(8081, "")
	if err != nil || len(configuration) != 0 || string(defaultLauncher) != sevenDaysLauncher {
		t.Fatal("Existing empty-password launcher changed")
	}
}

func TestSteamCatalogBridgeConsolePasswordNativeBoundary(t *testing.T) {
	for _, secret := range []string{"", "+valid internal \"quotes\" \\ λé"} {
		if _, err := steamCatalogParse("7days", M{"PASSWORD": secret}, 8); err != nil {
			t.Fatal("Rejected proven native console password")
		}
	}
	for _, secret := range []string{" leading-fixture", "trailing-fixture ", " "} {
		_, err := steamCatalogParse("7days", M{"PASSWORD": secret}, 8)
		if err == nil || strings.Contains(err.Error(), secret) && secret != " " {
			t.Fatal("Accepted native-unusable console password or exposed its value")
		}
		if _, _, err = steamCatalogSevenDaysConsole(9087, secret); err == nil {
			t.Fatal("Renderer accepted native-unusable console password")
		}
	}
}

func TestSteamCatalogBridgeSecretUTF8Boundary(t *testing.T) {
	for _, secret := range []string{strings.Repeat("x", 1024), strings.Repeat("é", 512)} {
		if _, err := steamCatalogParse("satisfactory", M{"SRCDS_BETAID": "experimental", "SRCDS_BETAPASS": secret}, 4); err != nil {
			t.Fatal("Rejected1024UTF8bytecredential")
		}
	}
	for _, secret := range []string{strings.Repeat("x", 1025), strings.Repeat("é", 512) + "x"} {
		if _, err := steamCatalogParse("satisfactory", M{"SRCDS_BETAID": "experimental", "SRCDS_BETAPASS": secret}, 4); err == nil {
			t.Fatal("Accepted1025UTF8bytecredential")
		}
	}
}

func TestSteamCatalogBridgeReliablePortPreservesOtherStartupArguments(t *testing.T) {
	startup := `./FactoryServer.sh -Port={{SERVER_PORT}} -ReliablePort=8888 -ExternalReliablePort=8888 -unattended -Custom="keep this"`
	updated, err := steamCatalogReliableStartup(startup, 28019)
	if err != nil || updated != strings.ReplaceAll(startup, "=8888", "=28019") {
		t.Fatal("Reliable port update changed unrelated startup arguments")
	}
	for _, invalid := range []string{"./FactoryServer.sh", "-ReliablePort=123bad", "-ReliablePort=8888 -ReliablePort=9000", "-ReliablePort={{CUSTOM_PORT}}"} {
		if _, err := steamCatalogReliableStartup(invalid, 28019); err == nil {
			t.Fatal("Ambiguous or nonnumeric custom startup was silently rewritten")
		}
	}
}

func TestSteamCatalogBridgeAliasesAreExactAndPreserveVerification(t *testing.T) {
	count := 0
	for _, entry := range gameTemplates().Entries {
		summary := templateSummary(entry)
		managed := steamCatalogBridgeID(entry.Path)
		if managed == "" {
			if _, exists := summary["managed_game"]; exists {
				t.Fatal("Unreviewed recipe acquired a managed alias")
			}
			continue
		}
		count++
		if str(summary["managed_game"]) != managed || str(summary["managed_options_url"]) != "/api/client/game-library/steam/"+managed {
			t.Fatal("Managed alias metadata does not select the shared endpoint")
		}
		verification := entry.Verification
		if verification == "" {
			verification = "not_verified"
		}
		if str(summary["verification"]) != verification || str(summary["detail"]) != entry.Detail {
			t.Fatal("Alias incorrectly inherited another runtime result")
		}
	}
	if count != 2 {
		t.Fatal("Expected exactly two reviewed managed aliases")
	}
	for _, path := range []string{"other/egg-satisfactory.json", "satisfactory/egg-other.json", "7_days_to_die/egg-7-days-to-die.json.bak"} {
		if steamCatalogBridgeID(path) != "" {
			t.Fatal("Managed aliases require exact catalog paths")
		}
	}
}
