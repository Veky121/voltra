package panel

import (
	"bytes"
	"context"
	"testing"
)

func TestBattalionUnsupportedNativeFiles(t *testing.T) {
	a, m, u, s, f := wave95Fixture(t)
	m.HandleFunc("GET /api/client/servers/{server}/files/list", a.clientFiles)
	egg := batchSettingsRecipeFixture(t, "battalion_legacy/egg-b-a-t-t-a-l-i-o-n--legacy.json")
	if _, e := a.update(context.Background(), "eggs", num(s["egg_id"]), egg); e != nil {
		t.Fatal(e)
	}
	route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings"
	for _, state := range []string{"offline", "running"} {
		for _, startup := range []string{str(egg["startup"]), "modified helper path"} {
			if _, e := a.update(context.Background(), "servers", num(s["id"]), M{"startup": startup}); e != nil {
				t.Fatal(e)
			}
			f.State = state
			for _, file := range []string{"/server.ini", "/config.ini", "/Battalion/Config/DefaultGame_PrivateServer.ini", "/Battalion/Saved/Config/LinuxServer/Game.ini"} {
				raw := []byte("ServerName=Operator\n")
				f.Files[file] = raw
				w := f.Writes
				infraExpect(t, m, u, "GET", route+"?file="+file, nil, 404)
				infraExpect(t, m, u, "PUT", route+"?file="+file, M{"revision": "stale", "settings": M{"ServerName": "changed"}}, 404)
				if f.Writes != w || !bytes.Equal(f.Files[file], raw) {
					t.Fatal("refusal wrote file")
				}
			}
		}
	}
	reader, e := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "wave148reader", "email": "wave148@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.insert(context.Background(), "subusers", M{"user_id": reader["id"], "server_id": s["id"], "permissions": []string{"file.read-content", "file.read"}}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, m, num(reader["id"]), "PUT", route+"?file=/server.ini", M{"revision": "stale", "settings": M{"ServerName": "changed"}}, 404)
	infraExpect(t, m, u, "GET", "/api/client/servers/"+str(s["uuid_short"])+"/files/list?directory=/", nil, 200)
	if f.Writes != 0 {
		t.Fatal("refusal matrix wrote")
	}
	t.Log("actual GET/PUT refusal, Files list retained, private PostgreSQL/mockWings zero writes")
}
