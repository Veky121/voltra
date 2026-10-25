package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"voltra/internal/steamapi"
)

func TestPrivateSteamRecoveryCandidateRequiresUnfinishedRetainedAttempt(t *testing.T) {
	rt, _, _, job, _ := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	check := func(want string) {
		t.Helper()
		got, err := privateRecoveryCandidate(ctx, a.DB, rt.server)
		if err != nil || got != want {
			t.Fatalf("candidate=%q want=%q error=%v", got, want, err)
		}
	}
	check("") // A running acquisition cannot be recovered concurrently.
	for _, status := range []string{"queued", "completed", "failed", "cancelled"} {
		if err := a.exec(ctx, "UPDATE steam_jobs SET status=$1 WHERE id=$2", status, job["id"]); err != nil {
			t.Fatal(err)
		}
		want := ""
		if status == "failed" || status == "cancelled" {
			want = str(job["id"])
		}
		check(want)
	}
	if err := a.exec(ctx, "DELETE FROM steam_private_authorizations WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	check(str(job["id"]))
	if err := a.exec(ctx, "DELETE FROM steam_jobs WHERE id=$1", job["id"]); err != nil {
		t.Fatal(err)
	}
	check(str(job["id"])) // Durable attempts outlive credentials and job history.
	if err := a.exec(ctx, `INSERT INTO steam_private_publications(server_id,job_id,node_id,server_owner_id,egg_id,installation_id,receipt)
	 SELECT server_id,job_id,node_id,server_owner_id,egg_id,installation_id,'{}'::jsonb FROM steam_private_attempts WHERE job_id=$1`, job["id"]); err != nil {
		t.Fatal(err)
	}
	check("") // An already accepted result offers no recovery action.
}

func TestPrivateSteamRecoveryPreservesPreviousGenerationInOriginalDigest(t *testing.T) {
	rt, client, base, job, token := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	first, receipt := privatePublicationFixture(t, a, job)
	if err := a.recordPrivatePublication(ctx, first, receipt, token); err != nil {
		t.Fatal(err)
	}
	a.finishPrivateSteamJob(ctx, job, token, nil)
	profile, _ := a.one(ctx, "SELECT id FROM steam_private_authorizations")
	status, _, _ := setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": profile["id"], "operation": "update"}, strings.Split(base, "/api/")[0])
	if status != 202 {
		t.Fatal(status)
	}
	next, err := a.one(ctx, "SELECT job_id,request FROM steam_private_attempts WHERE job_id<>$1", job["id"])
	if err != nil {
		t.Fatal(err)
	}
	originalBytes, _ := json.Marshal(next["request"])
	var original steamapi.PrivateRequest
	if json.Unmarshal(originalBytes, &original) != nil || original.Previous == nil {
		t.Fatal("second-generation test request lacks prior publication")
	}
	recovered, err := privateRecoveryRequest(ctx, a.DB, rt.server, str(next["job_id"]))
	if err != nil || recovered.Previous == nil || recovered.Scope() != original.Scope() {
		t.Fatal("prior accepted generation blocked or changed newer recovery scope", err)
	}
	recovered.Previous = nil
	if recovered.Scope() == original.Scope() {
		t.Fatal("original previous generation was not bound into request digest")
	}
}

func TestPrivateSteamRecoverySelectsOriginalScopeWithoutCredentials(t *testing.T) {
	rt, _, _, job, _ := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	request, err := privateRecoveryRequest(ctx, a.DB, rt.server, str(job["id"]))
	if err != nil {
		t.Fatal(err)
	}
	// Deleting credential-dependent records must not cause recovery to invent a
	// new nonce, job or selection. No acquisition or synthetic success is invoked.
	if err = a.exec(ctx, "DELETE FROM steam_private_authorizations WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	after, err := privateRecoveryRequest(ctx, a.DB, rt.server, str(job["id"]))
	if err != nil || after.Scope() != request.Scope() || after.Username != "" || after.Password != "" || after.Guard != "" || after.BetaPassword != "" {
		t.Fatal("recovery lost original non-secret scope", err)
	}
	other := M{}
	for k, v := range rt.server {
		other[k] = v
	}
	other["id"] = num(rt.server["id"]) + 1000
	if _, err = privateRecoveryRequest(ctx, a.DB, other, str(job["id"])); err == nil {
		t.Fatal("another server selected original attempt")
	}
}

func TestPrivateSteamRecoveryRejectsBindingOrPolicyDrift(t *testing.T) {
	for _, change := range []string{"node_id", "egg_id", "server_owner_id", "installation_id", "server", "job", "username", "password", "guard", "beta_password", "app", "protected", "superseded"} {
		t.Run(change, func(t *testing.T) {
			rt, _, _, job, _ := privateRunningFixture(t)
			a, ctx := rt.app, context.Background()
			switch change {
			case "node_id", "egg_id", "server_owner_id":
				if err := a.exec(ctx, "UPDATE steam_private_attempts SET "+change+"=0"); err != nil {
					t.Fatal(err)
				}
			case "installation_id":
				if err := a.exec(ctx, "UPDATE steam_private_attempts SET installation_id='different'"); err != nil {
					t.Fatal(err)
				}
			case "superseded":
				newer := newUUID()
				if err := a.exec(ctx, `INSERT INTO steam_private_attempts(job_id,server_id,node_id,server_owner_id,egg_id,installation_id,request,created_at)
				 SELECT $1,server_id,node_id,server_owner_id,egg_id,installation_id,request,created_at+interval '1 second' FROM steam_private_attempts`, newer); err != nil {
					t.Fatal(err)
				}
				if err := a.exec(ctx, `INSERT INTO steam_private_publications(server_id,job_id,node_id,server_owner_id,egg_id,installation_id,receipt)
				 SELECT server_id,job_id,node_id,server_owner_id,egg_id,installation_id,'{}'::jsonb FROM steam_private_attempts WHERE job_id=$1`, newer); err != nil {
					t.Fatal(err)
				}
			default:
				row, _ := a.one(ctx, "SELECT request FROM steam_private_attempts")
				b, _ := json.Marshal(row["request"])
				var request steamapi.PrivateRequest
				if json.Unmarshal(b, &request) != nil {
					t.Fatal("invalid test request")
				}
				switch change {
				case "server":
					request.Server = newUUID()
				case "job":
					request.Job = newUUID()
				case "username":
					request.Username = "not-allowed"
				case "password":
					request.Password = "not-allowed"
				case "guard":
					request.Guard = "not-allowed"
				case "beta_password":
					request.BetaPassword = "not-allowed"
				case "app":
					request.Selection.App = 2406780
				case "protected":
					request.Selection.Protected = nil
				}
				updated, _ := json.Marshal(request)
				if err := a.exec(ctx, "UPDATE steam_private_attempts SET request=$1", updated); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := privateRecoveryRequest(ctx, a.DB, rt.server, str(job["id"])); err == nil {
				t.Fatal("changed scope selected for recovery")
			}
		})
	}
}
