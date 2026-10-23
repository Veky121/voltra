package panel

import (
	"context"
	"strings"
	"testing"
)

func TestSteamSatisfactoryLegacyStartupPublicationAndRollback(t *testing.T) {
	for _, scenario := range []string{"success", "sync failure", "power failure", "cancel", "duplicate", "malformed", "superseding startup", "superseding installation", "superseding node", "lost lease", "commit failure"} {
		t.Run(scenario, func(t *testing.T) {
			rt := steamRuntime(t)
			base := "./FactoryServer.sh -unattended -custom=keep"
			if scenario == "duplicate" {
				base += " " + steamCatalogPlayersPrefix + "=4 " + steamCatalogPlayersPrefix + "=6"
			}
			if scenario == "malformed" {
				base += " " + steamCatalogPlayersPrefix + "=broken"
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if err := rt.app.exec(ctx, "UPDATE servers SET startup=$2 WHERE id=$1", rt.server["id"], base); err != nil {
				t.Fatal(err)
			}
			if err := rt.app.exec(ctx, "UPDATE steam_servers SET game='satisfactory',app_id=1690800,mode='off' WHERE server_id=$1", rt.server["id"]); err != nil {
				t.Fatal(err)
			}
			if _, err := rt.app.insert(ctx, "steam_game_provisions", M{"actor_id": rt.user, "request_id": newUUID(), "game": "satisfactory", "input_hash": "fixture", "server_id": rt.server["id"], "settings": M{"max_players": 8}}); err != nil {
				t.Fatal(err)
			}
			if _, err := rt.app.queueSteamJob(ctx, rt.server, "start", true, false); err != nil {
				t.Fatal(err)
			}
			token := newUUID()
			job, err := rt.app.claimSteamJob(ctx, token)
			if err != nil {
				t.Fatal(err)
			}
			rt.failSyncOnce, rt.failPowerOnce = scenario == "sync failure", scenario == "power failure"
			if scenario == "cancel" {
				rt.cancelSync = cancel
			}
			if strings.HasPrefix(scenario, "superseding") || scenario == "lost lease" {
				var replacementNode int64
				if scenario == "superseding node" {
					original, err := rt.app.one(ctx, "SELECT location_id FROM nodes WHERE id=$1", rt.server["node_id"])
					if err != nil {
						t.Fatal(err)
					}
					node, err := rt.app.insert(ctx, "nodes", M{"uuid": newUUID(), "name": "replacement fixture node", "location_id": original["location_id"], "fqdn": "replacement.invalid", "daemon_token_id": "replacement-fixture", "daemon_token": "fixture"})
					if err != nil {
						t.Fatal(err)
					}
					replacementNode = num(node["id"])
				}
				rt.syncMutation = func() {
					var err error
					switch scenario {
					case "superseding startup":
						err = rt.app.exec(context.Background(), "UPDATE servers SET startup=$2 WHERE id=$1", rt.server["id"], base+" -operator-change")
					case "superseding installation":
						err = rt.app.exec(context.Background(), "UPDATE servers SET installation_id='new-installation' WHERE id=$1", rt.server["id"])
					case "superseding node":
						err = rt.app.exec(context.Background(), "UPDATE servers SET node_id=$2 WHERE id=$1", rt.server["id"], replacementNode)
					case "lost lease":
						err = rt.app.exec(context.Background(), "UPDATE steam_jobs SET lease_token='different-owner' WHERE id=$1", job["id"])
					}
					if err != nil {
						t.Error(err)
					}
				}
			}
			if scenario == "commit failure" {
				for _, sql := range []string{`CREATE FUNCTION reject_startup_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit rejection'; END $$`, `CREATE CONSTRAINT TRIGGER reject_startup_commit AFTER UPDATE ON servers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_startup_commit()`} {
					if err := rt.app.exec(ctx, sql); err != nil {
						t.Fatal(err)
					}
				}
			}
			err = rt.app.steamStartAfter(ctx, rt.server, job, token)
			row, readErr := rt.app.one(context.Background(), "SELECT s.startup,s.installation_id,st.needs_repair FROM servers s JOIN steam_servers st ON st.server_id=s.id WHERE s.id=$1", rt.server["id"])
			if readErr != nil {
				t.Fatal(readErr)
			}
			rt.mu.Lock()
			defer rt.mu.Unlock()
			published := base + " " + steamCatalogPlayersPrefix + "=8"
			if scenario == "success" {
				if err != nil || str(row["startup"]) != published || len(rt.syncStartups) != 1 || rt.syncStartups[0] != published || strings.Join(rt.powers, ",") != "start" {
					t.Fatalf("Committed startup was not visible before power: error=%v sync=%v power=%v", err, rt.syncStartups, rt.powers)
				}
				return
			}
			if err == nil || len(rt.powers) != 0 {
				t.Fatal("Failed or superseded startup reached power")
			}
			if strings.HasPrefix(scenario, "superseding") {
				if !boolean(row["needs_repair"]) || scenario == "superseding startup" && str(row["startup"]) != base+" -operator-change" || scenario == "superseding installation" && str(row["installation_id"]) != "new-installation" {
					t.Fatal("Compensation overwrote a superseding change or lost repair guard")
				}
				return
			}
			if str(row["startup"]) != base || boolean(row["needs_repair"]) {
				t.Fatal("Failed startup was not restored exactly")
			}
			if scenario == "sync failure" || scenario == "power failure" || scenario == "cancel" || scenario == "lost lease" {
				if len(rt.syncStartups) != 2 || rt.syncStartups[0] != published || rt.syncStartups[1] != base {
					t.Fatalf("Independent configuration fetch did not observe committed update and rollback: %v", rt.syncStartups)
				}
			} else if len(rt.syncStartups) != 0 {
				t.Fatal("Invalid or rejected transaction synchronized unpublished startup")
			}
		})
	}
}

func TestSteamPowerUnlockDiscardsUncertainSession(t *testing.T) {
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	connection, err := a.DB.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	raw := connection.Conn()
	// An unlock that cannot confirm ownership must discard this session,
	// rather than returning a potentially session-locked connection to the pool.
	steamPowerUnlock(connection, "fixture-unconfirmed-session")
	if !raw.IsClosed() {
		t.Fatal("Unconfirmed session was returned to the pool")
	}
	fresh, err := a.DB.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Release()
	if err = fresh.QueryRow(ctx, "SELECT 1").Scan(new(int)); err != nil {
		t.Fatal("Pool did not recover after discarding the uncertain session")
	}
}
