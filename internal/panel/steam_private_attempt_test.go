package panel

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"voltra/internal/steamapi"
)

func TestPrivateSteamAttemptRetainsExactNonSecretRequest(t *testing.T) {
	rt, _, _, job, _ := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	row, err := a.one(ctx, "SELECT * FROM steam_private_attempts WHERE job_id=$1", job["id"])
	if err != nil {
		t.Fatal(err)
	}
	stored, err := a.one(ctx, "SELECT request FROM steam_private_jobs WHERE job_id=$1", job["id"])
	if err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal(row["request"])
	want, _ := json.Marshal(stored["request"])
	if string(got) != string(want) {
		t.Fatal("attempt changed original selection or scope")
	}
	var request steamapi.PrivateRequest
	if json.Unmarshal(got, &request) != nil || request.Validate() != nil || request.Job != str(job["id"]) || request.Server != str(rt.server["uuid"]) {
		t.Fatal("invalid durable original request")
	}
	if request.Username != "" || request.Password != "" || request.Guard != "" || request.BetaPassword != "" || strings.Contains(string(got), "fixture-account") || strings.Contains(string(got), "fixture-password") {
		t.Fatal("credentials leaked into durable attempt metadata")
	}
	for _, key := range []string{"node_id", "egg_id", "installation_id"} {
		if str(row[key]) != str(rt.server[key]) {
			t.Fatalf("attempt changed binding %s", key)
		}
	}
	if str(row["server_owner_id"]) != str(rt.server["owner_id"]) || num(row["server_id"]) != num(rt.server["id"]) {
		t.Fatal("attempt changed server ownership binding")
	}
	if err = a.exec(ctx, "DELETE FROM steam_private_authorizations WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "DELETE FROM steam_jobs WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	after, err := a.one(ctx, "SELECT request FROM steam_private_attempts WHERE job_id=$1", job["id"])
	retained, _ := json.Marshal(after["request"])
	if err != nil || string(retained) != string(got) {
		t.Fatal("credential/job removal lost original recovery scope", err)
	}
	if blockPublicSteamOwnership(ctx, a.DB, num(rt.server["id"])) == nil {
		t.Fatal("lost-result attempt allowed public takeover after credential/job removal")
	}
	if err = a.exec(ctx, "DELETE FROM servers WHERE id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	count, err := a.one(ctx, "SELECT count(*) AS n FROM steam_private_attempts WHERE server_id=$1", rt.server["id"])
	if err != nil || num(count["n"]) != 0 {
		t.Fatal("server deletion leaked recovery metadata", err)
	}
}

func TestPrivateSteamAttemptBackfillRetainsOriginalScope(t *testing.T) {
	rt, _, _, job, _ := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	before, err := a.one(ctx, "SELECT request FROM steam_private_attempts WHERE job_id=$1", job["id"])
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "DELETE FROM steam_private_attempts WHERE job_id=$1", job["id"]); err != nil {
		t.Fatal(err)
	}
	fragment, err := os.ReadFile("steam_private_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err = a.DB.Exec(ctx, string(fragment)); err != nil {
			t.Fatal(err)
		}
	}
	after, err := a.one(ctx, "SELECT request FROM steam_private_attempts WHERE job_id=$1", job["id"])
	x, _ := json.Marshal(before["request"])
	y, _ := json.Marshal(after["request"])
	if err != nil || string(x) != string(y) {
		t.Fatal("backfill changed or lost exact original scope", err)
	}
}
