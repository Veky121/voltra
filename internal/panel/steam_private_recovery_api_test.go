package panel

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"voltra/internal/steamapi"
)

// These are browser/DB/transport policy tests with synthetic node results.
// They do not establish publisher acquisition, entitlement, or worker recovery.
func TestPrivateSteamRecoveryBrowserRoute(t *testing.T) {
	for _, kind := range []string{"success", "off", "body", "guard", "scope", "native", "trailing", "placement", "queued"} {
		t.Run(kind, func(t *testing.T) {
			rt, client, base, job, token := privateRunningFixture(t)
			a, ctx := rt.app, context.Background()
			original, receipt := privatePublicationFixture(t, a, job)
			a.finishPrivateSteamJob(ctx, job, token, errPrivateCancelled)
			if err := a.exec(ctx, "DELETE FROM steam_private_authorizations WHERE server_id=$1", rt.server["id"]); err != nil {
				t.Fatal(err)
			}
			if err := a.exec(ctx, "DELETE FROM steam_jobs WHERE server_id=$1", rt.server["id"]); err != nil {
				t.Fatal(err)
			}
			calls := 0
			node := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/recover" {
					t.Error("wrong node recovery action")
				}
				var envelope steamapi.PrivateReceiptRecoveryRequest
				d := json.NewDecoder(r.Body)
				d.DisallowUnknownFields()
				if d.Decode(&envelope) != nil || envelope.Validate() != nil || envelope.Original.Request().Scope() != original.Scope() {
					t.Error("original recovery scope changed")
				}
				event := steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "result", Stage: "receipt_recovered", Receipt: receipt}
				switch kind {
				case "guard":
					event.Type = "guard_required"
				case "scope":
					var ref steamapi.PrivateReceipt
					_ = json.Unmarshal(receipt, &ref)
					ref.Scope.Nonce = strings.Repeat("e", 64)
					event.Receipt, _ = json.Marshal(ref)
				case "native":
					event.NativeAcceptanceVerified = true
				case "placement":
					if err := a.exec(ctx, "UPDATE servers SET installation_id='moved' WHERE id=$1", rt.server["id"]); err != nil {
						t.Error(err)
					}
				case "queued":
					if err := a.exec(ctx, "INSERT INTO steam_jobs(id,server_id,operation) VALUES($1,$2,'update')", newUUID(), rt.server["id"]); err != nil {
						t.Error(err)
					}
				}
				_ = json.NewEncoder(w).Encode(event)
				if kind == "trailing" {
					_ = json.NewEncoder(w).Encode(steamapi.PrivateEvent{Version: steamapi.PrivateVersion, Type: "error"})
				}
			}))
			defer node.Close()
			h := a.privateHub()
			if kind != "off" {
				h.recoveryReady = func(context.Context, int64, uint32) bool { return true }
			}
			h.dial = func(_ context.Context, _ int64, grant steamapi.PrivateStreamGrant) (net.Conn, error) {
				calls++
				if grant.Validate() != nil || grant.Action != "recover" || grant.Job != original.Job || grant.Nonce != original.Nonce || grant.RequestDigest != original.Scope().RequestDigest {
					t.Error("unbound recovery grant")
				}
				return net.Dial("tcp", node.Listener.Addr().String())
			}
			body := M{}
			if kind == "body" {
				body["nonce"] = original.Nonce
			}
			status, response, _ := setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/recover", body, strings.Split(base, "/api/")[0])
			count, err := a.one(ctx, "SELECT count(*) AS n FROM steam_private_publications WHERE server_id=$1", rt.server["id"])
			if err != nil {
				t.Fatal(err)
			}
			if kind == "success" {
				if status != 200 || num(count["n"]) != 1 || calls != 1 {
					t.Fatalf("recovery not persisted: %d %v %v calls=%d", status, response, count, calls)
				}
				if !strings.Contains(str(response), "recovered:true") || strings.Contains(str(response), "receipt.json") {
					t.Fatal("wrong public recovery result", response)
				}
				pub, _ := a.one(ctx, "SELECT job_id FROM steam_private_publications WHERE server_id=$1", rt.server["id"])
				if str(pub["job_id"]) != original.Job {
					t.Fatal("recovery invented a new publication identity")
				}
			} else {
				if status < 400 || num(count["n"]) != 0 {
					t.Fatalf("invalid recovery persisted: %d %v", status, response)
				}
				if (kind == "off" || kind == "body") && calls != 0 {
					t.Fatal("rejected request contacted node")
				}
			}
		})
	}
}

func TestPrivateSteamRecoverySessionRevocationCancelsNode(t *testing.T) {
	rt, client, base, job, token := privateRunningFixture(t)
	a, ctx := rt.app, context.Background()
	a.finishPrivateSteamJob(ctx, job, token, errPrivateCancelled)
	started, stopped := make(chan struct{}), make(chan struct{})
	release := make(chan struct{})
	node := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Match the real broker's bounded body consumption so net/http can observe
		// a disconnected peer while this handler waits for cancellation.
		_, _ = io.Copy(io.Discard, io.LimitReader(r.Body, 65537))
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
		close(stopped)
	}))
	defer node.Close()
	defer close(release)
	h := a.privateHub()
	h.poll = 5 * time.Millisecond
	h.recoveryReady = func(context.Context, int64, uint32) bool { return true }
	h.dial = func(c context.Context, _ int64, _ steamapi.PrivateStreamGrant) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(c, "tcp", node.Listener.Addr().String())
	}
	done := make(chan int, 1)
	go func() {
		status, _, _ := setupHTTP(t, client, "POST", base+"/jobs/"+str(job["id"])+"/recover", M{}, strings.Split(base, "/api/")[0])
		done <- status
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("recovery did not start")
	}
	if err := a.exec(ctx, "DELETE FROM browser_sessions"); err != nil {
		t.Fatal(err)
	}
	select {
	case status := <-done:
		if status < 400 {
			t.Fatal("revoked recovery succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("revoked recovery did not return")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("revoked node request not cancelled")
	}
	count, _ := a.one(ctx, "SELECT count(*) AS n FROM steam_private_publications")
	if num(count["n"]) != 0 {
		t.Fatal("revoked recovery persisted metadata")
	}
}
