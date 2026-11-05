package panel

import (
	"context"
	"net/http"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWave130DirectAdmission(t *testing.T) {
	for _, recipe := range []string{"nmrih/egg-nmrih.json", "hlds_server/rehlds/egg-custom-re-h-l-d-s-engine-game.json"} {
		for _, mode := range []string{"one", "cross", "valid", "extras", "custom"} {
			t.Run(recipe+"/"+mode, func(t *testing.T) {
				var ownedSchema string
				t.Cleanup(func() {
					if ownedSchema == "" {
						return
					}
					pool, e := pgxpool.New(context.Background(), isolatedTestDatabaseURL(t))
					if e != nil {
						t.Error(e)
						return
					}
					defer pool.Close()
					var exists bool
					if e = pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", ownedSchema).Scan(&exists); e != nil || exists {
						t.Error("owned schema cleanup failed")
					}
				})
				a, _, admin, node, f := steamGamesFixture(t)
				ownedSchema = a.DB.Config().ConnConfig.RuntimeParams["search_path"]
				ctx := context.Background()
				var entry gameTemplate
				for _, candidate := range gameTemplates().Entries {
					if candidate.Path == recipe {
						entry = candidate
					}
				}
				if entry.Path == "" {
					t.Fatal("missing recipe")
				}
				egg, vars, e := parseEggDocument(entry.Egg)
				if e != nil {
					t.Fatal(e)
				}
				imported, e := a.ensureGameTemplateEgg(ctx, entry, egg, vars)
				if e != nil {
					t.Fatal(e)
				}
				if mode == "custom" {
					if _, e = a.update(ctx, "eggs", num(imported["id"]), M{"uuid": newUUID()}); e != nil {
						t.Fatal(e)
					}
				}
				env := M{}
				for _, v := range vars {
					env[str(v["env_variable"])] = v["default_value"]
				}
				image := ""
				for _, v := range asMap(egg["docker_images"]) {
					image = str(v)
					break
				}
				rows, e := a.query(ctx, "SELECT * FROM allocations WHERE node_id=$1 ORDER BY id", node["id"])
				if e != nil {
					t.Fatal(e)
				}
				extra := []any{}
				needed := entry.RequiredPorts
				if needed < 2 {
					t.Fatal("missing declared roles")
				}
				if mode != "one" && mode != "custom" {
					for i := 1; i < needed; i++ {
						extra = append(extra, rows[i]["id"])
						if mode == "cross" {
							if e = a.exec(ctx, "UPDATE allocations SET ip='127.0.0.2' WHERE id=$1", rows[i]["id"]); e != nil {
								t.Fatal(e)
							}
						}
					}
				}
				if mode == "extras" {
					x, e := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.2", "port": 30000})
					if e != nil {
						t.Fatal(e)
					}
					extra = append(extra, x["id"])
				}
				snapshot := func() []M {
					v, e := a.query(ctx, "SELECT jsonb_build_object('servers',(SELECT jsonb_agg(s) FROM servers s),'allocations',(SELECT jsonb_agg(x) FROM allocations x),'variables',(SELECT jsonb_agg(v) FROM server_variables v),'secrets',(SELECT jsonb_agg(z) FROM server_integration_secrets z)) AS state")
					if e != nil {
						t.Fatal(e)
					}
					return v
				}
				before := snapshot()
				calls := f.Creates
				input := M{"name": "Wave125", "user": admin, "egg": imported["id"], "docker_image": image, "startup": egg["startup"], "environment": env, "limits": M{"memory": 8192, "disk": 32768, "swap": 0, "io": 500, "cpu": 0}, "feature_limits": M{"databases": 0, "backups": 0, "allocations": len(extra)}, "allocation": M{"default": rows[0]["id"], "additional": extra}}
				mux := http.NewServeMux()
				a.registerLifecycle(mux)
				want := 201
				invalid := mode == "one" || mode == "cross"
				if invalid && os.Getenv("WAVE125_BASELINE") == "" {
					want = 422
				}
				infraExpect(t, mux, admin, "POST", "/api/application/servers", input, want)
				if invalid && want == 422 {
					if !reflect.DeepEqual(before, snapshot()) || f.Creates != calls {
						t.Fatal("rejection wrote or provisioned")
					}
				} else if f.Creates != calls+1 {
					t.Fatal("create not provisioned")
				}
				t.Logf("recipe=%s mode=%s status=%d wings_delta=%d", recipe, mode, want, f.Creates-calls)
			})
		}
	}
}

func TestWave130DescriptorAudit(t *testing.T) {
	for _, e := range gameTemplates().Entries {
		if e.RequiredPorts > 1 || len(e.PortRules) > 0 || e.PrimaryPortEnv != "" {
			t.Logf("path=%s required=%d rules=%d primary=%s consecutive=%v", e.Path, e.RequiredPorts, len(e.PortRules), e.PrimaryPortEnv, e.ConsecutivePorts)
		}
	}
}

func TestWave130L4D2API(t *testing.T) {
	for _, route := range []string{"template", "direct"} {
		for _, value := range []string{"0", "1", "1024", "1025", "65535", "65536", "-1", "7777"} {
			t.Run(route+"/"+value, func(t *testing.T) {
				var schema string
				t.Cleanup(func() {
					p, e := pgxpool.New(context.Background(), isolatedTestDatabaseURL(t))
					if e != nil {
						t.Error("cleanup connection")
						return
					}
					defer p.Close()
					var exists bool
					if e = p.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", schema).Scan(&exists); e != nil || exists {
						t.Error("schema remains")
					}
				})
				a, _, admin, node, f := steamGamesFixture(t)
				schema = a.DB.Config().ConnConfig.RuntimeParams["search_path"]
				ctx := context.Background()
				var entry gameTemplate
				for _, e := range gameTemplates().Entries {
					if e.Path == "left4dead_2/egg-left4dead_2.json" {
						entry = e
					}
				}
				egg, vars, e := parseEggDocument(entry.Egg)
				if e != nil {
					t.Fatal(e)
				}
				env := M{}
				for _, v := range vars {
					env[str(v["env_variable"])] = v["default_value"]
				}
				env["SRCDS_CPORT"] = value
				image := ""
				for _, v := range asMap(egg["docker_images"]) {
					image = str(v)
					break
				}
				allocs, e := a.query(ctx, "SELECT * FROM allocations WHERE node_id=$1 ORDER BY id", node["id"])
				if e != nil {
					t.Fatal(e)
				}
				mux := http.NewServeMux()
				a.registerLifecycle(mux)
				a.registerGameTemplates(mux)
				path := "/api/client/game-library/templates/" + entry.ID + "/install"
				input := M{"name": "Wave130 L4D2", "request_id": newUUID(), "memory": 8192, "disk": 32768, "image": image, "allocation_id": allocs[0]["id"], "allocation_additional": []any{}, "environment": env}
				if route == "direct" {
					imported, e := a.ensureGameTemplateEgg(ctx, entry, egg, vars)
					if e != nil {
						t.Fatal(e)
					}
					path = "/api/application/servers"
					input = M{"name": "Wave130 L4D2", "user": admin, "egg": imported["id"], "docker_image": image, "startup": egg["startup"], "environment": env, "limits": M{"memory": 8192, "disk": 32768, "swap": 0, "io": 500, "cpu": 0}, "feature_limits": M{"allocations": 0, "databases": 0, "backups": 0}, "allocation": M{"default": allocs[0]["id"], "additional": []any{}}}
				}
				counter := &cfxCountingTransport{next: a.HTTP.Transport}
				if counter.next == nil {
					counter.next = http.DefaultTransport
				}
				a.HTTP.Transport = counter
				snapshot := func() []M {
					out := []M{}
					names, e := a.query(ctx, "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")
					if e != nil {
						t.Fatal(e)
					}
					for _, n := range names {
						rows, e := a.query(ctx, "SELECT to_jsonb(x) AS row FROM "+pgx.Identifier{str(n["tablename"])}.Sanitize()+" x ORDER BY to_jsonb(x)::text")
						if e != nil {
							t.Fatal(e)
						}
						out = append(out, M{"table": n["tablename"], "rows": rows})
					}
					return out
				}
				before := snapshot()
				calls := counter.calls.Load()
				creates := f.Creates
				valid := value == "0" || value == "1025" || value == "65535"
				want := 422
				if valid {
					want = 201
				}
				infraExpect(t, mux, admin, "POST", path, input, want)
				if !valid {
					if !reflect.DeepEqual(before, snapshot()) || counter.calls.Load() != calls || f.Creates != creates {
						t.Fatal("refusal changed tables or made HTTP call")
					}
				} else {
					if f.Creates != creates+1 {
						t.Fatal("no provisioning")
					}
					rows, e := a.query(ctx, "SELECT * FROM allocations WHERE server_id IS NOT NULL")
					if e != nil || len(rows) != 1 {
						t.Fatal("client port reserved allocation")
					}
					rows, e = a.query(ctx, "SELECT variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE ev.env_variable='SRCDS_CPORT'")
					if e != nil || len(rows) != 1 || str(rows[0]["variable_value"]) != value {
						t.Fatal("client port meaning changed")
					}
				}
				t.Logf("HTTP %s client=%s status=%d creates=%d calls=%d", route, value, want, f.Creates-creates, counter.calls.Load()-calls)
			})
		}
	}
}
