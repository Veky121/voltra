package panel

import (
	"context"
	"net/url"
	"testing"
)

func TestWave156BrickadiaRefusal(t *testing.T) {
	a, m, u, s, f := wave95Fixture(t)
	ctx := context.Background()
	egg := batchSettingsRecipeFixture(t, "brickadia/egg-brickadia.json")
	egg["java_config"] = M{}
	if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	allocation, e := a.insert(ctx, "allocations", M{"node_id": s["node_id"], "server_id": s["id"], "ip": "127.0.0.1", "port": 29100})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.update(ctx, "servers", num(s["id"]), M{"allocation_id": allocation["id"]}); e != nil {
		t.Fatal(e)
	}
	file := "/.config/Epic/Brickadia/Saved/Config/LinuxServer/GameUserSettings.ini"
	section := "Server__BP_ServerSettings_General_C BP_ServerSettings_General_C"
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(file)
	for _, startup := range []string{str(egg["startup"]), "exec altered-launcher"} {
		if _, e := a.update(ctx, "servers", num(s["id"]), M{"startup": startup}); e != nil {
			t.Fatal(e)
		}
		for _, helper := range []string{"missing", "altered"} {
			delete(f.Files, "/.voltra/brickadia_parity_wave3.py")
			if helper == "altered" {
				f.Files["/.voltra/brickadia_parity_wave3.py"] = []byte("altered")
			}
			f.Files[file] = []byte("[" + section + "]\nServerName=Before\nServerPassword=fixture-password\nbPubliclyListed=False\nUnknownScalar=7\n")
			f.State = "offline"
			before := f.Writes
			infraExpect(t, m, u, "GET", route, nil, 404)
			infraExpect(t, m, u, "PUT", route, M{"revision": "old", "settings": M{section + "/ServerName": "After"}}, 404)
			if f.Writes != before {
				t.Fatal("refused authority wrote")
			}
		}
	}
}
