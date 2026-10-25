package panel

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"voltra/internal/steamapi"
)

func steamRoutingEntry(t *testing.T, path string) gameTemplate {
	t.Helper()
	for _, entry := range gameTemplates().Entries {
		if entry.Path == path {
			return entry
		}
	}
	t.Fatal("missing recipe", path)
	return gameTemplate{}
}
func steamRoutingEnvironment(t *testing.T, entry gameTemplate) M {
	t.Helper()
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	return env
}
func TestGenericSteamDescriptorsAndCandidatePreparation(t *testing.T) {
	banana := steamRoutingEntry(t, "banana_shooter/egg-banana-shooter.json")
	kf2 := steamRoutingEntry(t, "killing_floor_2/egg-killing-floor2.json")
	if templateSteamMetadata(banana)["default_mode"] != "private" || privateTemplateApp(banana) != 2406780 {
		t.Fatal("Banana policy/default changed")
	}
	meta := templateSteamMetadata(kf2)
	if meta["default_mode"] != "public" || boolean(meta["private_supported"]) || str(meta["private_reason"]) == "" || privateTemplateApp(kf2) != 0 {
		t.Fatal("KF2 advertised unreviewed policy")
	}
	if _, ok := steamapi.PrivateProfile(232130); ok {
		t.Fatal("KF2 production policy unexpectedly registered")
	}
	if _, err := privatePreparationEntry(kf2); err == nil {
		t.Fatal("unreviewed candidate enabled")
	}
	d, _ := privateTemplateDescriptorFor(kf2)
	before, _ := json.Marshal(kf2.Egg)
	prepared, err := privatePreparationDescriptor(kf2, d)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(kf2.Egg)
	if string(before) != string(after) {
		t.Fatal("candidate mutated original")
	}
	original := str(asMap(asMap(kf2.Egg["scripts"])["installation"])["script"])
	staged := str(asMap(asMap(prepared.Egg["scripts"])["installation"])["script"])
	prefix := strings.TrimSuffix(strings.TrimRight(original, "\r\n"), "\n"+d.Command)
	if !strings.HasPrefix(staged, prefix) || strings.Contains(strings.TrimPrefix(staged, prefix), d.Command) {
		t.Fatal("candidate preparation lost exact helper prefix")
	}
	if !strings.Contains(staged, "Steam maintenance") {
		t.Fatal("secure workflow missing")
	}
	for _, value := range asSlice(templateSteamControls(kf2)["guard"]) {
		if asMap(value)["rules"] != "nullable|string|max:6" {
			t.Fatal("original KF2Guard rule changed")
		}
	}
}
func TestGenericSteamAliasGuardAndOriginalRules(t *testing.T) {
	for _, key := range []string{"STEAM_USER", "STEAM_PASS", "STEAM_AUTH", "STEAM_USERNAME", "STEAM_PASSWORD", "STEAM_GUARDCODE", "SRCDS_BETAPASS", "steam_pass"} {
		for _, value := range []string{" ", " anonymous ", "do-not-persist +quit \" \n"} {
			if guardTemplateSteamEnvironment(M{key: value}) == nil {
				t.Fatal("ordinary credential accepted", key)
			}
		}
	}
	original := M{"STEAM_USERNAME": "anonymous", "STEAM_PASSWORD": "", "STEAM_GUARDCODE": "", "SRCDS_BETAID": "preview", "PASSWORD": "game-password", "AUTO_UPDATE": "1"}
	safe, err := privatePreparationEnvironment(original)
	if err != nil || safe["STEAM_USERNAME"] != "" || safe["AUTO_UPDATE"] != "0" || safe["SRCDS_BETAID"] != "preview" || safe["PASSWORD"] != "game-password" || original["AUTO_UPDATE"] != "1" {
		t.Fatal("alias sanitization changed game fields/input")
	}
	controls := M{"guard": []any{M{"environment": "STEAM_AUTH", "rules": "nullable|string|max:6"}}}
	for _, value := range []string{"123456", " 12 ", strings.Repeat("\U0001F600", 6)} {
		if validatePrivateOriginal(controls, "guard", value) != nil {
			t.Fatal("valid original literal denied")
		}
	}
	if validatePrivateOriginal(controls, "guard", "1234567") == nil || validatePrivateOriginal(nil, "guard", "1234567") != nil {
		t.Fatal("Guard rule leaked to unrelated recipe")
	}
}
func TestGenericSteamActualHandlerZeroProvisioning(t *testing.T) {
	rt, client, base := privateBrowser(t)
	a, ctx := rt.app, context.Background()
	origin := strings.Split(base, "/api/")[0]
	entry := steamRoutingEntry(t, "killing_floor_2/egg-killing-floor2.json")
	image := ""
	for _, v := range asMap(entry.Egg["docker_images"]) {
		image = str(v)
		break
	}
	counts := func() string {
		row, e := a.one(ctx, "SELECT (SELECT count(*) FROM servers) servers,(SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM nests) nests,(SELECT count(*) FROM server_variables) variables,(SELECT count(*) FROM steam_jobs) jobs")
		if e != nil {
			t.Fatal(e)
		}
		b, _ := json.Marshal(row)
		return string(b)
	}
	before := counts()
	for _, test := range []struct {
		key, value string
		private    bool
		want       int
	}{{"STEAM_USER", "do-not-persist", false, 422}, {"STEAM_PASS", " ", false, 422}, {"STEAM_AUTH", "123456", false, 422}, {"STEAM_USERNAME", "do-not-persist", false, 422}, {"STEAM_PASSWORD", "do-not-persist", false, 422}, {"STEAM_GUARDCODE", "do-not-persist", false, 422}, {"SRCDS_BETAPASS", "do-not-persist", false, 422}, {"STEAM_USER", " anonymous ", false, 422}, {"STEAM_PASS", "do-not-persist", true, 422}, {"", "", true, 409}} {
		env := steamRoutingEnvironment(t, entry)
		if test.key != "" {
			env[test.key] = test.value
		}
		body := M{"request_id": newUUID(), "name": "Routing fixture", "node_id": rt.server["node_id"], "automatic_ports": true, "image": image, "memory": 4096, "disk": 65536, "environment": env, "private_content": test.private}
		status, result, _ := setupHTTP(t, client, "POST", origin+"/api/client/game-library/templates/"+entry.ID+"/install", body, origin)
		if status != test.want {
			t.Fatalf("guard %s status %d want%d", test.key, status, test.want)
		}
		encoded, _ := json.Marshal(result)
		if strings.Contains(string(encoded), "do-not-persist") {
			t.Fatal("private input echoed")
		}
		if counts() != before {
			t.Fatal("rejected request provisioned or persisted rows")
		}
	}
}
func TestGenericSteamPublicDefaultActualProvision(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	entry := steamRoutingEntry(t, "killing_floor_2/egg-killing-floor2.json")
	image := ""
	for _, v := range asMap(entry.Egg["docker_images"]) {
		image = str(v)
		break
	}
	env := steamRoutingEnvironment(t, entry)
	env["ADMIN_PASS"] = "fixture-game-admin" // Required original game administration control, never a Steam credential.
	created := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", M{"request_id": newUUID(), "name": "Anonymous originalcontrols fixture", "node_id": node["id"], "automatic_ports": true, "image": image, "memory": 4096, "disk": 65536, "environment": env}, 201)["attributes"])
	if str(created["identifier"]) == "" || wings.Creates != 1 {
		t.Fatal("public route did not provision")
	}
	server, e := a.one(context.Background(), "SELECT * FROM servers WHERE uuid_short=$1", created["identifier"])
	if e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"AUTO_UPDATE", "STEAM_USER", "STEAM_PASS", "STEAM_AUTH", "MAX_PLAYERS", "ADMIN_PASS", "EXTRA_FLAGS"} {
		if expected, ok := env[key]; ok {
			v, e := a.one(context.Background(), "SELECT sv.variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable=$2", server["id"], key)
			if e != nil || v["variable_value"] != expected {
				t.Fatal("original control/default changed", key)
			}
		}
	}
}

// Exact recipe/rule metadata on an already-approved managed test profile. This
// never registers KF2 or represents a production policy/native/auth proof.
func attachSteamRuleFixture(t *testing.T, rt *steamTestRuntime) {
	t.Helper()
	entry := steamRoutingEntry(t, "banana_shooter/egg-banana-shooter.json")
	var egg M
	b, _ := json.Marshal(entry.Egg)
	json.Unmarshal(b, &egg)
	entry.Egg = egg
	entry.Path = "fixture/private-alias-rules.json"
	entry.ID = "fixture-private-alias-rules"
	entry.SHA256 = newUUID()
	entry.Egg["startup"] = rt.server["startup"]
	entry.Egg["docker_images"] = M{"fixture": rt.server["image"]}
	entry.Egg["variables"] = []any{M{"name": "Original Steam User", "env_variable": "STEAM_USERNAME", "rules": "nullable|string|max:64"}, M{"name": "Original Steam Password", "env_variable": "STEAM_PASSWORD", "rules": "nullable|string|max:64"}, M{"name": "Original Guard", "env_variable": "STEAM_GUARDCODE", "rules": "nullable|string|max:6"}}
	old := len(templates.Entries)
	templates.Entries = append(templates.Entries, entry)
	t.Cleanup(func() { templates.Entries = templates.Entries[:old] })
	if err := rt.app.exec(context.Background(), "UPDATE eggs SET uuid=$2 WHERE id=$1", rt.server["egg_id"], gameTemplateEggUUID(entry)); err != nil {
		t.Fatal(err)
	}
}
func TestGenericSteamSecureOriginalRulesAndCustody(t *testing.T) {
	rt, client, base := privateBrowser(t)
	attachSteamRuleFixture(t, rt)
	a, ctx := rt.app, context.Background()
	origin := strings.Split(base, "/api/")[0]
	username := "  original +quit \" \u03bb  "
	password := "  literal secret \" \\ \u03bb\n  "
	status, _, _ := setupHTTP(t, client, "POST", base+"/authorizations", M{"username": strings.Repeat("x", 65), "save_password": false}, origin)
	if status != 422 {
		t.Fatal("original username limit not enforced", status)
	}
	status, result, _ := setupHTTP(t, client, "POST", base+"/authorizations", M{"username": username, "password": password, "save_password": true}, origin)
	if status != 201 {
		t.Fatal("secure literal authorization failed", status)
	}
	id := asMap(result["attributes"])["id"]
	row, e := a.one(ctx, "SELECT * FROM steam_private_authorizations WHERE id=$1", id)
	if e != nil {
		t.Fatal(e)
	}
	opened, e := a.openPrivate(str(row["credential_cipher"]), privateEnvelope{Purpose: "profile", Server: str(rt.server["uuid"]), Actor: rt.user, Authorization: str(id), Generation: str(row["generation"])})
	if e != nil || opened.Username != username || opened.Password != password {
		t.Fatal("encrypted custody altered original literal")
	}
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": id, "operation": "install", "password": strings.Repeat("x", 65)}, origin)
	if status != 422 {
		t.Fatal("original job password max not enforced", status)
	}
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": id, "operation": "install"}, origin)
	if status != 202 {
		t.Fatal("secure original route not queued", status)
	}
	public, e := a.one(ctx, "SELECT request FROM steam_private_jobs")
	if e != nil {
		t.Fatal(e)
	}
	encoded, _ := json.Marshal(public)
	if strings.Contains(string(encoded), username) || strings.Contains(string(encoded), password) {
		t.Fatal("credential persisted in public request")
	}
}
func TestGenericSteamGuardOriginalRuleBeforeClaim(t *testing.T) {
	rt, client, base, job, _ := privateRunningFixture(t)
	attachSteamRuleFixture(t, rt)
	a, ctx := rt.app, context.Background()
	origin := strings.Split(base, "/api/")[0]
	row, e := a.privateJobRow(ctx, str(job["id"]))
	if e != nil {
		t.Fatal(e)
	}
	g := &privateGuardState{actor: rt.user, authKind: str(row["actor_auth_kind"]), authID: str(row["actor_auth_id"]), ctx: ctx, expires: time.Now().Add(20 * time.Second), challenge: steamapi.PrivateChallenge{Job: str(job["id"]), ChallengeID: strings.Repeat("c", 32), Kind: "device_code"}}
	a.privateHub().mu.Lock()
	a.privateHub().guards[str(job["id"])] = g
	a.privateHub().mu.Unlock()
	status, _, _ := setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": g.challenge.ChallengeID, "kind": "device_code", "code": "1234567"}, origin)
	if status != 422 || g.claimed {
		t.Fatal("oversized original code claimed challenge", status)
	}
	// An invalid code remains transient and leaves the same live challenge usable.
	status, result, _ := setupHTTP(t, client, "GET", base+"/jobs/"+str(job["id"]), nil, origin)
	if status != 200 || len(asSlice(asMap(asMap(result["attributes"])["guard"])["code_controls"])) != 1 {
		t.Fatal("original Guard metadata missing", status)
	}

	// Real browser HTTP -> guarded handler -> private HTTP stream composition.
	// The injected local broker carries synthetic code only, no Steam connection.
	delivered := make(chan string, 1)
	a.privateHub().dial = func(_ context.Context, _ int64, grant steamapi.PrivateStreamGrant) (net.Conn, error) {
		left, right := net.Pipe()
		go func() {
			defer right.Close()
			request, err := http.ReadRequest(bufio.NewReader(right))
			if err != nil {
				delivered <- "read-failed"
				return
			}
			var reply steamapi.PrivateReply
			if json.NewDecoder(request.Body).Decode(&reply) != nil || reply.Code == nil {
				delivered <- "decode-failed"
				return
			}
			delivered <- *reply.Code
			right.Write([]byte("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"))
		}()
		return left, nil
	}
	code := " 1+2 "
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": g.challenge.ChallengeID, "kind": "device_code", "code": code}, origin)
	if status != 204 || !g.claimed {
		t.Fatal("valid original code not delivered", status)
	}
	select {
	case got := <-delivered:
		if got != code {
			t.Fatal("Guard literal altered")
		}
	case <-time.After(time.Second):
		t.Fatal("Guard delivery missing")
	}
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/guard", M{"challenge_id": g.challenge.ChallengeID, "kind": "device_code", "code": code}, origin)
	if status != 409 {
		t.Fatal("duplicate original reply accepted", status)
	}
}

func TestGenericSteamHoldfastLegacyPrivateCarrier(t *testing.T) {
	entry := steamRoutingEntry(t, "holdfast/egg-holdfast-na-w.json")
	for _, value := range []string{"", " ", "-beta public", "\"-beta\" 'pre'view", "-beta 'name-betapassword'"} {
		if guardTemplateSteamEnvironment(M{"EXTRA_FLAGS": value}, entry) != nil {
			t.Fatal("public original branch expansion changed")
		}
	}
	for _, value := range []string{"-beta preview -betapassword do-not-persist", "'-beta' 'pre view' '-betapassword' 'opaque do-not-persist'", "-beta public -betapass'word' do-not-persist", "-beta preview -betapassword 'unterminated do-not-persist' ", "-beta preview -unknown do-not-persist"} {
		if err := guardTemplateSteamEnvironment(M{"EXTRA_FLAGS": value}, entry); err == nil || strings.Contains(err.Error(), "do-not-persist") {
			t.Fatal("private legacy carrier accepted or echoed")
		}
	}
	if guardTemplateSteamEnvironment(M{"EXTRA_FLAGS": "-beta preview -betapassword native-flag"}, steamRoutingEntry(t, "killing_floor_2/egg-killing-floor2.json")) != nil {
		t.Fatal("unrelated native EXTRA_FLAGS reclassified")
	}
	if guardTemplateSteamEnvironment(M{"INSTALL_FLAGS": " +login do-not-persist"}) == nil {
		t.Fatal("unsupported raw installer flag persisted")
	}
}
func TestGenericSteamHoldfastActualHandlerZeroProvisioning(t *testing.T) {
	rt, client, base := privateBrowser(t)
	a, ctx := rt.app, context.Background()
	origin := strings.Split(base, "/api/")[0]
	entry := steamRoutingEntry(t, "holdfast/egg-holdfast-na-w.json")
	image := ""
	for _, v := range asMap(entry.Egg["docker_images"]) {
		image = str(v)
		break
	}
	before, e := a.one(ctx, "SELECT (SELECT count(*) FROM servers) servers,(SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM server_variables) variables")
	if e != nil {
		t.Fatal(e)
	}
	for _, value := range []string{"-beta preview -betapassword do-not-persist", "'-beta' 'public' '-betapassword' 'literal secret do-not-persist'"} {
		env := steamRoutingEnvironment(t, entry)
		env["EXTRA_FLAGS"] = value
		status, result, _ := setupHTTP(t, client, "POST", origin+"/api/client/game-library/templates/"+entry.ID+"/install", M{"request_id": newUUID(), "name": "Holdfastguardfixture", "automatic_ports": true, "node_id": rt.server["node_id"], "image": image, "memory": 4096, "disk": 65536, "environment": env}, origin)
		if status != 422 {
			t.Fatal("legacy guard status", status)
		}
		body, _ := json.Marshal(result)
		if strings.Contains(string(body), "do-not-persist") {
			t.Fatal("private flags echoed")
		}
	}
	after, e := a.one(ctx, "SELECT (SELECT count(*) FROM servers) servers,(SELECT count(*) FROM allocations) allocations,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM server_variables) variables")
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(before)
	c, _ := json.Marshal(after)
	if string(b) != string(c) {
		t.Fatal("private legacy input changed provisioning rows")
	}
}
