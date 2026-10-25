package panel

import (
	"context"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL uses infraTestApp's disposable schema; Wings is an HTTP fixture.
func TestGameTemplateOptionsCapacity(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	ctx := context.Background()
	config := a.DB.Config()
	config.MaxConns = 1 // SET below must govern every handler query.
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	a.DB = pool
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "openttd/egg-open-t-t-d-server.json" {
			entry = candidate
		}
	}
	if entry.ID == "" {
		t.Fatal("OpenTTD missing")
	}
	nest, err := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "capacity fixture", "author": "fixture@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	egg, err := a.insert(ctx, "eggs", M{"uuid": newUUID(), "nest_id": nest["id"], "name": "capacity fixture", "author": "fixture@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []any{nil, "installing", "suspended"} {
		id := newUUID()
		_, err = a.insert(ctx, "servers", M{"uuid": id, "uuid_short": id[:8], "identifier": id[:8], "name": "used capacity", "owner_id": admin, "node_id": node["id"], "nest_id": nest["id"], "egg_id": egg["id"], "image": "fixture/no-process", "memory": 128, "disk": 256, "status": status})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err = a.DB.Exec(ctx, "DELETE FROM allocations WHERE node_id=$1", node["id"]); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                                       string
		memory, disk, mo, do, wantMemory, wantDisk int64
		available                                  bool
	}{
		{"overallocated", 512, 1024, 50, 50, 384, 768, true},
		{"exact minimum below recommendations", 512, 896, 0, 0, 128, 128, true},
		{"memory full", 384, 1024, 0, 0, 0, 256, false},
		{"disk full", 1024, 768, 0, 0, 640, 0, false},
		{"overcommitted floors zero", 128, 128, 0, 0, 0, 0, false},
		{"unlimited", 1, 1, -1, -1, 1048576, 16777216, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err = a.DB.Exec(ctx, "UPDATE nodes SET memory=$2,disk=$3,memory_overallocate=$4,disk_overallocate=$5 WHERE id=$1", node["id"], tc.memory, tc.disk, tc.mo, tc.do); err != nil {
				t.Fatal(err)
			}
			// Reject database mutations during GET, rather than merely counting rows.
			if _, err = a.DB.Exec(ctx, "SET default_transaction_read_only=on"); err != nil {
				t.Fatal(err)
			}
			out := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/templates/"+entry.ID, nil, 200)["attributes"])
			if _, err = a.DB.Exec(ctx, "SET default_transaction_read_only=off"); err != nil {
				t.Fatal(err)
			}
			nodes := asSlice(out["nodes"])
			if len(nodes) != 1 {
				t.Fatalf("nodes=%v", nodes)
			}
			got := asMap(nodes[0])
			if num(got["available_memory"]) != tc.wantMemory || num(got["available_disk"]) != tc.wantDisk || boolean(got["setup_available"]) != tc.available {
				t.Fatalf("capacity=%v", got)
			}
			if !boolean(got["automatic_ports"]) || len(asSlice(got["allocations"])) != 0 {
				t.Fatalf("automatic allocation must remain possible without free rows: %v", got)
			}
			if tc.available && str(got["unavailable_reason"]) != "" {
				t.Fatal(got)
			}
			if !tc.available && str(got["unavailable_reason"]) == "" {
				t.Fatal("missing unavailable reason")
			}
			if num(asMap(out["defaults"])["memory"]) <= 128 {
				t.Fatal("fixture must retain a recommendation above minimum")
			}
		})
	}
	if wings.Creates != 0 || wings.Writes != 0 {
		t.Fatal("GET mutated Wings")
	}
}
