package panel

import (
	"context"
	"strings"
	"testing"
)

func TestSteamStartNeverRunsSteamCMDEvenWithLegacyValidation(t *testing.T) {
	for _, tc := range []struct {
		name, mode, operations            string
		validate, cached, available, fail bool
	}{
		{name: "off preserves installed startup", mode: "off", validate: true},
		{name: "stale metadata does not block startup", mode: "on_start"},
		{name: "legacy validation does not run at startup", mode: "on_start", validate: true},
		{name: "cached build skips Steam", mode: "on_start", validate: true, cached: true},
		{name: "scheduled mode skips Steam at startup", mode: "scheduled", validate: true, cached: true},
		{name: "available update does not block installed startup", mode: "on_start", validate: true, available: true},
		{name: "unavailable maintenance does not block healthy startup", mode: "on_start", validate: true, cached: true, fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rt := steamRuntime(t)
			ctx := context.Background()
			rt.available, rt.failMutation = tc.available, tc.fail
			rt.failCheck = tc.fail
			if err := rt.app.exec(ctx, "UPDATE steam_servers SET mode=$2,validate_on_start=$3,last_checked_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE server_id=$1", rt.server["id"], tc.mode, tc.validate, tc.cached); err != nil {
				t.Fatal(err)
			}
			if tc.available {
				if err := rt.app.exec(ctx, "UPDATE steam_servers SET latest_build='200',update_available=true WHERE server_id=$1", rt.server["id"]); err != nil {
					t.Fatal(err)
				}
			}
			response, err := rt.app.daemonServer(ctx, rt.server, "POST", "/power", M{"action": "start"})
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			rt.run(t)
			rt.mu.Lock()
			defer rt.mu.Unlock()
			if got := strings.Join(rt.operations, ","); got != tc.operations {
				t.Fatalf("operations=%q want %q", got, tc.operations)
			}
			for i, operation := range rt.operations {
				if got, want := rt.validations[i], tc.validate && operation != "check"; got != want {
					t.Fatalf("%s validation=%v want %v", operation, got, want)
				}
			}
			if strings.Join(rt.powers, ",") != "start" {
				t.Fatalf("power=%v", rt.powers)
			}
		})
	}
}
