package panel

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type sunkenlandConsentTransport struct {
	base     http.RoundTripper
	calls    int
	payloads [][]byte
}

func (s *sunkenlandConsentTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	s.calls++
	if r.Body != nil {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, err
		}
		s.payloads = append(s.payloads, body)
		r.Body = io.NopCloser(strings.NewReader(string(body)))
	}
	return s.base.RoundTrip(r)
}

func TestSunkenlandConsentAPI(t *testing.T) {
	var cleanupControl *pgxpool.Pool
	var ownedSchema string
	t.Cleanup(func() {
		if cleanupControl == nil {
			return
		}
		defer cleanupControl.Close()
		var exists bool
		if err := cleanupControl.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", ownedSchema).Scan(&exists); err != nil || exists {
			t.Error("owned fixture schema cleanup failed", err)
		} else {
			t.Log("owned isolated schema removal verified")
		}
	})
	a, _, admin, node, wings := steamGamesFixture(t)
	var cleanupErr error
	cleanupControl, cleanupErr = pgxpool.NewWithConfig(context.Background(), a.DB.Config().Copy())
	if cleanupErr != nil {
		t.Fatal(cleanupErr)
	}
	if err := a.DB.QueryRow(context.Background(), "SELECT current_schema()").Scan(&ownedSchema); err != nil {
		t.Fatal(err)
	}
	// Observe every outbound HTTP call, including platform probes and payloads.
	transport := &sunkenlandConsentTransport{base: http.DefaultTransport}
	a.HTTP.Transport = transport
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "sunkenland/egg-sunkenland.json" {
			entry = candidate
			break
		}
	}
	if entry.ID == "" {
		t.Fatal("Sunkenland recipe missing")
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	if env["ACCEPT_WINDOWS_RUNTIME_LICENSES"] != "false" {
		t.Fatal("consent default changed")
	}
	var image string
	for _, value := range asMap(egg["docker_images"]) {
		image = str(value)
		break
	}
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	ctx := context.Background()
	// Snapshot every fixture-owned table, including full allocation bindings,
	// reservations, imported metadata and audit/config rows, not just row counts.
	snapshot := func() map[string]string {
		rows, err := a.DB.Query(ctx, "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")
		if err != nil {
			t.Fatal(err)
		}
		var tables []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			tables = append(tables, name)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, name := range tables {
			var data string
			if err := a.DB.QueryRow(ctx, "SELECT COALESCE(jsonb_agg(row ORDER BY row::text), '[]'::jsonb)::text FROM (SELECT to_jsonb(t) AS row FROM "+pgx.Identifier{name}.Sanitize()+" t) s").Scan(&data); err != nil {
				t.Fatal(err)
			}
			out[name] = data
		}
		return out
	}
	before := snapshot()
	files, _ := json.Marshal(wings.Files)
	for _, automatic := range []bool{false, true} {
		input := M{"name": "Sunkenland consent fixture", "request_id": newUUID(), "image": image, "memory": 8192, "disk": 24576, "environment": env}
		if automatic {
			input["automatic_ports"] = true
			input["node_id"] = node["id"]
		} else {
			allocation, err := a.one(ctx, "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id LIMIT 1", node["id"])
			if err != nil {
				t.Fatal(err)
			}
			input["allocation_id"] = allocation["id"]
		}
		for _, tc := range []struct {
			name  string
			value any
		}{
			{"missing", nil}, {"false_boolean", false}, {"false_string", "false"}, {"true_boolean", true}, {"number", 1}, {"object", M{"value": "true"}}, {"array", []any{"true"}}, {"uppercase", "TRUE"}, {"whitespace", " true "},
		} {
			t.Run(tc.name+map[bool]string{true: "_automatic", false: "_manual"}[automatic], func(t *testing.T) {
				if tc.value == nil {
					delete(env, "ACCEPT_WINDOWS_RUNTIME_LICENSES")
				} else {
					env["ACCEPT_WINDOWS_RUNTIME_LICENSES"] = tc.value
				}
				status, response, _ := infraRequest(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input)
				encoded, _ := json.Marshal(response)
				if status != 422 || !strings.Contains(string(encoded), "ACCEPT_WINDOWS_RUNTIME_LICENSES") {
					t.Fatal("missing targeted consent error")
				}
				if !reflect.DeepEqual(before, snapshot()) {
					t.Fatal("refusal changed fixture rows or allocation bindings")
				}
				afterFiles, _ := json.Marshal(wings.Files)
				if transport.calls != 0 || len(transport.payloads) != 0 || wings.Creates != 0 || wings.Writes != 0 || string(files) != string(afterFiles) {
					t.Fatal("refusal reached daemon or changed payload")
				}
			})
		}
	}
	env["ACCEPT_WINDOWS_RUNTIME_LICENSES"] = "true"
	input := M{"name": "Sunkenland consent accepted", "request_id": newUUID(), "image": image, "memory": 8192, "disk": 24576, "environment": env, "automatic_ports": true, "node_id": node["id"]}
	created := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input, 201)["attributes"])
	var delivered int
	if err := a.DB.QueryRow(ctx, "SELECT count(*) FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id JOIN servers s ON s.id=sv.server_id WHERE s.uuid_short=$1 AND ev.env_variable='ACCEPT_WINDOWS_RUNTIME_LICENSES' AND sv.variable_value='true'", created["identifier"]).Scan(&delivered); err != nil || delivered != 1 {
		t.Fatal("explicit consent not persisted", err)
	}
	if wings.Creates != 1 || transport.calls == 0 {
		t.Fatal("valid provisioning mock not reached")
	}
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", created["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	config, err := a.serverConfig(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	if asMap(config["environment"])["ACCEPT_WINDOWS_RUNTIME_LICENSES"] != "true" {
		t.Fatal("server config lost runtime consent")
	}
	if len(transport.payloads) != 1 {
		t.Fatal("unexpected provisioning payload count")
	}
	var payload M
	if err := json.Unmarshal(transport.payloads[0], &payload); err != nil || payload["uuid"] != server["uuid"] || payload["start_on_completion"] != false {
		t.Fatal("existing create protocol changed", err)
	}
}
