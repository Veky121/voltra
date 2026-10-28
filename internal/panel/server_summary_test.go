package panel

import "testing"

func TestServerSummaryVariableValues(t *testing.T) {
	for _, tc := range []struct{ name, input, want string }{
		{"MINECRAFT_LOADER", "fabric", "fabric"},
		{"MINECRAFT_LOADER", "private-integration-token", "unknown"},
		{"APP_ID", "2394010", "2394010"},
		{"APP_ID", "private-integration-token", ""},
		{"DISCORD_TOKEN", "private-integration-token", ""},
	} {
		got := serverSummaryVariable(M{"env_variable": tc.name, "server_value": tc.input, "server_id": int64(1)})
		if str(got["server_value"]) != tc.want || len(got) != 2 {
			t.Fatalf("unsafe artwork variable %s", tc.name)
		}
	}
}

func TestServerSummaryShapeAndArtworkPermissions(t *testing.T) {
	s := M{"id": int64(1), "owner_id": int64(2), "uuid": "safe-uuid", "uuid_short": "short", "name": "Test", "status": "installing", "summary_node": "Node", "summary_egg": M{"name": "Minecraft", "java_config": M{"enabled": true}}, "minecraft_pack": M{"provider": "modrinth", "project_id": "pack", "name": "Pack"}, "summary_permissions": []any{"startup.read"}}
	vars := []M{{"env_variable": "MINECRAFT_LOADER", "server_value": "fabric"}}
	got := serverSummary(M{"id": int64(3)}, s, vars)
	if !boolean(got["is_installing"]) || str(got["status"]) != "installing" || str(got["node"]) != "Node" {
		t.Fatalf("missing card/lifecycle fields: %v", got)
	}
	if _, ok := asMap(got["artwork"])["server_icon"]; ok {
		t.Fatal("icon exposed without file permission")
	}
	if len(asMap(asMap(got["relationships"])["variables"])["data"].([]M)) != 1 {
		t.Fatal("loader metadata missing")
	}
	for _, key := range []string{"invocation", "sftp_details", "configuration_overrides", "owner_id", "summary_permissions"} {
		if _, ok := got[key]; ok {
			t.Fatalf("unexpected detailed field %s", key)
		}
	}
	s["summary_permissions"] = []any{"file.read-content"}
	got = serverSummary(M{"id": int64(3)}, s, vars)
	if str(asMap(got["artwork"])["server_icon"]) == "" {
		t.Fatal("authorized icon missing")
	}
	if len(asMap(asMap(got["relationships"])["variables"])["data"].([]M)) != 0 {
		t.Fatal("variables exposed without startup permission")
	}
}

func TestServerSummaryAccessPagination(t *testing.T) {
	f := operationsFixtureNew(t)
	for _, tc := range []struct {
		user  M
		query string
		want  int
	}{
		{f.admin, "", 1}, {f.owner, "", 1}, {f.sub, "", 1}, {f.sub, "&type=admin-all", 0}, {f.admin, "&type=owner", 0}, {f.owner, "&page=2&per_page=1", 0}, {f.owner, "&filter[name]=no-such-server", 0},
	} {
		got := operationsExpect(t, f.request("GET", "/api/client?summary=overview"+tc.query, nil, tc.user), 200)
		if len(asSlice(got["data"])) != tc.want {
			t.Fatalf("query %s: %v", tc.query, got)
		}
	}
}
