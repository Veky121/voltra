package panel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"voltra/internal/nodeagent"
)

func approvedFixtureNode(t *testing.T, h http.Handler, u int64) (M, M) {
	t.Helper()
	session := pairSession(t, h, u, 0)
	request := pairNodeRequest(t, h, session)
	status, result := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{})
	if status != 200 {
		t.Fatalf("approve %d: %v", status, result)
	}
	status, result = pairingRequest(t, h, 0, "GET", "/api/remote/enroll/"+str(request["id"]), str(request["request_token"]), nil)
	if status != 200 {
		t.Fatal("poll approved failed")
	}
	return request, result
}
func TestNodeRecoveryPreservesIdentityServersAndSettings(t *testing.T) {
	a, h, u := pairingTestApp(t)
	ctx := context.Background()
	_, initial := approvedFixtureNode(t, h, u)
	id := num(initial["node_id"])
	node, e := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", id)
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.DB.Exec(ctx, "UPDATE nodes SET name='Keep this name',memory=8192,daemon_base='/var/lib/custom-node',maintenance_mode=true WHERE id=$1", id)
	if e != nil {
		t.Fatal(e)
	}
	nest, e := a.insert(ctx, "nests", M{"uuid": newUUID(), "author": "test@example.invalid", "name": "recovery"})
	if e != nil {
		t.Fatal(e)
	}
	egg, e := a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "author": "test@example.invalid", "name": "recovery"})
	if e != nil {
		t.Fatal(e)
	}
	server, e := a.insert(ctx, "servers", M{"uuid": newUUID(), "uuid_short": "recover1", "identifier": "recover1", "name": "Keep server", "owner_id": u, "node_id": id, "nest_id": nest["id"], "egg_id": egg["id"], "image": "alpine:3.23"})
	if e != nil {
		t.Fatal(e)
	}
	allocation, e := a.insert(ctx, "allocations", M{"node_id": id, "server_id": server["id"], "ip": "127.0.0.1", "port": 25565})
	if e != nil {
		t.Fatal(e)
	}
	status, recovery := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+str(id)+"/reconnect", "", nil)
	if status != 201 || num(recovery["recovery_node_id"]) != id || num(recovery["max_nodes"]) != 1 || !strings.Contains(str(recovery["install_command"]), "--reconnect") {
		t.Fatalf("recovery session %d %v", status, recovery)
	}
	r := pairNodeRequest(t, h, recovery)
	if !boolean(r["recovery"]) {
		t.Fatal("node cannot identify a recovery enrollment")
	}
	// Creating recovery credentials alone does not revoke the working node.
	if _, e = a.connectorNode(ctx, str(initial["connector_token"])); e != nil {
		t.Fatal("recovery request prematurely revoked original node")
	}
	status, approved := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(r["id"])+"/approve", "", M{"name": "must not rename existing node"})
	if status != 200 || num(approved["node_id"]) != id {
		t.Fatalf("recovery approval %d %v", status, approved)
	}
	_, result := pairingRequest(t, h, 0, "GET", "/api/remote/enroll/"+str(r["id"]), str(r["request_token"]), nil)
	if !boolean(result["recovery"]) || num(result["node_id"]) != id || asMap(result["configuration"])["uuid"] != node["uuid"] {
		t.Fatal("recovery replaced node identity")
	}
	current, e := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", id)
	if e != nil {
		t.Fatal(e)
	}
	if current["name"] != "Keep this name" || num(current["memory"]) != 8192 || current["daemon_base"] != "/var/lib/custom-node" || !boolean(current["maintenance_mode"]) {
		t.Fatal("recovery changed node settings")
	}
	var count int
	_ = a.DB.QueryRow(ctx, "SELECT count(*) FROM nodes").Scan(&count)
	if count != 1 {
		t.Fatal("recovery created a duplicate node")
	}
	serverAfter, e := a.one(ctx, "SELECT * FROM servers WHERE id=$1", server["id"])
	if e != nil || num(serverAfter["node_id"]) != id {
		t.Fatal("server association lost")
	}
	allocationAfter, e := a.one(ctx, "SELECT * FROM allocations WHERE id=$1", allocation["id"])
	if e != nil || num(allocationAfter["server_id"]) != num(server["id"]) {
		t.Fatal("allocation association lost")
	}
	if _, e = a.connectorNode(ctx, str(initial["connector_token"])); e == nil {
		t.Fatal("old connector credential still valid")
	}
	if _, e = a.connectorNode(ctx, str(result["connector_token"])); e != nil {
		t.Fatal("new connector credential invalid")
	}
	if status, _ = pairingRequest(t, h, 0, "POST", "/api/remote/enroll/"+str(r["id"])+"/complete", str(r["request_token"]), nil); status != 200 {
		t.Fatal("recovery completion failed")
	}
}

func TestRecoveryReplacesPriorInvitationAndRejectsWrongCredentials(t *testing.T) {
	a, h, u := pairingTestApp(t)
	_, n := approvedFixtureNode(t, h, u)
	id := str(n["node_id"])
	status, first := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+id+"/reconnect", "", nil)
	if status != 201 {
		t.Fatal("reconnect failed")
	}
	request := pairNodeRequest(t, h, first)
	status, second := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+id+"/reconnect", "", nil)
	if status != 201 || second["id"] == first["id"] {
		t.Fatal("new recovery invitation failed")
	}
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{}); status != 422 {
		t.Fatal("old recovery request still approvable")
	}
	if status, _ := pairingRequest(t, h, 0, "POST", "/api/admin/nodes/"+id+"/reconnect", "", nil); status != 401 {
		t.Fatal("anonymous recovery allowed")
	}
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/nodes/invalid/reconnect", "", nil); status != 422 {
		t.Fatal("invalid recovery node ID allowed")
	}
	_, e := a.DB.Exec(context.Background(), "UPDATE nodes SET connection_mode='direct' WHERE id=$1", num(n["node_id"]))
	if e != nil {
		t.Fatal(e)
	}
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+id+"/reconnect", "", nil); status != 404 {
		t.Fatal("direct node recovery silently changed connection mode")
	}
}

func TestNodeRecoveryRestoresMaintenanceStateAfterRevocation(t *testing.T) {
	a, h, u := pairingTestApp(t)
	_, n := approvedFixtureNode(t, h, u)
	id := num(n["node_id"])
	for range 2 {
		status, _ := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+str(id)+"/disconnect", "", nil)
		if status != 200 {
			t.Fatal("revoke failed")
		}
	}
	status, recovery := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+str(id)+"/reconnect", "", nil)
	if status != 201 {
		t.Fatal("reconnect failed")
	}
	request := pairNodeRequest(t, h, recovery)
	status, _ = pairingRequest(t, h, u, "POST", "/api/admin/node-requests/"+str(request["id"])+"/approve", "", M{})
	if status != 200 {
		t.Fatal("recovery failed")
	}
	row, e := a.one(context.Background(), "SELECT maintenance_mode FROM nodes WHERE id=$1", id)
	if e != nil || boolean(row["maintenance_mode"]) {
		t.Fatal("recovery left an automatically enabled maintenance lock behind")
	}
}

func TestNodeReadinessRequiresWingsAndInvalidatesOnReconnect(t *testing.T) {
	a, h, u := pairingTestApp(t)
	ctx := context.Background()
	panel := httptest.NewServer(h)
	defer panel.Close()
	a.Config.PublicURL = panel.URL
	var healthy atomic.Bool
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !healthy.Load() {
			http.Error(w, "not started", 503)
			return
		}
		writeJSON(w, 200, M{"architecture": "amd64", "version": "fixture"})
	}))
	defer wings.Close()
	_, result := approvedFixtureNode(t, h, u)
	id := num(result["node_id"])
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		done <- nodeagent.Run(runCtx, nodeagent.Config{PanelURL: panel.URL, Token: str(result["connector_token"]), WingsAddress: strings.TrimPrefix(wings.URL, "http://")})
	}()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("connector did not stop")
		}
	}()
	waitConnector(t, a, id, nil)
	waitStage := func(want string) {
		t.Helper()
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			state, e := a.nodeReadiness(ctx, id, false)
			if e != nil {
				t.Fatal(e)
			}
			if str(state["stage"]) == want {
				if want == "ready" && !boolean(state["ready"]) {
					t.Fatal("ready stage without ready flag")
				}
				return
			}
			time.Sleep(15 * time.Millisecond)
		}
		t.Fatalf("node did not reach %s", want)
	}
	waitStage("error")
	state, e := a.nodeReadiness(ctx, id, false)
	if e != nil || !boolean(state["connected"]) || boolean(state["ready"]) {
		t.Fatal("connector-only node marked Ready")
	}
	healthy.Store(true)
	if status, _ := pairingRequest(t, h, u, "POST", "/api/admin/nodes/"+str(id)+"/check", "", nil); status != 200 {
		t.Fatal("retry endpoint failed")
	}
	waitStage("ready")
	healthy.Store(false)
	a.connectors().mu.Lock()
	old := a.connectors().controls[id]
	a.connectors().mu.Unlock()
	a.connectors().disconnect(id)
	waitConnector(t, a, id, old)
	state, e = a.nodeReadiness(ctx, id, false)
	if e != nil || boolean(state["ready"]) {
		t.Fatal("reconnected node inherited stale Ready")
	}
	waitStage("error")
	// A node cannot report itself Ready or inject arbitrary service output.
	status, _ := pairingRequest(t, h, 0, "POST", "/api/remote/connector/status", str(result["connector_token"]), M{"stage": "ready", "detail": "fake success"})
	if status != 422 {
		t.Fatal("node self-reported Ready")
	}
	status, _ = pairingRequest(t, h, 0, "POST", "/api/remote/connector/status", str(result["connector_token"]), M{"stage": "error", "detail": "SECRET-CONTENT"})
	if status != 200 {
		t.Fatal("node service error not accepted")
	}
	row, e := a.one(ctx, "SELECT setup_detail FROM node_connectors WHERE node_id=$1", id)
	if e != nil || strings.Contains(str(row["setup_detail"]), "SECRET-CONTENT") {
		t.Fatal("arbitrary node logs persisted")
	}
}
