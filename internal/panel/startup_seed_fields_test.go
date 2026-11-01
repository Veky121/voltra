package panel

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStartupSeedFieldsAPI(t *testing.T) {
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
		if entry.Path == "openrct2/egg-openrct2.json" {
			selected = entry
		}
	}
	if selected.Path == "" {
		t.Fatal("missing OpenRCT2 profile")
	}
	imported := bind(selected)
	for _, input := range []M{{"key": "SERVER_NAME", "value": "Seed label API"}, {"key": "SERVER_NAME", "reset": true}, {"key": "SERVER_PASSWORD", "value": "seed-password-test"}, {"key": "SERVER_PASSWORD", "reset": true}} {
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
	operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_NAME", "value": "denied"}, f.sub), 403)
	reader := operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.sub), 200)
	if asMap(startupVariable(t, reader, "SERVER_NAME")["effect"])["kind"] != "initial_default" {
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
		if startupVariable(t, response, "SERVER_NAME")["effect"] != nil {
			t.Fatal("custom binding classified as initial default")
		}
		put := operationsExpect(t, f.request("PUT", f.serverPath("/startup/variable"), M{"key": "SERVER_NAME", "value": "Custom fallback"}, f.owner), 200)
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

func TestStartupSeedEffectCanonicalBinding(t *testing.T) {
	count := 0
	for _, entry := range gameTemplates().Entries {
		keys, ok := startupSeedKeys[entry.Path]
		if !ok {
			continue
		}
		count++
		egg := M{}
		for k, v := range entry.Egg {
			egg[k] = v
		}
		install := asMap(asMap(entry.Egg["scripts"])["installation"])
		egg["script_install"] = install["script"]
		egg["script_entry"] = install["entrypoint"]
		server := M{"startup": egg["startup"]}
		declared := map[string]bool{}
		for _, raw := range asSlice(entry.Egg["variables"]) {
			declared[str(asMap(raw)["env_variable"])] = true
		}
		classified := map[string]bool{}
		for _, key := range keys {
			if !declared[key] || classified[key] {
				t.Fatalf("%s %s: undeclared or duplicate initial default", entry.Path, key)
			}
			classified[key] = true
			effect := startupSeedEffect(server, egg, entry, key)
			if effect == nil {
				t.Fatalf("%s %s: no canonical annotation", entry.Path, key)
			}
			out := opVariable(M{"effect": effect, "env_variable": key, "user_editable": false})
			if asMap(out["effect"])["kind"] != "initial_default" || boolean(out["is_editable"]) {
				t.Fatal("API effect or permission changed")
			}
		}
		for _, key := range []string{"SERVER_PORT", "STATUS_PORT", "ARTWORK_PORT", "SERVER_WEBPORT", "ASE_ENABLED", "AUTO_UPDATE", "ONLINE_MODE", "LANGUAGE", "VERSION", "UNKNOWN", "ADMIN_PASSWORD"} {
			if classified[key] {
				continue
			}
			if startupSeedEffect(server, egg, entry, key) != nil {
				t.Fatalf("unexpected classification %s", key)
			}
		}
		for _, field := range []string{"startup", "script_install", "script_entry", "copy_script_from"} {
			old := egg[field]
			egg[field] = "custom"
			if startupSeedEffect(server, egg, entry, keys[0]) != nil {
				t.Fatalf("custom %s classified", field)
			}
			egg[field] = old
		}
		server["startup"] = "custom"
		if startupSeedEffect(server, egg, entry, keys[0]) != nil {
			t.Fatal("custom server classified")
		}
	}
	if count != len(startupSeedKeys) {
		t.Fatalf("only %d canonical profiles", count)
	}
}
