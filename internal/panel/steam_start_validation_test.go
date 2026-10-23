package panel

import (
	"context"
	"strings"
	"testing"
)

func TestSteamAutomaticStartValidation(t *testing.T) {
	for _, tc := range []struct {
		name, mode, operations            string
		validate, cached, available, fail bool
	}{
		{name: "off preserves installed startup", mode: "off", validate: true},
		{name: "default preserves current check", mode: "on_start", operations: "check"},
		{name: "current build validates once", mode: "on_start", validate: true, operations: "check,verify"},
		{name: "cached build validates once", mode: "on_start", validate: true, cached: true, operations: "verify"},
		{name: "scheduled cached build validates", mode: "scheduled", validate: true, cached: true, operations: "verify"},
		{name: "update validates without duplicate", mode: "on_start", validate: true, available: true, operations: "check,update"},
		{name: "validation failure prevents power", mode: "on_start", validate: true, cached: true, fail: true, operations: "verify"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rt := steamRuntime(t)
			ctx := context.Background()
			rt.available, rt.failMutation = tc.available, tc.fail
			if err := rt.app.exec(ctx, "UPDATE steam_servers SET mode=$2,validate_on_start=$3,last_checked_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE server_id=$1", rt.server["id"], tc.mode, tc.validate, tc.cached); err != nil {
				t.Fatal(err)
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
			if tc.fail {
				if len(rt.powers) != 0 {
					t.Fatalf("failed validation powered server: %v", rt.powers)
				}
			} else if strings.Join(rt.powers, ",") != "start" {
				t.Fatalf("power=%v", rt.powers)
			}
		})
	}
}
