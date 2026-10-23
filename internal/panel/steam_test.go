package panel

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"voltra/internal/nodetunnel"
	"voltra/internal/steamapi"
)

func TestSteamCheckDue(t *testing.T) {
	at := time.Now().UTC()
	cases := []struct {
		name  string
		state M
		want  bool
	}{
		{"never checked", M{"check_interval_seconds": 3600}, true},
		{"recent success", M{"check_interval_seconds": 3600, "last_checked_at": at.Add(-time.Minute)}, false},
		{"hour elapsed", M{"check_interval_seconds": 3600, "last_checked_at": at.Add(-time.Hour)}, true},
		{"failure backoff", M{"check_interval_seconds": 3600, "last_failed_at": at.Add(-time.Minute)}, false},
		{"retry after failure", M{"check_interval_seconds": 3600, "last_failed_at": at.Add(-6 * time.Minute)}, true},
		{"success supersedes failure", M{"check_interval_seconds": 3600, "last_failed_at": at.Add(-2 * time.Hour), "last_checked_at": at.Add(-time.Minute)}, false},
		{"attempt is not failure", M{"check_interval_seconds": 3600, "last_attempt_at": at.Add(-time.Minute)}, true},
		{"slow failure backoff starts at completion", M{"check_interval_seconds": 3600, "last_attempt_at": at.Add(-10 * time.Minute), "last_failed_at": at.Add(-time.Minute)}, false},
		{"failure backoff exact boundary", M{"check_interval_seconds": 3600, "last_failed_at": at.Add(-5 * time.Minute)}, true},
		{"failure retry still respects success cooldown", M{"check_interval_seconds": 3600, "last_checked_at": at.Add(-30 * time.Minute), "last_failed_at": at.Add(-6 * time.Minute)}, false},
		{"both cooldowns elapsed", M{"check_interval_seconds": 3600, "last_checked_at": at.Add(-time.Hour), "last_failed_at": at.Add(-5 * time.Minute)}, true},
		{"invalid interval uses default hour", M{"check_interval_seconds": 0, "last_checked_at": at.Add(-30 * time.Minute)}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := steamCheckDue(c.state, at); got != c.want {
				t.Fatalf("due=%v want %v", got, c.want)
			}
		})
	}
}

type steamTestRuntime struct {
	app           *App
	mux           *http.ServeMux
	user          int64
	server        M
	mu            sync.Mutex
	state         string
	operations    []string
	validations   []bool
	syncStartups  []string
	failSyncOnce  bool
	cancelSync    context.CancelFunc
	syncMutation  func()
	failPowerOnce bool
	powers        []string
	powerWaits    []int64
	stopLockRace  bool
	stopLockHeld  bool
	available     bool
	failCheck     bool
	failMutation  bool
	block         <-chan struct{}
}

func steamRuntime(t *testing.T) *steamTestRuntime {
	t.Helper()
	a, h, user := pairingTestApp(t)
	a.registerSteam(h)
	rt := &steamTestRuntime{app: a, mux: h, user: user, state: "offline", available: true}
	ctx := context.Background()
	insert := func(table string, data M) M {
		t.Helper()
		row, e := a.insert(ctx, table, data)
		if e != nil {
			t.Fatal(e)
		}
		return row
	}
	wings := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rt.mu.Lock()
		defer rt.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/sync") {
			// Real Wings fetches Panel configuration on a separate connection.
			row, err := a.one(context.Background(), "SELECT startup FROM servers WHERE id=$1", rt.server["id"])
			if err != nil {
				http.Error(w, "fixture config fetch failed", 500)
				return
			}
			rt.syncStartups = append(rt.syncStartups, str(row["startup"]))
			if rt.syncMutation != nil {
				action := rt.syncMutation
				rt.syncMutation = nil
				action()
			}
			if rt.cancelSync != nil {
				cancel := rt.cancelSync
				rt.cancelSync = nil
				cancel()
			}
			if rt.failSyncOnce {
				rt.failSyncOnce = false
				http.Error(w, "fixture sync failure", 503)
				return
			}
			w.WriteHeader(204)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/power") {
			if rt.failPowerOnce {
				rt.failPowerOnce = false
				http.Error(w, "fixture power failure", 503)
				return
			}
			var d M
			_ = json.NewDecoder(r.Body).Decode(&d)
			action := str(d["action"])
			rt.powers = append(rt.powers, action)
			rt.powerWaits = append(rt.powerWaits, num(d["wait_seconds"]))
			if action == "start" {
				if rt.stopLockHeld && num(d["wait_seconds"]) == 0 {
					w.WriteHeader(http.StatusAccepted)
					return
				}
				rt.stopLockHeld = false
				rt.state = "running"
			} else {
				rt.state = "offline"
				rt.stopLockHeld = rt.stopLockRace
			}
			w.WriteHeader(204)
			return
		}
		writeJSON(w, 200, M{"state": rt.state})
	}))
	t.Cleanup(wings.Close)
	host, p, _ := net.SplitHostPort(strings.TrimPrefix(wings.URL, "http://"))
	port, _ := strconv.Atoi(p)
	location := insert("locations", M{"short": "steam"})
	daemonToken, sealErr := a.seal("steam-fixture")
	if sealErr != nil {
		t.Fatal(sealErr)
	}
	node := insert("nodes", M{"uuid": newUUID(), "name": "Steam test node", "location_id": location["id"], "fqdn": host, "daemon_listen": port, "daemon_token_id": "steam-test", "daemon_token": daemonToken})
	nest := insert("nests", M{"uuid": newUUID(), "name": "Steam tests", "author": "test@example.invalid"})
	egg := insert("eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "Steam launch test", "author": "test@example.invalid"})
	uuid := newUUID()
	rt.server = insert("servers", M{"uuid": uuid, "uuid_short": uuid[:8], "identifier": uuid[:8], "name": "Steam fixture", "owner_id": user, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "test:local"})
	if e := a.configureSteamServer(ctx, num(rt.server["id"]), "palworld", 2394010, "public"); e != nil {
		t.Fatal(e)
	}
	if e := a.exec(ctx, "UPDATE steam_servers SET needs_repair=false,initialized=true,installed_build='100' WHERE server_id=$1", rt.server["id"]); e != nil {
		t.Fatal(e)
	}
	token := randomToken(32)
	insert("node_connectors", M{"node_id": node["id"], "token_hash": pairingHash(token)})
	panel := httptest.NewServer(h)
	t.Cleanup(panel.Close)
	wsURL := "ws" + strings.TrimPrefix(panel.URL, "http")
	control, _, err := websocket.DefaultDialer.Dial(wsURL+"/api/remote/connector", http.Header{"Authorization": {"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = control.Close() })
	if err = control.WriteJSON(M{"type": "hello", "capabilities": []string{"steam-v1", steamapi.OptionsCapability}}); err != nil {
		t.Fatal(err)
	}
	var worker sync.WaitGroup
	go func() {
		defer worker.Wait()
		for {
			var message M
			if control.ReadJSON(&message) != nil {
				return
			}
			worker.Add(1)
			go func(message M) {
				defer worker.Done()
				ws, _, e := websocket.DefaultDialer.Dial(wsURL+"/api/remote/connector/streams/"+str(message["id"]), http.Header{"Authorization": {"Bearer " + token}})
				if e != nil {
					return
				}
				stream := nodetunnel.NewConn(ws)
				defer stream.Close()
				req, e := http.ReadRequest(bufio.NewReader(stream))
				if e != nil {
					return
				}
				defer req.Body.Close()
				var request steamapi.Request
				if json.NewDecoder(req.Body).Decode(&request) != nil {
					return
				}
				rt.mu.Lock()
				rt.operations = append(rt.operations, request.Operation)
				rt.validations = append(rt.validations, request.Validate)
				fail := request.Operation == "check" && rt.failCheck || request.Operation != "check" && rt.failMutation
				available := rt.available
				block := rt.block
				rt.mu.Unlock()
				if block != nil {
					<-block
				}
				event := steamapi.Event{Type: "result", Stage: "complete", InstalledBuild: "100", LatestBuild: "200", UpdateAvailable: available, FilesChanged: request.Operation != "check"}
				if request.Operation != "check" {
					event.InstalledBuild = "200"
					event.UpdateAvailable = false
				}
				if fail {
					event.Type = "error"
					event.Error = "Fixture Steam unavailable."
				}
				data, _ := json.Marshal(event)
				data = append(data, '\n')
				_, _ = fmt.Fprintf(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", len(data))
				_, _ = stream.Write(data)
			}(message)
		}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for !a.steamNodeAvailable(ctx, num(node["id"])) {
		if time.Now().After(deadline) {
			t.Fatal("Steam capability not received")
		}
		time.Sleep(time.Millisecond)
	}
	return rt
}

func (rt *steamTestRuntime) request(t *testing.T, operation string, want int) M {
	t.Helper()
	return infraExpect(t, rt.mux, rt.user, "POST", "/api/client/servers/"+str(rt.server["uuid"])+"/steam/"+operation, M{}, want)
}
func (rt *steamTestRuntime) run(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if !rt.app.processSteamJob(ctx) {
		t.Fatal("no Steam job claimed")
	}
}

func TestSteamStartChecksOnceAndUpdatesBeforeLaunch(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	response, err := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"})
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	rt.run(t)
	rt.mu.Lock()
	gotOps := strings.Join(rt.operations, ",")
	gotPower := strings.Join(rt.powers, ",")
	rt.mu.Unlock()
	if gotOps != "check,update" || gotPower != "start" {
		t.Fatalf("operations=%s power=%s", gotOps, gotPower)
	}
	for range 3 {
		response, err = rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "restart"})
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		rt.run(t)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if len(rt.operations) != 2 {
		t.Fatalf("rapid restarts ran Steam again: %v", rt.operations)
	}
	if strings.Join(rt.powers, ",") != "start,stop,start,stop,start,stop,start" {
		t.Fatalf("restart sequence: %v", rt.powers)
	}
}

func TestSteamFailureBackoffStartsInstalledAndManualCheckOverrides(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	rt.failCheck = true
	for range 2 {
		response, err := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "restart"})
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		rt.run(t)
	}
	rt.mu.Lock()
	count := len(rt.operations)
	rt.mu.Unlock()
	if count != 1 {
		t.Fatalf("failed checks were repeated: %d", count)
	}
	rt.request(t, "check", 202)
	rt.run(t)
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if len(rt.operations) != 2 {
		t.Fatal("manual check did not bypass cooldown")
	}
}

func TestSteamDuplicateJobsPermissionsAndStoppedRequirement(t *testing.T) {
	rt := steamRuntime(t)
	first := asMap(rt.request(t, "verify", 202)["attributes"])
	again := asMap(rt.request(t, "verify", 202)["attributes"])
	if str(first["id"]) != str(again["id"]) {
		t.Fatal("duplicate maintenance job created")
	}
	rt.request(t, "update", 409)
	rt.run(t)
	rt.mu.Lock()
	rt.state = "running"
	rt.mu.Unlock()
	rt.request(t, "update", 409)
	rt.request(t, "verify", 409)
	user, e := rt.app.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "steam-viewer", "email": "steam-viewer@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = rt.app.insert(context.Background(), "subusers", M{"user_id": user["id"], "server_id": rt.server["id"], "permissions": []string{"startup.read"}}); e != nil {
		t.Fatal(e)
	}
	infraExpect(t, rt.mux, num(user["id"]), "GET", "/api/client/servers/"+str(rt.server["uuid"])+"/steam", nil, 200)
	infraExpect(t, rt.mux, num(user["id"]), "POST", "/api/client/servers/"+str(rt.server["uuid"])+"/steam/verify", M{}, 403)
}

func TestSteamInterruptedMutationBlocksStartAndVerifyRecovers(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	job := asMap(rt.request(t, "update", 202)["attributes"])
	if e := rt.app.exec(ctx, "UPDATE steam_jobs SET status='running',stage='updating',files_changed=true,lease_until=now()-interval '1 second' WHERE id=$1", job["id"]); e != nil {
		t.Fatal(e)
	}
	rt.run(t)
	if _, e := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"}); e == nil {
		t.Fatal("interrupted update allowed startup")
	}
	rt.request(t, "verify", 202)
	rt.run(t)
	response, e := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"})
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	rt.run(t)
}

func TestSteamStopCancelsPendingStartAndSharedMutationLock(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	response, e := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"})
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	response, e = rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "stop"})
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if rt.app.processSteamJob(ctx) {
		t.Fatal("stop did not cancel queued start")
	}
	rt.request(t, "verify", 202)
	tx, e := rt.app.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(rt.server["uuid"]))
	if e != nil {
		t.Fatal(e)
	}
	var finished atomic.Bool
	done := make(chan struct{})
	go func() { rt.app.processSteamJob(ctx); finished.Store(true); close(done) }()
	time.Sleep(100 * time.Millisecond)
	if finished.Load() {
		t.Fatal("Steam mutation ignored Quick setup lock")
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Steam mutation did not resume after settings lock")
	}
}

func TestSteamSocketPowerUsesSharedRules(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	user, e := rt.app.one(ctx, "SELECT * FROM users WHERE id=$1", rt.user)
	if e != nil {
		t.Fatal(e)
	}
	handled, e := rt.app.steamSocketPower(ctx, user, rt.server, []byte(`{"event":"set state","args":["start"]}`))
	if !handled || e != nil {
		t.Fatalf("handled=%v err=%v", handled, e)
	}
	rt.run(t)
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if strings.Join(rt.operations, ",") != "check,update" {
		t.Fatalf("websocket bypassed maintenance: %v", rt.operations)
	}
}

func TestSteamScheduledChecksNeverStopPlayersAndUpdateOnlyOffline(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	if err := rt.app.exec(ctx, "UPDATE steam_servers SET mode='scheduled' WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	rt.mu.Lock()
	rt.state = "running"
	rt.mu.Unlock()
	rt.app.steamSchedule(ctx)
	rt.run(t)
	rt.mu.Lock()
	operations := strings.Join(rt.operations, ",")
	powers := len(rt.powers)
	rt.mu.Unlock()
	if operations != "check" || powers != 0 {
		t.Fatalf("scheduled check disturbed running game: %s power=%d", operations, powers)
	}
	if err := rt.app.exec(ctx, "UPDATE steam_servers SET last_checked_at=now()-interval '2 hours' WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	rt.mu.Lock()
	rt.state = "offline"
	rt.mu.Unlock()
	rt.app.steamSchedule(ctx)
	rt.run(t)
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if strings.Join(rt.operations, ",") != "check,check,update" || len(rt.powers) != 0 {
		t.Fatalf("offline scheduled update: operations=%v power=%v", rt.operations, rt.powers)
	}
}

func TestSteamRepairRecordsSuccessfulCheckAndOffSkipsSteam(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	rt.request(t, "verify", 202)
	rt.run(t)
	response, err := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"})
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	rt.run(t)
	rt.mu.Lock()
	operations := strings.Join(rt.operations, ",")
	rt.mu.Unlock()
	if operations != "verify" {
		t.Fatalf("repair did not begin successful-check cooldown: %s", operations)
	}
	if err = rt.app.exec(ctx, "UPDATE steam_servers SET mode='off',last_checked_at=NULL WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	response, err = rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "restart"})
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	rt.run(t)
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if len(rt.operations) != 1 {
		t.Fatalf("automatic off contacted Steam: %v", rt.operations)
	}
}

func TestSteamStatusVisibleDuringBootstrapAndDurableLogs(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	if err := rt.app.exec(ctx, "UPDATE servers SET status='installing' WHERE id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	infraExpect(t, rt.mux, rt.user, "GET", "/api/client/servers/"+str(rt.server["uuid"])+"/steam", nil, 200)
	if err := rt.app.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	rt.request(t, "verify", 202)
	rt.run(t)
	status := infraExpect(t, rt.mux, rt.user, "GET", "/api/client/servers/"+str(rt.server["uuid"])+"/steam", nil, 200)
	jobs := asSlice(asMap(status["attributes"])["jobs"])
	if len(jobs) != 1 || len(asSlice(asMap(jobs[0])["logs"])) < 2 {
		t.Fatal("completed job progress was not retained")
	}
}

func TestSteamStatusReportsFailureTimeAndCurrentJob(t *testing.T) {
	rt := steamRuntime(t)
	path := "/api/client/servers/" + str(rt.server["uuid"]) + "/steam"
	getStatus := func() M {
		return asMap(infraExpect(t, rt.mux, rt.user, "GET", path, nil, 200)["attributes"])
	}
	status := getStatus()
	if failed, ok := status["last_failed_at"]; !ok || failed != nil {
		t.Fatalf("unfailed server must expose null last_failed_at: %v", status)
	}
	rt.mu.Lock()
	rt.failCheck = true
	rt.mu.Unlock()
	rt.request(t, "check", 202)
	rt.run(t)
	status = getStatus()
	failed := steamTime(status["last_failed_at"])
	attempted := steamTime(status["last_attempt_at"])
	if failed.IsZero() || attempted.IsZero() || failed.Before(attempted) || str(status["last_error"]) == "" {
		t.Fatalf("failed check must expose actual failure time and error: %v", status)
	}
	queued := asMap(rt.request(t, "check", 202)["attributes"])
	status = getStatus()
	current := asMap(status["current_job"])
	if str(current["id"]) != str(queued["id"]) || str(current["status"]) != "queued" || !steamTime(status["last_failed_at"]).Equal(failed) {
		t.Fatalf("retry must expose current job while preserving prior failure time: %v", status)
	}
	rt.mu.Lock()
	rt.failCheck = false
	rt.mu.Unlock()
	rt.run(t)
	status = getStatus()
	if !steamTime(status["last_checked_at"]).After(failed) || str(status["last_error"]) != "" || status["current_job"] != nil {
		t.Fatalf("successful retry must supersede the failure and clear current job: %v", status)
	}
}

func TestSteamLegacyPowerHonorsQuickSetupLock(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	if err := rt.app.exec(ctx, "DELETE FROM steam_servers WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	tx, err := rt.app.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "voltra:server-mutation:"+str(rt.server["uuid"])); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		response, e := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"})
		if response != nil {
			response.Body.Close()
		}
		finished <- e
	}()
	select {
	case err := <-finished:
		t.Fatalf("power bypassed settings lock: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("power did not resume after settings save")
	}
}

func TestSteamClaimQueuesBeyondNodeCapacity(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	rt.request(t, "check", 202)
	for range 2 {
		server := M{}
		for _, key := range []string{"name", "owner_id", "node_id", "nest_id", "egg_id", "image"} {
			server[key] = rt.server[key]
		}
		uuid := newUUID()
		server["uuid"], server["uuid_short"], server["identifier"] = uuid, uuid[:8], uuid[:8]
		created, err := rt.app.insert(ctx, "servers", server)
		if err != nil {
			t.Fatal(err)
		}
		if err = rt.app.configureSteamServer(ctx, num(created["id"]), "palworld", 2394010, "public"); err != nil {
			t.Fatal(err)
		}
		if _, err = rt.app.queueSteamJob(ctx, created, "check", false, true); err != nil {
			t.Fatal(err)
		}
	}
	first, err := rt.app.claimSteamJob(ctx, newUUID())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = rt.app.claimSteamJob(ctx, newUUID()); err != nil {
		t.Fatal(err)
	}
	if _, err = rt.app.claimSteamJob(ctx, newUUID()); err == nil {
		t.Fatal("more jobs claimed than node executor slots")
	}
	if err = rt.app.exec(ctx, "UPDATE steam_jobs SET status='completed',completed_at=now() WHERE id=$1", first["id"]); err != nil {
		t.Fatal(err)
	}
	if _, err = rt.app.claimSteamJob(ctx, newUUID()); err != nil {
		t.Fatal("queued installation did not become claimable after a slot was released", err)
	}
}

// API/PG fixture of Wings' asynchronous202 lock behavior, not native acceptance.
func TestSteamRestartWaitsForWingsPowerLock(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	if err := rt.app.exec(ctx, "UPDATE steam_servers SET mode='off' WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	rt.mu.Lock()
	rt.state = "running"
	rt.stopLockRace = true
	rt.mu.Unlock()
	response, err := rt.app.managedServerPower(ctx, rt.server, "restart")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	rt.run(t)
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if strings.Join(rt.powers, ",") != "stop,start" || len(rt.powerWaits) != 2 || rt.powerWaits[0] != 0 || rt.powerWaits[1] != 30 || rt.state != "running" {
		t.Fatalf("restart did not queue on native power lock: powers=%v waits=%v state=%s", rt.powers, rt.powerWaits, rt.state)
	}
}
