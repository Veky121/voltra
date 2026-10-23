package panel

import (
	"context"
	"sync"
	"testing"
)

func TestServerNavigationUserIsolationAndRevokedAccess(t *testing.T) {
	a, mux, admin, server, _ := quickSetupMinecraftFixture(t)
	a.registerServerNavigation(mux)
	ctx := context.Background()
	member, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "navigation_member", "email": "nav@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	memberID := num(member["id"])
	if _, err = a.insert(ctx, "subusers", M{"user_id": memberID, "server_id": server["id"], "permissions": []any{}}); err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/client/servers/" + str(server["uuid"]) + "/navigation"
	list := "/api/client/account/server-navigation"
	infraExpect(t, mux, admin, "PUT", endpoint, M{"favorite": true}, 200)
	infraExpect(t, mux, memberID, "POST", endpoint, nil, 204)
	adminRows := asSlice(infraExpect(t, mux, admin, "GET", list, nil, 200)["data"])
	memberRows := asSlice(infraExpect(t, mux, memberID, "GET", list, nil, 200)["data"])
	if len(adminRows) != 1 || len(memberRows) != 1 {
		t.Fatal("missing accessible server")
	}
	adminPref := asMap(asMap(adminRows[0])["attributes"])
	memberPref := asMap(asMap(memberRows[0])["attributes"])
	if str(adminPref["identifier"]) != str(server["uuid_short"]) {
		t.Fatal("navigation does not use the client server identifier")
	}
	if !boolean(adminPref["favorite"]) || adminPref["last_visited_at"] != nil || boolean(memberPref["favorite"]) || memberPref["last_visited_at"] == nil {
		t.Fatal("preferences leaked between users")
	}
	infraExpect(t, mux, memberID, "PUT", endpoint, M{"favorite": "true"}, 422)
	infraExpect(t, mux, memberID, "PUT", endpoint, M{"favorite": true, "user_id": admin}, 422)
	if err = a.exec(ctx, "DELETE FROM subusers WHERE user_id=$1", memberID); err != nil {
		t.Fatal(err)
	}
	if len(asSlice(infraExpect(t, mux, memberID, "GET", list, nil, 200)["data"])) != 0 {
		t.Fatal("revoked server exposed in navigation")
	}
	infraExpect(t, mux, memberID, "PUT", endpoint, M{"favorite": true}, 404)
	infraExpect(t, mux, memberID, "POST", endpoint, nil, 404)
}

func TestServerNavigationConcurrentVisitFavoriteDuringInstall(t *testing.T) {
	a, mux, admin, server, _ := quickSetupMinecraftFixture(t)
	a.registerServerNavigation(mux)
	ctx := context.Background()
	if err := a.exec(ctx, "UPDATE servers SET status='installing' WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/client/servers/" + str(server["uuid"]) + "/navigation"
	var wg sync.WaitGroup
	for _, method := range []string{"POST", "PUT"} {
		wg.Add(1)
		go func(method string) {
			defer wg.Done()
			var body any
			code := 204
			if method == "PUT" {
				body = M{"favorite": true}
				code = 200
			}
			infraExpect(t, mux, admin, method, endpoint, body, code)
		}(method)
	}
	wg.Wait()
	pref, err := a.one(ctx, "SELECT favorite,last_visited_at FROM user_server_navigation WHERE user_id=$1 AND server_id=$2", admin, server["id"])
	if err != nil || !boolean(pref["favorite"]) || pref["last_visited_at"] == nil {
		t.Fatalf("concurrent preference update lost: %v %v", pref, err)
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"favorite": false}, 200)
	pref, err = a.one(ctx, "SELECT favorite,last_visited_at FROM user_server_navigation WHERE user_id=$1 AND server_id=$2", admin, server["id"])
	if err != nil || boolean(pref["favorite"]) || pref["last_visited_at"] == nil {
		t.Fatal("unfavorite cleared recent visit")
	}
	if err = a.exec(ctx, "DELETE FROM servers WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	pref, err = a.one(ctx, "SELECT count(*) AS count FROM user_server_navigation")
	if err != nil || num(pref["count"]) != 0 {
		t.Fatal("deleted server retained preferences")
	}
}
