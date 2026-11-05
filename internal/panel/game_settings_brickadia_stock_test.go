package panel

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestWave165BrickadiaStock(t *testing.T) {
	a, m, u, s, f := wave95Fixture(t)
	ctx := context.Background()
	egg := batchSettingsRecipeFixture(t, "brickadia/egg-brickadia.json")
	egg["java_config"] = M{}
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	alloc, e := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 29100})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"], "allocation_id": alloc["id"]}); e != nil {
		t.Fatal(e)
	}
	entry, _ := gameSettingsProfile(egg)
	for _, value := range asSlice(entry.Egg["variables"]) {
		v := asMap(value)
		row := M{}
		for _, k := range []string{"name", "description", "env_variable", "default_value", "user_viewable", "user_editable", "rules"} {
			row[k] = v[k]
		}
		row["egg_id"] = s["egg_id"]
		ev, e := a.insert(ctx, "egg_variables", row)
		if e != nil {
			t.Fatal(e)
		}
		val := str(v["default_value"])
		if str(v["env_variable"]) == "SERVER_PORT" {
			val = "29100"
		}
		if str(v["env_variable"]) == "SERVER_HOSTING_TOKEN" {
			val = "fixture-private-token"
		}
		if _, e = a.insert(ctx, "server_variables", M{"server_id": s["id"], "variable_id": ev["id"], "variable_value": val}); e != nil {
			t.Fatal(e)
		}
	}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	count := 0
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok || !strings.HasPrefix(name, ".voltra/") {
			continue
		}
		expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
		if !ok {
			t.Fatal("emission")
		}
		f.Files["/"+name] = []byte(expected + "\n")
		count++
	}
	if count != 7 {
		t.Fatal(count)
	}
	raw := "; retained\r\n[" + strings.TrimSuffix(brickadiaSection, "/") + "]\r\nServerName=Before\r\nServerPassword=fixture-private\r\nbPubliclyListed=False\r\nPort=29100\r\nUnknownScalar=9007199254740993\r\n+Array=A\r\n+Array=B\r\n"
	f.Files[brickadiaPath] = []byte(raw)
	f.Files["/unrelated.ini"] = []byte("Name=Other\n")
	f.State = "offline"
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(brickadiaPath)
	fresh, _ := a.one(ctx, "SELECT * FROM servers WHERE id=$1", s["id"])
	cfg, ce := a.serverConfig(ctx, fresh)
	if ce != nil {
		t.Fatal(ce)
	}
	env := asMap(cfg["environment"])
	t.Log("ports", env["SERVER_PORT"], env["VOLTRA_ALLOCATED_PORTS"])
	if e := a.prepareBrickadiaAuthority(ctx, fresh, egg); e != nil {
		t.Fatal("direct authority", e)
	}
	docs, _, de := a.gameSettingsDocuments(ctx, fresh, egg, false, false)
	t.Log("docs", docs, de)
	view := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
	b, _ := json.Marshal(view)
	if strings.Contains(string(b), "fixture-private") {
		t.Fatal("password leaked")
	}
	seen := false
	for _, v := range asSlice(view["fields"]) {
		field := asMap(v)
		if str(field["key"]) == brickadiaSection+"Port" {
			seen = true
			if !boolean(field["readonly"]) {
				t.Fatal("port editable")
			}
		}
	}
	if !seen {
		t.Fatal("port absent")
	}
	// Binding is nonempty and selects the exact native path. Environment and allocation
	// changes keep native bytes unchanged but invalidate the revision.
	if str(egg["_campaign_parser_path"]) != brickadiaPath || str(egg["_campaign_parser_binding"]) == "" {
		t.Fatal("missing active binding")
	}
	binding := str(egg["_campaign_parser_binding"])
	for _, kind := range []string{"environment", "allocation"} {
		t.Run("revision-binding-"+kind, func(t *testing.T) {
			if kind == "environment" {
				_, e = a.DB.Exec(ctx, "UPDATE server_variables SET variable_value='changed-private-token' WHERE server_id=$1 AND variable_id IN (SELECT id FROM egg_variables WHERE env_variable='SERVER_HOSTING_TOKEN')", s["id"])
			} else {
				_, e = a.update(ctx, "allocations", num(alloc["id"]), M{"port": 29101})
			}
			if e != nil {
				t.Fatal(e)
			}
			next := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
			if next["revision"] == view["revision"] {
				t.Fatal("revision omitted authority")
			}
			if kind == "environment" {
				_, e = a.DB.Exec(ctx, "UPDATE server_variables SET variable_value='fixture-private-token' WHERE server_id=$1 AND variable_id IN (SELECT id FROM egg_variables WHERE env_variable='SERVER_HOSTING_TOKEN')", s["id"])
			} else {
				_, e = a.update(ctx, "allocations", num(alloc["id"]), M{"port": 29100})
			}
			if e != nil {
				t.Fatal(e)
			}
		})
	}
	_ = binding
	before := f.Writes
	other := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=/unrelated.ini"
	infraExpect(t, m, u, "GET", other, nil, 404)
	infraExpect(t, m, u, "PUT", other, M{"revision": view["revision"], "settings": M{"Name": "Change"}}, 404)
	infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{brickadiaSection + "Port": "29101"}}, 422)
	if f.Writes != before {
		t.Fatal("denial wrote")
	}
	infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{brickadiaSection + "ServerName": "After"}}, 200)
	if string(f.Files[brickadiaPath]) != strings.Replace(raw, "ServerName=Before", "ServerName=After", 1) {
		t.Fatal("unexpected native byte change")
	}
	infraExpect(t, m, u, "PUT", route, M{"revision": view["revision"], "settings": M{brickadiaSection + "ServerName": "Stale"}}, 409)
	f.State = "running"
	current := asMap(infraExpect(t, m, u, "GET", route, nil, 200)["attributes"])
	infraExpect(t, m, u, "PUT", route, M{"revision": current["revision"], "settings": M{brickadiaSection + "ServerName": "Running"}}, 409)
	f.State = "offline"
	t.Log("stock GET/PUT, exact path, unrelated refusal, port readonly/denial, secret masking and byte preservation passed")
}
