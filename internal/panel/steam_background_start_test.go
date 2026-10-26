package panel

import (
	"context"
	"strings"
	"testing"
)

func TestSteamFormerBeforeStartModeChecksInBackgroundOnly(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	for _, state := range []string{"running", "offline"} {
		if err := rt.app.exec(ctx, "UPDATE steam_servers SET mode='on_start',last_checked_at=NULL WHERE server_id=$1", rt.server["id"]); err != nil {
			t.Fatal(err)
		}
		rt.mu.Lock()
		rt.state = state
		rt.mu.Unlock()
		rt.app.steamSchedule(ctx)
		rt.run(t)
		rt.mu.Lock()
		operations := append([]string(nil), rt.operations...)
		powers := len(rt.powers)
		rt.mu.Unlock()
		if powers != 0 || operations[len(operations)-1] != "check" {
			t.Fatal("background check changed game", operations, powers)
		}
		rt.app.steamSchedule(ctx)
		if rt.app.processSteamJob(ctx) {
			t.Fatal("background cooldown ignored")
		}
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if strings.Join(rt.operations, ",") != "check,check" {
		t.Fatal("check-only mode updated game", rt.operations)
	}
}

func TestSteamBackgroundFailureBackoffAndManualOverride(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	rt.failCheck = true
	rt.app.steamSchedule(ctx)
	rt.run(t)
	rt.app.steamSchedule(ctx)
	if rt.app.processSteamJob(ctx) {
		t.Fatal("failed background check immediately retried")
	}
	rt.request(t, "check", 202)
	rt.run(t)
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if strings.Join(rt.operations, ",") != "check,check" {
		t.Fatal("manual override failed", rt.operations)
	}
}

func TestSteamStartDefersQueuedBackgroundCheck(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
	queued := asMap(rt.request(t, "check", 202)["attributes"])
	response, err := rt.app.managedServerPower(ctx, rt.server, "start")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	rt.run(t)
	job, err := rt.app.one(ctx, "SELECT status FROM steam_jobs WHERE id=$1", queued["id"])
	if err != nil {
		t.Fatal(err)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if str(job["status"]) != "cancelled" || len(rt.operations) != 0 || strings.Join(rt.powers, ",") != "start" {
		t.Fatal("start waited for queued SteamCMD", job, rt.operations, rt.powers)
	}
}

func TestSteamStartClaimDoesNotUseMaintenanceSlots(t *testing.T) {
	rt := steamRuntime(t)
	ctx := context.Background()
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
		if err = rt.app.exec(ctx, "UPDATE steam_jobs SET status='running',lease_until=now()+interval '90 seconds',lease_token=$2 WHERE server_id=$1", created["id"], newUUID()); err != nil {
			t.Fatal(err)
		}
	}
	response, err := rt.app.managedServerPower(ctx, rt.server, "start")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	claimed, err := rt.app.claimSteamJob(ctx, newUUID())
	if err != nil {
		t.Fatal("launch blocked by unrelated SteamCMD slots", err)
	}
	if str(claimed["operation"]) != "start" || num(claimed["server_id"]) != num(rt.server["id"]) {
		t.Fatal("wrong priority", claimed)
	}
}
