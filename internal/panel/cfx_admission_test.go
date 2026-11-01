package panel

import (
	"context"
	"net/http"
	"reflect"
	"sync/atomic"
	"testing"
)

type cfxCountingTransport struct {
	next  http.RoundTripper
	calls atomic.Int64
}

func (c *cfxCountingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.calls.Add(1)
	return c.next.RoundTrip(r)
}
func TestCfxAdmissionBounds(t *testing.T) {
	for _, v := range []string{"0", "33", "48", "1.5", "", "oops"} {
		if validateCfxRecipeEnvironment(fiveMRecipe, M{"TXHOST_GAME_NAME": "redm", "MAX_PLAYERS": v}) == nil {
			t.Fatalf("accepted RedM %q", v)
		}
	}
	for _, v := range []string{"1", "32"} {
		if e := validateCfxRecipeEnvironment(fiveMRecipe, M{"TXHOST_GAME_NAME": "redm", "MAX_PLAYERS": v}); e != nil {
			t.Fatal(e)
		}
	}
	if e := validateCfxRecipeEnvironment(fiveMRecipe, M{"TXHOST_GAME_NAME": "fivem", "MAX_PLAYERS": "48"}); e != nil {
		t.Fatal(e)
	}
	if e := validateCfxRecipeEnvironment("unrelated", M{"TXHOST_GAME_NAME": "redm", "MAX_PLAYERS": "48"}); e != nil {
		t.Fatal(e)
	}
}
func TestCfxAdmissionAPI(t *testing.T) {
	a, _, admin, node, _ := steamGamesFixture(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	a.registerLifecycle(mux)
	a.registerOperations(mux)
	counter := &cfxCountingTransport{next: a.HTTP.Transport}
	if counter.next == nil {
		counter.next = http.DefaultTransport
	}
	a.HTTP.Transport = counter
	var entry gameTemplate
	for _, v := range gameTemplates().Entries {
		if v.Path == fiveMRecipe {
			entry = v
		}
	}
	egg, vars, e := parseEggDocument(entry.Egg)
	if e != nil {
		t.Fatal(e)
	}
	env := M{}
	for _, v := range vars {
		env[str(v["env_variable"])] = v["default_value"]
	}
	env["TXHOST_GAME_NAME"] = "redm"
	env["MAX_PLAYERS"] = "48"
	env["FIVEM_LICENSE"] = "synthetic-license"
	env["STEAM_WEBAPIKEY"] = "synthetic-key"
	image := ""
	for _, v := range asMap(egg["docker_images"]) {
		image = str(v)
		break
	}
	allocs, e := a.query(ctx, "SELECT * FROM allocations ORDER BY id")
	if e != nil {
		t.Fatal(e)
	}
	allocation := allocs[0]["id"]
	snapshot := func() []M {
		rows, err := a.query(ctx, "SELECT jsonb_build_object('servers',(SELECT jsonb_agg(s) FROM servers s),'allocations',(SELECT jsonb_agg(x) FROM allocations x),'variables',(SELECT jsonb_agg(v) FROM server_variables v),'eggs',(SELECT jsonb_agg(g) FROM eggs g),'egg_variables',(SELECT jsonb_agg(ev) FROM egg_variables ev)) AS state")
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	unchanged := func(before []M, calls int64) {
		t.Helper()
		if !reflect.DeepEqual(before, snapshot()) {
			t.Fatal("invalid admission mutated database")
		}
		if counter.calls.Load() != calls {
			t.Fatal("invalid admission called daemon")
		}
	}
	input := M{"name": "Cfx fixture", "request_id": newUUID(), "memory": 2048, "disk": 10240, "image": image, "allocation_id": allocation, "allocation_additional": []any{}, "environment": env}
	before := snapshot()
	calls := counter.calls.Load()
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input, 422)
	unchanged(before, calls)
	imported, e := a.ensureGameTemplateEgg(ctx, entry, egg, vars)
	if e != nil {
		t.Fatal(e)
	}
	direct := M{"name": "Cfx direct", "owner_id": admin, "node_id": node["id"], "egg_id": imported["id"], "allocation_id": allocation, "startup": egg["startup"], "image": image, "memory": 2048, "disk": 10240, "swap": 0, "io": 500, "cpu": 0, "environment": env}
	before = snapshot()
	calls = counter.calls.Load()
	if _, e = a.createServer(ctx, direct); e == nil {
		t.Fatal("invalid direct create accepted")
	}
	unchanged(before, calls)
	// Independent egg rules reproduce the old admission failure.
	if _, e = a.validateEggEnvironment(ctx, num(imported["id"]), env, false); e != nil {
		t.Fatal(e)
	}
	application := M{"name": "Application Cfx", "user": admin, "egg": imported["id"], "docker_image": image, "startup": egg["startup"], "environment": env, "limits": M{"memory": 2048, "disk": 10240, "swap": 0, "io": 500, "cpu": 0}, "feature_limits": M{"databases": 0, "backups": 0}, "allocation": M{"default": allocation, "additional": []any{}}}
	before = snapshot()
	calls = counter.calls.Load()
	infraExpect(t, mux, admin, "POST", "/api/application/servers", application, 422)
	unchanged(before, calls)
	env["MAX_PLAYERS"] = "32"
	s, e := a.createServer(ctx, direct)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"status": nil, "installed_at": now()}); e != nil {
		t.Fatal(e)
	}
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/startup/variable"
	patch := "/api/application/servers/" + str(s["id"]) + "/startup"
	before = snapshot()
	calls = counter.calls.Load()
	infraExpect(t, mux, admin, "PUT", route, M{"key": "MAX_PLAYERS", "value": "48"}, 422)
	unchanged(before, calls)
	before = snapshot()
	calls = counter.calls.Load()
	infraExpect(t, mux, admin, "PATCH", patch, M{"environment": M{"MAX_PLAYERS": "48"}}, 422)
	unchanged(before, calls)
	infraExpect(t, mux, admin, "PATCH", patch, M{"environment": M{"TXHOST_GAME_NAME": "fivem", "MAX_PLAYERS": "48"}}, 200)
	before = snapshot()
	calls = counter.calls.Load()
	infraExpect(t, mux, admin, "PUT", route, M{"key": "TXHOST_GAME_NAME", "value": "redm"}, 422)
	unchanged(before, calls)
	infraExpect(t, mux, admin, "PUT", route, M{"key": "MAX_PLAYERS", "value": "32"}, 200)
	infraExpect(t, mux, admin, "PUT", route, M{"key": "TXHOST_GAME_NAME", "value": "redm"}, 200)
	reader, e := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "cfx-reader", "email": "cfx-reader@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(ctx, "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"startup.read"}}); e != nil {
		t.Fatal(e)
	}
	before = snapshot()
	calls = counter.calls.Load()
	infraExpect(t, mux, num(reader["id"]), "PUT", route, M{"key": "MAX_PLAYERS", "value": "32"}, 403)
	unchanged(before, calls)
	input["allocation_id"] = allocs[1]["id"]
	input["request_id"] = newUUID()
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input, 201)
	env["TXHOST_GAME_NAME"] = "fivem"
	env["MAX_PLAYERS"] = "48"
	application["allocation"] = M{"default": allocs[2]["id"], "additional": []any{}}
	infraExpect(t, mux, admin, "POST", "/api/application/servers", application, 201)
}
