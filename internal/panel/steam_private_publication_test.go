package panel

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"voltra/internal/steamapi"
)

func TestPrivateSteamPublicationBackfillIsIndependentOfJobOutcome(t *testing.T) {
	rt, _, _, job, _ := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	_, receipt := privatePublicationFixture(t, a, job)
	if err := a.exec(ctx, "UPDATE steam_private_jobs SET receipt=$2 WHERE job_id=$1", job["id"], receipt); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, "UPDATE steam_jobs SET status='cancelled' WHERE id=$1", job["id"]); err != nil {
		t.Fatal(err)
	}
	fragment, err := os.ReadFile("steam_private_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.DB.Exec(ctx, string(fragment)); err != nil {
		t.Fatal(err)
	}
	row, err := a.one(ctx, "SELECT * FROM steam_private_publications WHERE server_id=$1", rt.server["id"])
	if err != nil || str(row["job_id"]) != str(job["id"]) {
		t.Fatal("cancelled validated result was not backfilled", err)
	}
	// Repeated startup migrations must never replace a newer publication pointer.
	newer := newUUID()
	if err = a.exec(ctx, "UPDATE steam_private_publications SET job_id=$1", newer); err != nil {
		t.Fatal(err)
	}
	if _, err = a.DB.Exec(ctx, string(fragment)); err != nil {
		t.Fatal(err)
	}
	row, err = a.one(ctx, "SELECT job_id FROM steam_private_publications WHERE server_id=$1", rt.server["id"])
	if err != nil || str(row["job_id"]) != newer {
		t.Fatal("migration replaced durable latest publication", err)
	}
}

// Synthetic node results exercise durable custody only. They do not prove
// Steam entitlement, publisher acquisition or native startup.
func privatePublicationFixture(t *testing.T, a *App, job M) (steamapi.PrivateRequest, json.RawMessage) {
	t.Helper()
	row, err := a.one(context.Background(), "SELECT request FROM steam_private_jobs WHERE job_id=$1", job["id"])
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(row["request"])
	var request steamapi.PrivateRequest
	if err = json.Unmarshal(b, &request); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(M{"scope": request.Scope(), "path": request.Scope().Server + "/" + request.Scope().Owner + "/" + request.Nonce + "/receipt.json", "sha256": strings.Repeat("c", 64), "files": "1", "publisher_plan": M{"app": request.Selection.App, "build": "1", "depots": []M{{"publisher_app": request.Selection.App, "depot": 1, "manifest": "1"}}}})
	if err = request.CheckReceipt(raw); err != nil {
		t.Fatal(err)
	}
	return request, raw
}

func TestPrivateSteamPublicationSurvivesCancelledJobAndCredentialDeletion(t *testing.T) {
	rt, client, base, job, token := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	request, receipt := privatePublicationFixture(t, a, job)
	if err := a.recordPrivatePublication(ctx, request, receipt, token); err != nil {
		t.Fatal(err)
	}
	a.finishPrivateSteamJob(ctx, job, token, errPrivateCancelled)
	profile, err := a.one(ctx, "SELECT * FROM steam_private_authorizations")
	if err != nil {
		t.Fatal(err)
	}
	origin := strings.Split(base, "/api/")[0]
	status, body, _ := setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": profile["id"], "operation": "update"}, origin)
	if status != 202 {
		t.Fatalf("next authorized job lost cancelled publication: %d %s", status, body)
	}
	row, err := a.one(ctx, "SELECT request FROM steam_private_jobs WHERE job_id<>$1", job["id"])
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(row["request"])
	var next steamapi.PrivateRequest
	if json.Unmarshal(b, &next) != nil || next.Previous == nil || next.Previous.Scope != request.Scope() {
		t.Fatal("next job did not retain prior publication")
	}
	if err = a.exec(ctx, "DELETE FROM steam_private_authorizations WHERE id=$1", profile["id"]); err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "DELETE FROM steam_jobs WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	publication, err := a.one(ctx, "SELECT * FROM steam_private_publications WHERE server_id=$1", rt.server["id"])
	if err != nil || str(publication["job_id"]) != str(job["id"]) {
		t.Fatal("credential/job deletion lost filesystem ownership", err)
	}
	if blockPublicSteamOwnership(ctx, a.DB, num(rt.server["id"])) == nil {
		t.Fatal("public maintenance took over published private files")
	}
	status, _, _ = setupHTTP(t, client, "POST", base+"/authorizations", M{"username": "different-account", "password": "fixture-password", "save_password": true}, origin)
	if status != 201 {
		t.Fatal(status)
	}
	newProfile, err := a.one(ctx, "SELECT id FROM steam_private_authorizations")
	if err != nil {
		t.Fatal(err)
	}
	status, body, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": newProfile["id"], "operation": "install"}, origin)
	if status != 409 || !strings.Contains(str(body), "PrivateSteamAccountMigrationRequired") {
		t.Fatalf("different account took over files: %d %s", status, body)
	}
}

func TestPrivateSteamPublicationAdmissionAndPlacement(t *testing.T) {
	for _, change := range []string{"cancel", "lease", "scope", "installation", "egg", "node", "owner"} {
		t.Run(change, func(t *testing.T) {
			rt, client, base, job, token := privateRunningFixture(t)
			a, ctx := rt.app, context.Background()
			request, receipt := privatePublicationFixture(t, a, job)
			if change == "cancel" {
				if err := a.exec(ctx, "UPDATE steam_private_jobs SET cancel_requested=true"); err != nil {
					t.Fatal(err)
				}
			}
			if change == "lease" {
				token = "wrong-worker"
			}
			if change == "scope" {
				request.Nonce = strings.Repeat("d", 64)
				var v steamapi.PrivateReceipt
				_ = json.Unmarshal(receipt, &v)
				v.Scope = request.Scope()
				v.Path = v.Scope.Server + "/" + v.Scope.Owner + "/" + v.Scope.Nonce + "/receipt.json"
				receipt, _ = json.Marshal(v)
			}
			err := a.recordPrivatePublication(ctx, request, receipt, token)
			if change == "cancel" || change == "lease" || change == "scope" {
				if err == nil {
					t.Fatal("unadmitted publication accepted")
				}
				row, _ := a.one(ctx, "SELECT count(*) AS n FROM steam_private_publications")
				if num(row["n"]) != 0 {
					t.Fatal("failed admission changed publication")
				}
				row, _ = a.one(ctx, "SELECT receipt FROM steam_private_jobs")
				if row["receipt"] != nil {
					t.Fatal("failed admission did not roll back job receipt")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			a.finishPrivateSteamJob(ctx, job, token, nil)
			// Change the trusted publication binding, without needing unrelated node/egg fixtures.
			columns := map[string]string{"installation": "installation_id", "egg": "egg_id", "node": "node_id", "owner": "server_owner_id"}
			value := "0"
			if change == "installation" {
				value = "'changed'"
			}
			if err = a.exec(ctx, "UPDATE steam_private_publications SET "+columns[change]+"="+value); err != nil {
				t.Fatal(err)
			}
			profile, _ := a.one(ctx, "SELECT id FROM steam_private_authorizations")
			status, body, _ := setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": profile["id"], "operation": "verify"}, strings.Split(base, "/api/")[0])
			if status != 409 || !strings.Contains(str(body), "PrivateSteamContentMigrationRequired") {
				t.Fatalf("stale placement accepted: %d %s", status, body)
			}
		})
	}
}
