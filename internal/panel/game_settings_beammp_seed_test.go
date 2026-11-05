package panel

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWave167SeedAPI(t *testing.T) {
	var schemaName string
	t.Cleanup(func() {
		if schemaName == "" {
			return
		}
		control, err := pgxpool.New(context.Background(), os.Getenv("TEST_DATABASE_URL"))
		if err != nil {
			t.Error("cannot verify fixture cleanup")
			return
		}
		defer control.Close()
		var exists bool
		if err := control.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", schemaName).Scan(&exists); err != nil || exists {
			t.Error("startup fixture schema cleanup not verified")
		}
	})
	f := operationsFixtureNew(t)
	schemaName = f.a.DB.Config().ConnConfig.RuntimeParams["search_path"]
	ctx := context.Background()
	bind := func(entry gameTemplate) M {
		egg, variables, err := parseEggDocument(entry.Egg)
		if err != nil {
			t.Fatal(err)
		}
		imported, err := f.a.ensureGameTemplateEgg(ctx, entry, egg, variables)
		if err != nil {
			t.Fatal(err)
		}
		f.server, err = f.a.update(ctx, "servers", num(f.server["id"]), M{"egg_id": imported["id"], "nest_id": imported["nest_id"], "startup": imported["startup"]})
		if err != nil {
			t.Fatal(err)
		}
		return imported
	}
	var selected gameTemplate
	for _, entry := range gameTemplates().Entries {
		keys, ok := startupSeedKeys[entry.Path]
		if entry.Path != "beamng/beammp/egg-beam-m-p-server.json" {
			continue
		}
		if !ok {
			continue
		}
		t.Run(entry.Path, func(t *testing.T) {
			bind(entry)
			response := operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.owner), 200)
			for _, key := range keys {
				viewable := false
				for _, raw := range asSlice(entry.Egg["variables"]) {
					variable := asMap(raw)
					if str(variable["env_variable"]) == key {
						viewable = boolean(variable["user_viewable"])
					}
				}
				if !viewable {
					continue
				}
				v := startupVariable(t, response, key)
				if asMap(v["effect"])["kind"] != "initial_default" {
					t.Fatalf("missing initial-default metadata for %s", key)
				}
			}
			if entry.Path == "dont_starve/egg-don-t-starve-together.json" && startupVariable(t, response, "ONLINE_MODE")["effect"] != nil {
				t.Fatal("online mode must retain next-start behavior")
			}
		})
		if entry.Path == "beamng/beammp/egg-beam-m-p-server.json" {
			selected = entry
		}
	}
	if selected.Path == "" {
		t.Fatal("missing OpenRCT2 profile")
	}
	imported := bind(selected)
	for _, input := range []M{{"key": "NAME", "value": "Seed label API"}, {"key": "NAME", "reset": true}, {"key": "AUTHKEY", "value": "seed-password-test"}} {
		response := f.request("PUT", f.serverPath("/startup/variable"), input, f.owner)
		body := operationsExpect(t, response, 200)
		v := asMap(body["attributes"])
		if asMap(v["effect"])["kind"] != "initial_default" || asMap(body["meta"])["applies"] != "initial_default" {
			t.Fatal("save/reset lost initial-default effect")
		}
		if strings.Contains(response.Body.String(), "seed-password-test") {
			t.Fatal("secret leaked in response")
		}
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "NAME", "value": "denied"}, f.sub), 403)
	reader := operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.sub), 200)
	if asMap(startupVariable(t, reader, "NAME")["effect"])["kind"] != "initial_default" {
		t.Fatal("reader lost metadata")
	}
	for _, custom := range []struct {
		table, field string
		id           int64
		value        string
	}{
		{"servers", "startup", num(f.server["id"]), str(imported["startup"]) + " custom"},
		{"eggs", "script_install", num(imported["id"]), str(imported["script_install"]) + "\n# custom"},
	} {
		before, err := f.a.one(ctx, "SELECT * FROM "+custom.table+" WHERE id=$1", custom.id)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.a.update(ctx, custom.table, custom.id, M{custom.field: custom.value}); err != nil {
			t.Fatal(err)
		}
		response := operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.owner), 200)
		if startupVariable(t, response, "NAME")["effect"] != nil {
			t.Fatal("custom binding classified as initial default")
		}
		put := operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "NAME", "value": "Custom fallback"}, f.owner), 200)
		if asMap(put["attributes"])["effect"] != nil {
			t.Fatal("custom save retained effect")
		}
		if _, err := f.a.update(ctx, custom.table, custom.id, M{custom.field: before[custom.field]}); err != nil {
			t.Fatal(err)
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.calls {
		if strings.HasSuffix(str(call["path"]), "/power") || strings.HasSuffix(str(call["path"]), "/reinstall") {
			t.Fatal("metadata/save/reset issued a power or installer action")
		}
	}
}
