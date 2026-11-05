package panel

import (
	"context"
	"net/http"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestUnturnedWave85Admission(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		for _, mode := range []string{"invalid", "lan", "offline", "public"} {
			t.Run(mode+map[bool]string{false: "/manual", true: "/automatic"}[automatic], func(t *testing.T) {
				var ownedSchema string
				t.Cleanup(func() {
					if ownedSchema == "" {
						return
					}
					pool, err := pgxpool.New(context.Background(), os.Getenv("TEST_DATABASE_URL"))
					if err != nil {
						t.Error("cleanup verification connection failed")
						return
					}
					defer pool.Close()
					var exists bool
					if err := pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", ownedSchema).Scan(&exists); err != nil || exists {
						t.Error("owned schema cleanup failed")
					}
				})
				a, _, admin, node, wings := steamGamesFixture(t)
				ownedSchema = a.DB.Config().ConnConfig.RuntimeParams["search_path"]
				mux := http.NewServeMux()
				a.registerGameTemplates(mux)
				var entry gameTemplate
				for _, v := range gameTemplates().Entries {
					if v.Path == "unturned/egg-unturned.json" {
						entry = v
					}
				}
				image := ""
				for _, v := range asMap(entry.Egg["docker_images"]) {
					image = str(v)
					break
				}
				ctx := context.Background()
				primary, err := a.one(ctx, "SELECT id FROM allocations WHERE port=9000 AND node_id=$1", node["id"])
				if err != nil {
					t.Fatal(err)
				}
				secondary, err := a.one(ctx, "SELECT id FROM allocations WHERE port=9001 AND node_id=$1", node["id"])
				if err != nil {
					t.Fatal(err)
				}
				snapshot := func() M {
					v, e := a.one(ctx, `SELECT (SELECT jsonb_agg(to_jsonb(a) ORDER BY id)::text FROM allocations a) allocations,(SELECT count(*) FROM servers) servers,(SELECT count(*) FROM eggs) eggs,(SELECT count(*) FROM egg_variables) variables,(SELECT count(*) FROM nests) nests,(SELECT count(*) FROM server_variables) server_variables,(SELECT jsonb_agg(to_jsonb(s) ORDER BY key)::text FROM settings s) settings`)
					if e != nil {
						t.Fatal(e)
					}
					return v
				}
				env := M{"AUTO_UPDATE": "0"}
				if mode == "invalid" || mode == "public" {
					env["PUBLIC_SERVER"] = "1"
					env["GSLT"] = "FixtureShapedToken123"
				}
				if mode == "invalid" || mode == "offline" {
					env["OFFLINE_ONLY"] = "1"
				}
				input := M{"name": "Unturned admission fixture", "request_id": newUUID(), "memory": 4096, "disk": 16384, "image": image, "environment": env}
				if automatic {
					input["automatic_ports"] = true
					input["node_id"] = node["id"]
				} else {
					input["allocation_id"] = primary["id"]
					input["allocation_additional"] = []any{secondary["id"]}
				}
				endpoint := "/api/client/game-library/templates/" + entry.ID
				before := snapshot()
				if mode == "invalid" {
					for _, route := range []string{"ports", "install"} {
						input["node_id"] = node["id"]
						got := infraExpect(t, mux, admin, "POST", endpoint+"/"+route, input, 422)
						if str(asMap(asSlice(got["errors"])[0])["code"]) != "GameSetupValidationFailed" {
							t.Fatal("missing targeted error")
						}
					}
					if !reflect.DeepEqual(before, snapshot()) || wings.Creates != 0 || wings.Writes != 0 {
						t.Fatal("invalid mode mutated database or Wings")
					}
					return
				}
				infraExpect(t, mux, admin, "POST", endpoint+"/install", input, 201)
				if wings.Creates != 1 {
					t.Fatal("valid mode did not provision mock Wings")
				}
			})
		}
	}
}

func TestUnturnedWave85Normalization(t *testing.T) {
	var entry gameTemplate
	for _, v := range gameTemplates().Entries {
		if v.Path == "unturned/egg-unturned.json" {
			entry = v
		}
	}
	_, vars, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{"1", true, 1, float64(1)} {
		env := M{"PUBLIC_SERVER": value, "OFFLINE_ONLY": value}
		if validateTemplateSetupEnvironment(nil, entry.Egg, env) == nil {
			t.Fatal("normalized incompatible modes accepted")
		}
		_, err := templateEnvironment(vars, env)
		if _, ok := value.(string); ok {
			if err != nil {
				t.Fatal(err)
			}
		} else if err == nil {
			t.Fatal("template API accepted non-string environment")
		}
	}
}
