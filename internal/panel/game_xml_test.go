package panel

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"voltra/internal/steamapi"
)

func TestSteamGameSpecificNodeCapabilities(t *testing.T) {
	a := &App{}
	hub := a.connectors()
	capabilities := map[string]bool{steamapi.Capability: true}
	hub.controls[1] = &connectorControl{capabilities: capabilities}
	ctx := context.Background()
	if !a.steamNodeAvailable(ctx, 1, 2394010) || a.steamNodeAvailable(ctx, 1, 294420) {
		t.Fatal("legacy agents offered a new game or lost original support")
	}
	capabilities[steamapi.ProfileCapability] = true
	if a.steamNodeAvailable(ctx, 1, 2394010) {
		t.Fatal("explicit game profiles ignored")
	}
	capabilities[steamapi.AppCapability(294420)] = true
	if !a.steamNodeAvailable(ctx, 1, 294420) || a.steamNodeAvailable(ctx, 1, 1) {
		t.Fatal("game-specific capability failed")
	}
	for _, spec := range steamGameSpecs {
		if profile, ok := steamapi.Profile(spec.AppID); !ok || len(profile.ProtectedPaths) == 0 {
			t.Fatalf("%s lacks a node preservation policy", spec.ID)
		}
	}
}

func TestSteamOptionsExplainMissingPortsAndCapacity(t *testing.T) {
	a, mux, admin, node, _ := steamGamesFixture(t)
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/7days", nil, 200)["attributes"])
	nodes := asSlice(options["nodes"])
	if len(nodes) != 1 {
		t.Fatal("fixture node missing")
	}
	first := asMap(nodes[0])
	if !boolean(first["setup_available"]) || !boolean(first["automatic_ports"]) || str(first["unavailable_reason"]) != "" {
		t.Fatal("automatic setup still requires a preassigned consecutive pool", first)
	}
	before, err := a.one(context.Background(), "SELECT count(*) n FROM allocations WHERE node_id=$1", node["id"])
	if err != nil {
		t.Fatal(err)
	}
	preview := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/7days/ports", M{"node_id": node["id"]}, 200)["attributes"])
	ports := asSlice(preview["ports"])
	if len(ports) != 4 {
		t.Fatal("7 Days preview must include all four required ports", preview)
	}
	for offset, raw := range ports {
		if num(asMap(raw)["port"]) != 26900+int64(offset) {
			t.Fatal("automatic preview lost preferred consecutive ports", preview)
		}
	}
	after, err := a.one(context.Background(), "SELECT count(*) n FROM allocations WHERE node_id=$1", node["id"])
	if err != nil || num(before["n"]) != num(after["n"]) {
		t.Fatal("options/preview created allocations", err)
	}
	if _, err := a.DB.Exec(context.Background(), "UPDATE nodes SET memory=4096 WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	options = asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/7days", nil, 200)["attributes"])
	first = asMap(asSlice(options["nodes"])[0])
	if num(first["available_memory"]) != 4096 || !strings.Contains(str(first["unavailable_reason"]), "memory") {
		t.Fatal("memory availability missing")
	}
}

func TestSteamSetupCountsAlreadyAllocatedMemoryAndDisk(t *testing.T) {
	a, mux, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	first := steamGamesInput("valheim", node)
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/valheim/install", first, 201)
	if _, err := a.DB.Exec(ctx, "UPDATE nodes SET memory=6144 WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/valheim", nil, 200)["attributes"])
	available := asMap(asSlice(options["nodes"])[0])
	if num(available["available_memory"]) != 2048 {
		t.Fatalf("allocated RAM not subtracted: %v", available)
	}
	second := steamGamesInput("valheim", node)
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/valheim/install", second, 422)
	if wings.Creates != 1 {
		t.Fatal("memory over-allocation reached Wings")
	}
	second["memory"] = 2048
	second["request_id"] = newUUID()
	if _, err := a.DB.Exec(ctx, "UPDATE nodes SET disk=12288 WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/valheim/install", second, 422)
	if wings.Creates != 1 {
		t.Fatal("disk over-allocation reached Wings")
	}
	if _, err := a.DB.Exec(ctx, "UPDATE nodes SET disk=16384 WHERE id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/valheim/install", second, 201)
	if wings.Creates != 2 {
		t.Fatal("setup rejected the exact remaining capacity")
	}
}

func TestQuickXMLPropertiesPreserveFormattingAndUnknownSettings(t *testing.T) {
	original := []byte("<?xml version='1.0'?>\r\n<ServerSettings>\r\n <!-- operator note -->\r\n <property value = 'Old &amp; Name' extra=\"kept\" name='ServerName' />\r\n <property name=\"CustomFuture\" value=\"42\"/>\r\n</ServerSettings>\r\n")
	noChange, err := quickPatchXMLProperties(original, "ServerSettings", map[string]string{})
	if err != nil || !bytes.Equal(original, noChange) {
		t.Fatal("unchanged XML was reformatted")
	}
	name := `Quotes " ' < & > and value="not-an-attribute"`
	updated, err := quickPatchXMLProperties(original, "ServerSettings", map[string]string{"ServerName": name, "ServerPassword": `"/><property name="Injected" value="yes`})
	if err != nil {
		t.Fatal(err)
	}
	records, _, err := quickXMLProperties(updated, "ServerSettings")
	if err != nil {
		t.Fatal(err)
	}
	if records["ServerName"].Value != name || records["CustomFuture"].Value != "42" || len(records) != 3 {
		t.Fatal("XML values or unknown settings changed")
	}
	if !bytes.Contains(updated, []byte("<!-- operator note -->")) || !bytes.Contains(updated, []byte(`extra="kept"`)) {
		t.Fatal("comments or attributes lost")
	}
	withBOM := append([]byte{0xef, 0xbb, 0xbf}, original...)
	bomUpdated, err := quickPatchXMLProperties(withBOM, "ServerSettings", map[string]string{"ServerName": "Windows edited file"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(bomUpdated, []byte{0xef, 0xbb, 0xbf}) {
		t.Fatal("UTF-8 BOM lost")
	}
	bomValues, _, err := quickXMLProperties(bomUpdated, "ServerSettings")
	if err != nil || bomValues["ServerName"].Value != "Windows edited file" {
		t.Fatal("BOM shifted edit offsets")
	}
	for _, content := range []string{`<Wrong></Wrong>`, `<ServerSettings/>`, `<ServerSettings><property name="A" value="1"/><property name="A" value="2"/></ServerSettings>`, `<ServerSettings><property name="A" value="1" value="2"/></ServerSettings>`, `<!DOCTYPE ServerSettings [<!ENTITY unsafe "expanded">]><ServerSettings></ServerSettings>`, `<ServerSettings><property name="A"/></ServerSettings>`} {
		if _, _, err = quickXMLProperties([]byte(content), "ServerSettings"); err == nil {
			t.Errorf("accepted invalid XML: %s", content)
		}
	}
}

func TestSteamConsecutivePortsAreIndependentOfAllocationCreationOrder(t *testing.T) {
	ports := []M{{"id": 1, "ip": "127.0.0.1", "port": 23562}, {"id": 2, "ip": "127.0.0.2", "port": 23561}, {"id": 3, "ip": "127.0.0.1", "port": 23563}, {"id": 4, "ip": "127.0.0.1", "port": 23560}, {"id": 5, "ip": "127.0.0.1", "port": 23561}}
	chosen, err := steamChooseAllocations(ports, 4, true)
	if err != nil {
		t.Fatal(err)
	}
	for i, allocation := range chosen {
		if str(allocation["ip"]) != "127.0.0.1" || num(allocation["port"]) != 23560+int64(i) {
			t.Fatal("incorrect consecutive block")
		}
	}
	if _, err = steamChooseAllocations(ports, 5, true); err == nil {
		t.Fatal("accepted a gap")
	}
	if _, err = steamChooseAllocations(ports, 0, true); err == nil {
		t.Fatal("accepted no game port")
	}
}

func TestSevenDaysInitializationAndNativeSettings(t *testing.T) {
	a, mux, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	for _, port := range []int{23562, 23560, 23563, 23561} {
		if _, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": port}); err != nil {
			t.Fatal(err)
		}
	}
	input := steamGamesInput("7days", node)
	input["server_password"] = `secret<&"`
	result := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/7days/install", input, 201)["attributes"])
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", result["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	primary, err := a.one(ctx, "SELECT ip,port FROM allocations WHERE id=$1 AND server_id=$2", server["allocation_id"], server["id"])
	if err != nil || num(primary["port"]) != 26900 {
		t.Fatal("automatic install did not choose the preferred game port", primary, err)
	}
	assigned, err := a.query(ctx, "SELECT ip,port FROM allocations WHERE server_id=$1 ORDER BY port", server["id"])
	if err != nil || len(assigned) != 4 {
		t.Fatal("7 Days install did not assign all required ports", assigned, err)
	}
	for offset, allocation := range assigned {
		if str(allocation["ip"]) != str(primary["ip"]) || num(allocation["port"]) != num(primary["port"])+int64(offset) {
			t.Fatal("required companion offsets were not preserved", assigned)
		}
	}
	wings.Files[sevenDaysSettingsPath] = []byte(`<ServerSettings><!-- keep --><property name="ServerName" value="Default"/><property name="CustomFuture" value="kept"/><property name="GameDifficulty" value="2"/></ServerSettings>`)
	if err = a.steamGameAfterInstall(ctx, server); err != nil {
		t.Fatal(err)
	}
	values, _, err := quickXMLProperties(wings.Files[sevenDaysSettingsPath], "ServerSettings")
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"ServerPassword": `secret<&"`, "ServerPort": str(primary["port"]), "TelnetPort": "8081", "TelnetPassword": "", "ServerVisibility": "0", "CustomFuture": "kept"} {
		if values[key].Value != want {
			t.Errorf("%s=%q want %q", key, values[key].Value, want)
		}
	}
	if !strings.Contains(string(wings.Files["/.voltra/sevendays-start.sh"]), "wait \"$game_pid\"") {
		t.Fatal("launcher does not wait for game save")
	}
	custom := []byte(`<ServerSettings><property name="ServerName" value="Operator edit"/></ServerSettings>`)
	wings.Files[sevenDaysSettingsPath] = custom
	if err = a.steamGameAfterInstall(ctx, server); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(wings.Files[sevenDaysSettingsPath], custom) {
		t.Fatal("initialization overwrote operator edits")
	}
	for _, settings := range []M{{"GameDifficulty": "9"}, {"ServerMaxPlayerCount": 1.5}, {"TelnetEnabled": false}, {"ServerName": "bad\nname"}} {
		if _, err = quickValidateSettings("7days", settings); err == nil {
			t.Errorf("accepted invalid settings %v", settings)
		}
	}
	egg, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", server["egg_id"])
	if err != nil {
		t.Fatal(err)
	}
	if str(egg["config_stop"]) != "shutdown" {
		t.Fatal("game stop does not use console shutdown")
	}
}
