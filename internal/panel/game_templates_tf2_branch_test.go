package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

type wave103Transport struct {
	base  http.RoundTripper
	calls int
}

func (w *wave103Transport) RoundTrip(r *http.Request) (*http.Response, error) {
	w.calls++
	return w.base.RoundTrip(r)
}
func TestWave103TF2Branch(t *testing.T) {
	valid := []string{"", "public", "preview_1.a-b", "A", "0", strings.Repeat("a", 64)}
	invalid := []string{".preview", "_preview", "-preview", "a b", "a+quit", "a\n", strings.Repeat("a", 65)}
	for _, branch := range append(valid, invalid...) {
		t.Run(branch, func(t *testing.T) {
			a, _, admin, node, _ := steamGamesFixture(t)
			ctx := context.Background()
			mux := http.NewServeMux()
			a.registerGameTemplates(mux)
			a.registerLifecycle(mux)
			a.registerOperations(mux)
			transport := &wave103Transport{base: http.DefaultTransport}
			a.HTTP.Transport = transport
			var entry gameTemplate
			for _, e := range gameTemplates().Entries {
				if e.Path == "team_fortress_2/egg-team-fortress-2.json" {
					entry = e
				}
			}
			eggDoc, vars, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, v := range vars {
				env[str(v["env_variable"])] = v["default_value"]
			}
			env["SRCDS_BETAID"] = branch
			image := ""
			for _, v := range asMap(entry.Egg["docker_images"]) {
				image = str(v)
				break
			}
			snapshot := func() string {
				row, e := a.one(ctx, `SELECT json_build_array((SELECT coalesce(json_agg(s ORDER BY id),'[]') FROM servers s),(SELECT coalesce(json_agg(a ORDER BY id),'[]') FROM allocations a),(SELECT coalesce(json_agg(v ORDER BY id),'[]') FROM server_variables v))::text AS value`)
				if e != nil {
					t.Fatal(e)
				}
				return str(row["value"])
			}
			before := snapshot()
			status := 201
			if len(branch) > 64 || branch != "" && strings.ContainsAny(branch[:1], "._-") || strings.ContainsAny(branch, " +\n") {
				status = 422
			}
			input := M{"name": "TF2 fixture", "request_id": newUUID(), "node_id": node["id"], "memory": 4096, "disk": 32768, "image": image, "environment": env, "automatic_ports": true}
			result := infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input, status)
			if status == 422 {
				if snapshot() != before || transport.calls != 0 {
					t.Fatal("invalid template mutated or called daemon")
				}
			}
			egg, e := a.ensureGameTemplateEgg(ctx, entry, eggDoc, vars)
			if e != nil {
				t.Fatal(e)
			}
			var allocation int64
			if e = a.DB.QueryRow(ctx, "SELECT id FROM allocations WHERE node_id=$1 AND server_id IS NULL ORDER BY id LIMIT 1", node["id"]).Scan(&allocation); e != nil {
				t.Fatal(e)
			}
			// Branch admission needs an otherwise valid three-role TF2 layout.
			// These are fixture resources, created before the request snapshot.
			primary, e := a.one(ctx, "SELECT ip FROM allocations WHERE id=$1", allocation)
			if e != nil {
				t.Fatal(e)
			}
			candidates, e := a.query(ctx, "SELECT candidate AS port FROM generate_series(30000,65000) candidate WHERE NOT EXISTS (SELECT 1 FROM allocations WHERE node_id=$1 AND ip=$2 AND port=candidate) ORDER BY candidate LIMIT 2", node["id"], primary["ip"])
			if e != nil || len(candidates) != 2 {
				t.Fatal("missing fixture service ports", e)
			}
			additional := []any{}
			for _, candidate := range candidates {
				row, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": primary["ip"], "port": candidate["port"]})
				if err != nil {
					t.Fatal(err)
				}
				additional = append(additional, row["id"])
			}
			direct := M{"name": "Direct TF2", "user": admin, "egg": egg["id"], "docker_image": image, "startup": entry.Egg["startup"], "environment": env, "limits": M{"memory": 4096, "swap": 0, "disk": 32768, "io": 500, "cpu": 0}, "feature_limits": M{"databases": 0, "allocations": 3, "backups": 0}, "allocation": M{"default": allocation, "additional": additional}, "start_on_completion": false}
			before = snapshot()
			calls := transport.calls
			directStatus := status
			if branch == "a\n" {
				directStatus = 201
			}
			directResult := infraExpect(t, mux, admin, "POST", "/api/application/servers", direct, directStatus)
			if branch == "a\n" {
				if str(asMap(asMap(asMap(directResult["attributes"])["container"])["environment"])["SRCDS_BETAID"]) != "a" {
					t.Fatal("direct normalization mismatch")
				}
				return
			}
			if status == 422 {
				if snapshot() != before || transport.calls != calls {
					t.Fatal("invalid direct create mutated or called daemon")
				}
				return
			}
			s := asMap(result["attributes"])
			server, e := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", s["identifier"])
			if e != nil {
				t.Fatal(e)
			}
			if _, e = a.DB.Exec(ctx, "UPDATE servers SET status=NULL,installed_at=NOW() WHERE id=$1", server["id"]); e != nil {
				t.Fatal(e)
			}
			for _, badBranch := range append(append([]string{}, invalid...), valid...) {
				if badBranch == "a\n" {
					continue
				}
				want := 422
				for _, v := range valid {
					if v == badBranch {
						want = 200
					}
				}
				for _, adminPath := range []bool{false, true} {
					before = snapshot()
					calls = transport.calls
					method := "PUT"
					path := "/api/client/servers/" + str(server["uuid"]) + "/startup/variable"
					body := M{"key": "SRCDS_BETAID", "value": badBranch}
					if adminPath {
						method = "PATCH"
						path = "/api/application/servers/" + str(server["id"]) + "/startup"
						body = M{"environment": M{"SRCDS_BETAID": badBranch}}
					}
					infraExpect(t, mux, admin, method, path, body, want)
					if want == 422 && (snapshot() != before || transport.calls != calls) {
						t.Fatal("invalid startup mutated or called daemon")
					}
				}
			}
		})
	}
}
