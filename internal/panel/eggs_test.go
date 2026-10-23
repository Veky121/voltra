package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func eggFixture() M {
	return M{"meta": M{"version": "PTDL_v2"}, "name": "Fixture", "author": "test@example.com", "docker_images": M{"Alpine": "alpine:3.23"}, "startup": "echo {{VALUE}}", "config": M{"files": `{"server.properties":{"parser":"properties","find":{"port":"{{server.build.default.port}}"}}}`, "startup": `{"done":"ready"}`, "logs": `{}`, "stop": "^SIGINT"}, "scripts": M{"installation": M{"script": "echo install", "entrypoint": "sh", "container": "alpine:3.23"}}, "variables": []any{M{"name": "Value", "description": "A value", "env_variable": "VALUE", "default_value": "ok", "user_viewable": true, "user_editable": true, "rules": "required|string|max:20"}}}
}

func TestEggV1AndV2Parsing(t *testing.T) {
	for _, version := range []string{"PTDL_v1", "PTDL_v2"} {
		t.Run(version, func(t *testing.T) {
			d := eggFixture()
			d["meta"] = M{"version": version}
			if version == "PTDL_v1" {
				delete(d, "docker_images")
				d["images"] = []any{"alpine:3.23", "debian:stable"}
			}
			egg, vars, err := parseEggDocument(d)
			if err != nil {
				t.Fatal(err)
			}
			if str(egg["name"]) != "Fixture" || len(vars) != 1 {
				t.Fatalf("wrong parse: %#v %#v", egg, vars)
			}
			if version == "PTDL_v1" && str(asMap(egg["docker_images"])["debian:stable"]) != "debian:stable" {
				t.Fatal("v1 images conversion lost image")
			}
			if str(asMap(egg["config_startup"])["done"]) != "ready" {
				t.Fatal("serialized config not decoded")
			}
		})
	}
	d := eggFixture()
	d["meta"] = M{"version": "unknown"}
	if _, _, err := parseEggDocument(d); err == nil {
		t.Fatal("unknown version accepted")
	}
	d = eggFixture()
	asMap(d["config"])["files"] = "broken"
	if _, _, err := parseEggDocument(d); err == nil {
		t.Fatal("broken config accepted")
	}
}

func TestEggVariableRules(t *testing.T) {
	tests := []struct {
		rules string
		value any
		valid bool
	}{
		{"required|string|max:5", "hello", true}, {"required|string|max:5", "longer", false}, {"required|integer|min:10", "9", false}, {"required|integer|min:10", "10", true},
		{"required|string|min:3", "12", false}, {"required|numeric|between:0,1", "0.5", true}, {"required|integer", "1.2", false}, {"nullable|integer", "", true}, {"required|nullable", "", false},
		{"required|boolean", "true", false}, {"required|boolean", "1", true}, {"required|boolean", true, true}, {"required|boolean", "yes", false}, {"required|string|in:one,two", "two", true}, {"required|string|not_in:one,two", "two", false},
		{"required|integer", "01", false}, {"required|numeric", "NaN", false}, {"present|string", nil, false}, {"present|nullable|string", nil, true},
		{"required|regex:/^(one|two)$/i|max:4", "TWO", true}, {"required|regex:/^(one|two)$/i|max:4", "three", false}, {"required|regex:/^(?!bad)[a-z]+$/", "good", true},
		{"required|regex:/^(?!bad)[a-z]+$/", "bad", false}, {`required|not_regex:/^\d+$/`, "abc", true}, {"required|digits_between:3,5", "0123", true}, {"required|digits:3", "12x", false},
		{"required|alpha_dash", "a-ä_1", true}, {"required|alpha_num", "a-1", false}, {"required|url", "https://example.com/file", true}, {"required|url", "no-url", false},
		{"required|regex:/^a\\/b$/", "a/b", true}, {"required_if:environment.MODE,on", "", false}, {"required_unless:environment.MODE,on", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.rules+":"+str(tt.value), func(t *testing.T) {
			err := validateEggValue(tt.value, true, tt.rules, M{"MODE": "on"})
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%v error=%v", tt.valid, err)
			}
		})
	}
	if err := validateEggRules("required|unknown_rule"); err == nil {
		t.Fatal("unknown rule silently accepted")
	}
	if err := validateEggValue(nil, false, "present", M{}); err == nil {
		t.Fatal("missing present accepted")
	}
	if err := validateEggValue(nil, false, "sometimes|required", M{}); err != nil {
		t.Fatal(err)
	}
}

func TestEggDaemonConfig(t *testing.T) {
	e, _, err := parseEggDocument(eggFixture())
	if err != nil {
		t.Fatal(err)
	}
	e["config_files"] = M{"server.properties": M{"parser": "properties", "find": M{"port": "{{env.SERVER_PORT}}", "ip": "{{server.build.default.ip}}", "interface": "{{config.docker.interface}}", "conditional": M{"default": "{{env.VALUE}}"}, "numeric": 123, "plain": "{{UNTOUCHED}}"}}, "invalid": "ignored"}
	cfg := eggDaemonConfig(e, M{"build": M{"default": M{"ip": "127.0.0.1", "port": int64(25565)}, "env": M{"VALUE": "hello"}}})
	if str(asMap(cfg["stop"])["value"]) != "SIGINT" {
		t.Fatal(cfg)
	}
	if !reflect.DeepEqual(asMap(cfg["startup"])["done"], []any{"ready"}) {
		t.Fatal(cfg)
	}
	configs := asSlice(cfg["configs"])
	if len(configs) != 1 {
		t.Fatalf("configs=%#v", configs)
	}
	replacements := asSlice(asMap(configs[0])["replace"])
	byMatch := M{}
	for _, r := range replacements {
		v := asMap(r)
		byMatch[str(v["match"])] = v["replace_with"]
	}
	if str(byMatch["port"]) != "25565" || str(byMatch["ip"]) != "127.0.0.1" || str(byMatch["interface"]) != "{{config.docker.network.interface}}" || str(byMatch["numeric"]) != "123" || str(byMatch["conditional"]) != "hello" || str(byMatch["plain"]) != "{{UNTOUCHED}}" {
		t.Fatalf("wrong replacements %#v", byMatch)
	}
}

func TestEggUpstreamCorpus(t *testing.T) {
	root := filepath.Join("..", "..", "..", "pterodactyl-vite", "upstream")
	if _, err := os.Stat(root); os.IsNotExist(err) {
		t.Skip("Optional full upstream checkout is absent; shipped recipes are covered by bundled catalog tests")
	} else if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, name := range []string{"game-eggs", "application-eggs", "generic-eggs"} {
		err := filepath.WalkDir(filepath.Join(root, name), func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".json") {
				return nil
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			var d M
			if json.Unmarshal(b, &d) != nil {
				return nil
			}
			if !strings.HasPrefix(str(asMap(d["meta"])["version"]), "PTDL_") {
				return nil
			}
			count++
			t.Run(filepath.ToSlash(strings.TrimPrefix(path, root)), func(t *testing.T) {
				egg, vars, err := parseEggDocument(d)
				if err != nil {
					t.Fatal(err)
				}
				if len(asMap(egg["docker_images"])) == 0 {
					t.Fatal("missing images")
				}
				if len(vars) != len(asSlice(d["variables"])) {
					t.Fatal("variables lost")
				}
				for _, v := range vars {
					if err := validateEggRules(str(v["rules"])); err != nil {
						t.Fatalf("Corpus runtime rule unsupported: %v", err)
					}
				}
				if str(egg["script_install"]) != str(asMap(asMap(d["scripts"])["installation"])["script"]) {
					t.Fatal("script modified")
				}
				encoded, err := json.Marshal(egg)
				if err != nil || len(encoded) == 0 {
					t.Fatal(err)
				}
			})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if count < 300 {
		t.Fatalf("only %d corpus eggs found, expected full repository", count)
	}
	t.Logf("Parsed %d upstream PTDL eggs with all variable rules compiled", count)
}

func eggDatabaseApp(t *testing.T) *App {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; PostgreSQL integration test requires real database")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = base.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	namespace := "eggs_test_" + randomToken(6)
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+namespace); err != nil {
		base.Close()
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		base.Close()
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = namespace
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		base.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close(); base.Exec(ctx, "DROP SCHEMA "+namespace+" CASCADE"); base.Close() })
	if _, err = pool.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	return &App{DB: pool}
}
func TestEggPostgresImportUpdateInheritance(t *testing.T) {
	a := eggDatabaseApp(t)
	ctx := context.Background()
	n, err := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "egg-test-" + randomToken(6), "author": "test@example.com", "description": "test"})
	if err != nil {
		t.Fatal(err)
	}
	nestID := num(n["id"])
	t.Cleanup(func() {
		a.exec(ctx, "DELETE FROM eggs WHERE nest_id=$1", nestID)
		a.exec(ctx, "DELETE FROM nests WHERE id=$1", nestID)
	})
	e, vars, err := parseEggDocument(eggFixture())
	if err != nil {
		t.Fatal(err)
	}
	e["nest_id"] = nestID
	egg, err := a.importEggRecord(ctx, 0, e, vars)
	if err != nil {
		t.Fatal(err)
	}
	id := num(egg["id"])
	before, err := a.eggVariables(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	vars[0]["default_value"] = "changed"
	egg, err = a.importEggRecord(ctx, id, e, vars)
	if err != nil {
		t.Fatal(err)
	}
	after, err := a.eggVariables(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if before[0]["id"] != after[0]["id"] || str(after[0]["default_value"]) != "changed" {
		t.Fatal("variable identity not preserved")
	}
	exported, err := a.eggExport(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	roundtrip, roundVars, err := parseEggDocument(exported)
	if err != nil {
		t.Fatal(err)
	}
	if str(roundtrip["script_install"]) != str(e["script_install"]) || len(roundVars) != 1 {
		t.Fatal("roundtrip mismatch")
	}
	if _, err = a.validateEggEnvironment(ctx, id, M{}, false); err == nil {
		t.Fatal("missing required environment silently received defaults")
	}
	env, err := a.validateEggEnvironment(ctx, id, M{"VALUE": "changed"}, false)
	if err != nil || str(env["VALUE"]) != "changed" {
		t.Fatalf("explicit environment %#v %v", env, err)
	}
	if _, err = a.validateEggEnvironment(ctx, id, M{"VALUE": strings.Repeat("x", 21)}, false); err == nil {
		t.Fatal("invalid environment accepted")
	}
	child := M{}
	for k, v := range e {
		child[k] = v
	}
	child["uuid"] = newUUID()
	child["name"] = "Child"
	child["config_files"] = nil
	child["config_startup"] = nil
	child["config_logs"] = nil
	child["config_stop"] = nil
	child["features"] = nil
	child["script_install"] = nil
	child["config_from"] = id
	child["copy_script_from"] = id
	c, err := a.insert(ctx, "eggs", child)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.exec(ctx, "DELETE FROM eggs WHERE id=$1", c["id"]) })
	effective, err := a.effectiveEgg(ctx, num(c["id"]))
	if err != nil {
		t.Fatal(err)
	}
	if str(effective["script_install"]) != "echo install" || str(effective["config_stop"]) != "^SIGINT" || !reflect.DeepEqual(effective["config_files"], egg["config_files"]) {
		t.Fatal("inheritance mismatch")
	}
	if err = a.validateEggParents(ctx, M{"nest_id": nestID, "config_from": c["id"]}, id); err == nil {
		t.Fatal("inheritance cycle accepted")
	}
	r := httptest.NewRequest(http.MethodGet, "/api/application/nests/1/eggs/1?include=variables,config,script", nil)
	attrs, err := a.eggAttributes(r, egg)
	if err != nil {
		t.Fatal(err)
	}
	if num(attrs["nest"]) != nestID || asMap(attrs["relationships"])["variables"] == nil {
		t.Fatal("application transformer incomplete")
	}
	// Verify failed variable import rolls back the preceding egg UPDATE.
	e["name"] = "Must Roll Back"
	if _, err = a.importEggRecord(ctx, id, e, []M{{"env_variable": "BROKEN", "name": nil}}); err == nil {
		t.Fatal("invalid import did not fail")
	}
	got, err := a.one(ctx, "SELECT name FROM eggs WHERE id=$1", id)
	if err != nil {
		t.Fatal(err)
	}
	if str(got["name"]) != "Fixture" {
		t.Fatalf("transaction committed partial update: %v", got)
	}
	t.Log(fmt.Sprintf("PostgreSQL egg %d: stable variable IDs, export/import, validation and inheritance verified", id))
}

func TestEggPostgresCorpusRoundtrip(t *testing.T) {
	a := eggDatabaseApp(t)
	ctx := context.Background()
	nest, err := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "corpus", "author": "test@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join("..", "..", "..", "pterodactyl-vite", "upstream")
	count := 0
	for _, name := range []string{"game-eggs", "application-eggs", "generic-eggs"} {
		err := filepath.WalkDir(filepath.Join(root, name), func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".json") {
				return nil
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			var d M
			if json.Unmarshal(b, &d) != nil || !strings.HasPrefix(str(asMap(d["meta"])["version"]), "PTDL_") {
				return nil
			}
			count++
			t.Run(filepath.ToSlash(strings.TrimPrefix(path, root)), func(t *testing.T) {
				e, vars, err := parseEggDocument(d)
				if err != nil {
					t.Fatal(err)
				}
				e["nest_id"] = nest["id"]
				row, err := a.importEggRecord(ctx, 0, e, vars)
				if err != nil {
					t.Fatal(err)
				}
				out, err := a.eggExport(ctx, num(row["id"]))
				if err != nil {
					t.Fatal(err)
				}
				roundtrip, roundVars, err := parseEggDocument(out)
				if err != nil {
					t.Fatal(err)
				}
				for _, key := range []string{"name", "author", "description", "features", "docker_images", "file_denylist", "startup", "config_files", "config_startup", "config_logs", "config_stop", "script_install", "script_entry", "script_container", "update_url"} {
					if !reflect.DeepEqual(e[key], roundtrip[key]) {
						t.Errorf("%s changed in PostgreSQL export roundtrip: before=%#v after=%#v", key, e[key], roundtrip[key])
					}
				}
				if !reflect.DeepEqual(vars, roundVars) {
					t.Errorf("variable definitions changed: before=%#v after=%#v", vars, roundVars)
				}
			})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if count < 300 {
		t.Fatalf("incomplete corpus: %d", count)
	}
	t.Logf("Imported, exported and compared %d eggs through real PostgreSQL", count)
}

type eggNativeRuleCase struct {
	Name    string `json:"name"`
	Rules   string `json:"rules"`
	Value   any    `json:"value"`
	Present bool   `json:"present"`
	Env     M      `json:"env"`
	Pass    bool   `json:"pass"`
}

func eggNativeRuleCases() []eggNativeRuleCase {
	cases := []eggNativeRuleCase{}
	pair := func(name, rules string, valid, invalid any) {
		cases = append(cases, eggNativeRuleCase{name + "-valid", rules, valid, true, M{}, true}, eggNativeRuleCase{name + "-invalid", rules, invalid, true, M{}, false})
	}
	pair("multiple-int", "required|integer|multiple_of:2", "4", "3")
	pair("multiple-decimal", "required|numeric|multiple_of:0.1", "0.3", "0.31")
	pair("multiple-large", "required|integer|multiple_of:3", "9007199254740993", "9007199254740994")
	pair("hex3", "required|string|hex_color", "#a0F", "a0F")
	pair("hex4", "required|string|hex_color", "#a0F1", "#a0F12")
	pair("hex6", "required|string|hex_color", "#00ff00", "#00gg00")
	pair("hex8", "required|string|hex_color", "#00ff00AA", "#00ff00AAA")
	pair("mac-colon", "required|string|mac_address", "00:11:22:33:44:55", "00:11:22:33:44:GG")
	pair("mac-hyphen", "required|string|mac_address", "00-11-22-33-44-55", "00-11:22:33:44:55")
	pair("filled", "filled", "value", "")
	pair("equals-date", "required|date_equals:2026-10-21", "2026-10-21", "2026-10-22")
	pair("timezone", "required|timezone", "Europe/Berlin", "Not/A_Timezone")
	pair("timezone-country", "required|timezone:per_country,DE", "Europe/Berlin", "America/New_York")
	pair("timezone-canonical", "required|timezone", "America/New_York", "US/Eastern")
	pair("ulid", "required|ulid", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "81ARZ3NDEKTSV4RRFFQ69G5FAV")
	pair("regex-dollar", "required|regex:/^foo$/D", "foo", "foo\n")
	pair("encoding-ascii", "required|encoding:ASCII", "text", "héllo")
	pair("encoding-utf16", "required|encoding:UTF-16BE", "ab", "abc")
	pair("list", "list", []any{"a", "b"}, M{"x": "a"})
	pair("array-only", "array", M{"x": "a"}, "not-an-array")
	pair("array-in", "array|in:a,b", []any{"a", "b"}, []any{"a", "c"})
	pair("numeric-gt-exact", "gt:9007199254740992", "9007199254740993", "9007199254740992")
	pair("array-contains", "contains:a,b", []any{"a", "b", "c"}, []any{"a", "c"})
	pair("array-doesnt-contain", "doesnt_contain:x", []any{"a", "b"}, []any{"a", "x"})
	pair("required-keys", "required_array_keys:a,b", M{"a": 1, "b": 2}, M{"a": 1})
	pair("uuid-default", "required|uuid", "00000000-0000-0000-0000-000000000000", "invalid")
	pair("uuid-version", "required|uuid:4", "11111111-1111-4111-8111-111111111111", "11111111-1111-1111-8111-111111111111")
	pair("uuid-max", "required|uuid:max", "ffffffff-ffff-ffff-ffff-ffffffffffff", "00000000-0000-0000-0000-000000000000")
	pair("decimal-exponent", "required|decimal:2", "1.23", "1.2e3")
	pair("decimal-no-exponent", "required|decimal:0", "123", "1e3")
	pair("email-display-name", "required|email", "user@example.com", "Name <user@example.com>")
	pair("url-scheme", "required|url:https", "https://example.com", "http://example.com")
	pair("url-native-protocols", "required|url", "steam://example.com", "non_native_scheme://example.com")
	pair("url-native-path", "required|url", "https://example.com/a%20b", "https://example.com/a b")
	pair("url-unicode", "required|url", "https://example.com/日本語", "https://example.com/%ZZ")
	pair("url-native-port", "required|url", "https://example.com:999999", "https://example.com:invalid")
	pair("email-strict", "required|email:strict", "user@example.com", "user@localhost")
	pair("email-filter", "required|email:filter", "user@example.com", "é@example.com")
	pair("email-filter-unicode", "required|email:filter_unicode", "é@example.com", "user@localhost")
	add := func(name, rules string, value any, present bool, env M, pass bool) {
		cases = append(cases, eggNativeRuleCase{name, rules, value, present, env, pass})
	}
	for _, name := range []string{"accepted_if", "declined_if", "required_if", "present_if", "missing_if", "prohibited_if"} {
		rules := name + ":environment.OTHER,on"
		env := M{"OTHER": "on"}
		switch name {
		case "accepted_if":
			add(name+"-valid", rules, "yes", true, env, true)
			add(name+"-invalid", rules, "no", true, env, false)
		case "declined_if":
			add(name+"-valid", rules, "no", true, env, true)
			add(name+"-invalid", rules, "yes", true, env, false)
		case "required_if":
			add(name+"-valid", rules, "x", true, env, true)
			add(name+"-invalid", rules, "", true, env, false)
		case "present_if":
			add(name+"-valid", rules, nil, true, env, true)
			add(name+"-invalid", rules, nil, false, env, false)
		case "missing_if":
			add(name+"-valid", rules, nil, false, env, true)
			add(name+"-invalid", rules, nil, true, env, false)
		case "prohibited_if":
			add(name+"-valid", rules, "", true, env, true)
			add(name+"-invalid", rules, "x", true, env, false)
		}
	}
	add("filled-missing", "filled", nil, false, M{}, true)
	add("filled-null", "nullable|filled", nil, true, M{}, false)
	add("required-accepted", "required_if_accepted:environment.OTHER", "", true, M{"OTHER": true}, false)
	add("required-declined", "required_if_declined:environment.OTHER", "", true, M{"OTHER": false}, false)
	add("prohibited-accepted", "prohibited_if_accepted:environment.OTHER", "x", true, M{"OTHER": "1"}, false)
	add("prohibited-declined", "prohibited_if_declined:environment.OTHER", "x", true, M{"OTHER": "0"}, false)
	add("exclude-before-rules", "exclude_if:environment.OTHER,on|required|integer", "bad", true, M{"OTHER": "on"}, true)
	add("exclude-after-invalid", "integer|exclude_if:environment.OTHER,on", "bad", true, M{"OTHER": "on"}, false)
	add("exclude-required-first", "required|exclude", "", true, M{}, false)
	add("exclude-first", "exclude|required", "", true, M{}, true)
	add("exclude-with-null", "exclude_with:environment.OTHER|required", "", true, M{"OTHER": nil}, true)
	add("exclude-without-empty", "exclude_without:environment.OTHER|required", "", true, M{"OTHER": ""}, true)
	add("present-with-null", "present_with:environment.OTHER", nil, false, M{"OTHER": nil}, false)
	add("missing-with-null", "missing_with:environment.OTHER", nil, true, M{"OTHER": nil}, false)
	add("required-with-null", "required_with:environment.OTHER", nil, false, M{"OTHER": nil}, true)
	add("same-strict", "same:environment.OTHER", "1", true, M{"OTHER": 1}, false)
	add("same", "same:environment.OTHER", "x", true, M{"OTHER": "x"}, true)
	add("gt-type-mismatch", "gt:environment.OTHER", "long", true, M{"OTHER": 1}, false)
	add("gt-array-size", "gt:environment.OTHER", []any{1, 2}, true, M{"OTHER": []any{1}}, true)
	add("gt-array-size-invalid", "gt:environment.OTHER", []any{1}, true, M{"OTHER": []any{1, 2}}, false)
	add("in-array-wildcard-nested", "in_array:environment.OTHER.*.key", "found", true, M{"OTHER": []any{M{"key": "found"}}}, true)
	add("in-array-wildcard-nested-invalid", "in_array:environment.OTHER.*.key", "missing", true, M{"OTHER": []any{M{"key": "found"}}}, false)
	add("in-array-leaf", "in_array:environment.OTHER", "found", true, M{"OTHER": "found"}, true)
	add("confirmed", "confirmed", "x", true, M{"VALUE_confirmation": "x"}, true)
	add("confirmed-invalid", "confirmed", "x", true, M{"VALUE_confirmation": "y"}, false)
	add("prohibits", "prohibits:environment.OTHER", "x", true, M{"OTHER": "nonempty"}, false)
	add("required-flat-dependency-absent", "required_if:OTHER,on", "", true, M{"OTHER": "on"}, true)
	request := func(name, rules string, data M, pass bool) {
		value, present := data["value"]
		add(name, rules, value, present, M{"__egg_validation_data": data, "__egg_variable": "value"}, pass)
	}
	request("client-required-key-invalid", "required_if:key,TEST", M{"key": "TEST", "value": ""}, false)
	request("client-required-key-valid", "required_if:key,TEST", M{"key": "TEST", "value": "x"}, true)
	request("client-environment-absent", "required_if:environment.OTHER,on", M{"key": "TEST", "value": ""}, true)
	request("client-environment-explicit", "required_if:environment.OTHER,on", M{"key": "TEST", "value": "", "environment": M{"OTHER": "on"}}, false)
	request("client-same-key-valid", "same:key", M{"key": "TEST", "value": "TEST"}, true)
	request("client-same-key-invalid", "same:key", M{"key": "TEST", "value": "other"}, false)
	request("client-same-environment", "same:environment.OTHER", M{"key": "TEST", "value": "x", "environment": M{"OTHER": "x"}}, true)
	request("client-gt-environment-valid", "gt:environment.MIN", M{"key": "TEST", "value": "11", "environment": M{"MIN": "10"}}, true)
	request("client-gt-environment-invalid", "gt:environment.MIN", M{"key": "TEST", "value": "9", "environment": M{"MIN": "10"}}, false)
	request("client-confirmed", "confirmed", M{"key": "TEST", "value": "x", "value_confirmation": "x"}, true)
	request("client-confirmed-invalid", "confirmed", M{"key": "TEST", "value": "x", "value_confirmation": "y"}, false)
	return cases
}
func TestEggNativeScalarRules(t *testing.T) {
	for _, c := range eggNativeRuleCases() {
		t.Run(c.Name, func(t *testing.T) {
			err := validateEggValue(c.Value, c.Present, c.Rules, c.Env)
			if (err == nil) != c.Pass {
				t.Fatalf("pass=%v error=%v", c.Pass, err)
			}
		})
	}
}

func TestEggNativeBuiltinRuleInventory(t *testing.T) {
	path := filepath.Join("..", "..", "..", "pterodactyl-vite", "vendor", "laravel", "framework", "src", "Illuminate", "Validation", "Concerns", "ValidatesAttributes.php")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skip("Installed native Laravel validation source unavailable")
	}
	methods := regexp.MustCompile(`function validate([A-Z][A-Za-z]+)\(`).FindAllSubmatch(data, -1)
	count := 0
	for _, method := range methods {
		if string(method[1]) == "CurrentPassword" {
			continue
		}
		name := eggCanonicalRuleName(string(method[1]))
		if !eggParamContains(strings.Fields(eggSupportedRuleNames), name) {
			t.Errorf("Native builtin missing: %s", name)
		}
		count++
	}
	if count < 100 {
		t.Fatalf("Native inventory unexpectedly short: %d", count)
	}
	t.Logf("All %d installed non-auth native builtin rule names have implementations; custom PHP classes/extensions remain explicit errors", count)
}

func TestEggPostgresEditorValidation(t *testing.T) {
	a := eggDatabaseApp(t)
	ctx := context.Background()
	admin, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "egg-editor", "email": "editor@example.test", "root_admin": true})
	if err != nil {
		t.Fatal(err)
	}
	nest, err := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "Editor", "author": "editor@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.registerEggs(mux)
	request := func(method, path string, body M) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Content-Type", "application/json")
		r = WithUser(r, num(admin["id"]))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	valid := func() M {
		return M{"nest_id": nest["id"], "name": "Editor fixture", "docker_images": M{"Alpine": "alpine:latest"}, "startup": "echo ready", "config_stop": "stop", "config_files": M{}, "config_startup": M{"done": "ready"}, "config_logs": M{}}
	}
	for _, field := range []string{"startup", "config_stop", "config_files", "config_startup", "config_logs"} {
		body := valid()
		delete(body, field)
		w := request("POST", "/api/admin/eggs", body)
		if w.Code != 422 {
			t.Fatalf("Missing %s: %d %s", field, w.Code, w.Body.String())
		}
	}
	for _, invalid := range []M{{"name": 123}, {"startup": false}, {"description": []any{}}, {"docker_images": M{"image": 123}}, {"features": "not array"}, {"file_denylist": []any{123}}, {"force_outgoing_ip": "garbage"}, {"config_from": "not numeric"}} {
		body := valid()
		for k, v := range invalid {
			body[k] = v
		}
		w := request("POST", "/api/admin/eggs", body)
		if w.Code != 422 {
			t.Fatalf("Invalid field %v: %d %s", invalid, w.Code, w.Body.String())
		}
	}
	count, _ := a.one(ctx, "SELECT count(*) AS count FROM eggs")
	if num(count["count"]) != 0 {
		t.Fatal("Invalid editor input persisted")
	}
	w := request("POST", "/api/admin/eggs", valid())
	if w.Code != 201 {
		t.Fatalf("Valid editor input rejected: %d %s", w.Code, w.Body.String())
	}
	var result M
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	eggID := num(asMap(result["attributes"])["id"])
	if eggID == 0 {
		t.Fatal("Egg creation response missing ID")
	}
	path := fmt.Sprintf("/api/admin/eggs/%d/variables", eggID)
	variable := func() M {
		return M{"name": "Variable", "env_variable": "CUSTOM", "default_value": "", "description": "", "rules": "nullable|string", "user_viewable": false, "user_editable": false}
	}
	for _, invalid := range []M{{"name": 123}, {"description": 123}, {"default_value": 123}, {"user_viewable": "garbage"}, {"user_editable": nil}, {"options": "not array"}} {
		body := variable()
		for k, v := range invalid {
			body[k] = v
		}
		w = request("POST", path, body)
		if w.Code != 422 {
			t.Fatalf("Invalid variable %v: %d %s", invalid, w.Code, w.Body.String())
		}
	}
	body := variable()
	delete(body, "default_value")
	w = request("POST", path, body)
	if w.Code != 422 {
		t.Fatalf("Missing default_value accepted: %d", w.Code)
	}
	w = request("POST", path, variable())
	if w.Code != 201 {
		t.Fatalf("Valid variable rejected: %d %s", w.Code, w.Body.String())
	}
	unicodeVariable := variable()
	unicodeVariable["name"] = strings.Repeat("界", 100)
	unicodeVariable["env_variable"] = "UNICODE_NAME"
	w = request("POST", path, unicodeVariable)
	if w.Code != 201 {
		t.Fatalf("Native Unicode name length rejected: %d %s", w.Code, w.Body.String())
	}
	count, _ = a.one(ctx, "SELECT count(*) AS count FROM egg_variables WHERE egg_id=$1", eggID)
	if num(count["count"]) != 2 {
		t.Fatal("Invalid variable mutations persisted")
	}
	// Force-import permits an empty startup and absent configuration, unlike the editor.
	doc := eggFixture()
	doc["startup"] = ""
	doc["config"] = M{"files": nil, "startup": nil, "logs": nil, "stop": nil}
	w = request("POST", fmt.Sprintf("/api/admin/nests/%d/eggs/import", num(nest["id"])), doc)
	if w.Code != 201 {
		t.Fatalf("Editor guards leaked into PTDL import: %d %s", w.Code, w.Body.String())
	}
}
func TestEggRulesAgainstInstalledLaravel(t *testing.T) {
	app := os.Getenv("TEST_LARAVEL_APP")
	if app == "" {
		app, _ = filepath.Abs(filepath.Join("..", "..", "..", "pterodactyl-vite"))
	}
	if _, err := os.Stat(filepath.Join(app, "vendor", "autoload.php")); err != nil {
		t.Skip("Installed Laravel vendor tree unavailable for differential oracle")
	}
	script := `<?php require $argv[1].'/vendor/autoload.php';$factory=new Illuminate\Validation\Factory(new Illuminate\Translation\Translator(new Illuminate\Translation\ArrayLoader(),'en'));$out=[];foreach(json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR) as $case){$request=isset($case['env']['__egg_validation_data']);$data=$request?$case['env']['__egg_validation_data']:['environment'=>$case['env']??[]];$attribute=$request?'value':'environment.VALUE';if(!$request){if($case['present']){$data['environment']['VALUE']=$case['value'];}else{unset($data['environment']['VALUE']);}}try{$out[]=['name'=>$case['name'],'pass'=>$factory->make($data,[$attribute=>$case['rules']])->passes()];}catch(Throwable $e){$out[]=['name'=>$case['name'],'error'=>get_class($e)];}}echo json_encode($out,JSON_THROW_ON_ERROR);`
	path := filepath.Join(t.TempDir(), "egg-rules-reference.php")
	if err := os.WriteFile(path, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		if _, err := exec.LookPath("wsl"); err != nil {
			t.Skip("WSL PHP unavailable")
		}
		wslPath := func(p string) string { p = filepath.ToSlash(p); return "/mnt/" + strings.ToLower(p[:1]) + p[2:] }
		command = exec.Command("wsl", "-d", "Ubuntu", "--", "php", wslPath(path), wslPath(app))
	} else {
		if _, err := exec.LookPath("php"); err != nil {
			t.Skip("PHP unavailable")
		}
		command = exec.Command("php", path, app)
	}
	cases := eggNativeRuleCases()
	data, err := json.Marshal(cases)
	if err != nil {
		t.Fatal(err)
	}
	command.Stdin = bytes.NewReader(data)
	var diagnostics bytes.Buffer
	command.Stderr = &diagnostics
	output, err := command.Output()
	if err != nil {
		t.Fatalf("Laravel oracle failed: %v %s %s", err, output, diagnostics.String())
	}
	if diagnostics.Len() > 0 {
		t.Log("Laravel oracle emitted stderr diagnostics; JSON stdout is parsed separately.")
	}
	var results []struct {
		Name  string `json:"name"`
		Pass  bool   `json:"pass"`
		Error string `json:"error"`
	}
	if err = json.Unmarshal(output, &results); err != nil {
		t.Fatalf("Cannot decode Laravel oracle: %v", err)
	}
	if len(results) != len(cases) {
		t.Fatal("oracle lost cases")
	}
	for i, result := range results {
		t.Run(result.Name, func(t *testing.T) {
			if result.Error != "" {
				t.Fatal("Native Laravel rejected fixture", result.Error)
			}
			goPass := validateEggValue(cases[i].Value, cases[i].Present, cases[i].Rules, cases[i].Env) == nil
			if goPass != result.Pass || result.Pass != cases[i].Pass {
				t.Fatalf("Go=%v Laravel=%v expected=%v", goPass, result.Pass, cases[i].Pass)
			}
		})
	}
	t.Logf("Compared %d rule/value cases against installed Laravel without booting the panel or touching its database", len(results))
}
func TestEggPostgresExtendedRulesAndUnknownImport(t *testing.T) {
	a := eggDatabaseApp(t)
	ctx := context.Background()
	nest, err := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "Rule fixture", "author": "rules@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range eggNativeRuleCases() {
		if !c.Present {
			continue
		}
		if _, isRequest := c.Env["__egg_validation_data"]; isRequest {
			continue
		}
		if _, _, array := eggArray(c.Value); array {
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			doc := eggFixture()
			variable := asMap(asSlice(doc["variables"])[0])
			variable["rules"] = c.Rules
			variable["default_value"] = ""
			for key, value := range c.Env {
				doc["variables"] = append(asSlice(doc["variables"]), M{"name": key, "env_variable": key, "default_value": str(value), "rules": "nullable", "user_viewable": true, "user_editable": true})
			}
			e, vars, err := parseEggDocument(doc)
			if err != nil {
				t.Fatal(err)
			}
			e["nest_id"] = nest["id"]
			row, err := a.importEggRecord(ctx, 0, e, vars)
			if err != nil {
				t.Fatal(err)
			}
			env := M{"VALUE": c.Value}
			for key, value := range c.Env {
				env[key] = value
			}
			_, err = a.validateEggEnvironment(ctx, num(row["id"]), env, false)
			if (err == nil) != c.Pass {
				t.Fatalf("PostgreSQL env validation expected %v got %v", c.Pass, err)
			}
			export, err := a.eggExport(ctx, num(row["id"]))
			if err != nil {
				t.Fatal(err)
			}
			exportVars := eggSlice(export["variables"])
			if str(asMap(exportVars[0])["rules"]) != c.Rules {
				t.Fatal("rule string changed in export")
			}
		})
	}
	for _, rules := range []string{"required|custom_php_extension", "required|regex:/unterminated"} {
		doc := eggFixture()
		asMap(asSlice(doc["variables"])[0])["rules"] = rules
		e, vars, err := parseEggDocument(doc)
		if err != nil {
			t.Fatal("arbitrary rule import was rejected", err)
		}
		e["nest_id"] = nest["id"]
		row, err := a.importEggRecord(ctx, 0, e, vars)
		if err != nil {
			t.Fatal(err)
		}
		out, err := a.eggExport(ctx, num(row["id"]))
		if err != nil || str(asMap(eggSlice(out["variables"])[0])["rules"]) != rules {
			t.Fatal("arbitrary rule text was not preserved", err)
		}
		if _, err = a.validateEggEnvironment(ctx, num(row["id"]), M{"VALUE": "value"}, false); err == nil {
			t.Fatal("unsupported runtime rule returned success")
		}
	}
}

func eggPresenceCases() []eggNativeRuleCase {
	cases := []eggNativeRuleCase{}
	add := func(name, rules string, value any, env M, pass bool) {
		cases = append(cases, eggNativeRuleCase{name, rules, value, true, env, pass})
	}
	add("exists-found", "exists:egg_presence_fixture,email", "alpha@example.test", M{}, true)
	add("exists-missing", "exists:egg_presence_fixture,email", "missing@example.test", M{}, false)
	add("exists-extra-tenant", "exists:egg_presence_fixture,email,tenant_id,10", "alpha@example.test", M{}, true)
	add("exists-extra-tenant-miss", "exists:egg_presence_fixture,email,tenant_id,10", "beta@example.test", M{}, false)
	add("exists-null", "exists:egg_presence_fixture,email,deleted_at,NULL", "alpha@example.test", M{}, true)
	add("exists-null-miss", "exists:egg_presence_fixture,email,deleted_at,NULL", "beta@example.test", M{}, false)
	add("exists-not-null", "exists:egg_presence_fixture,email,deleted_at,NOT_NULL", "beta@example.test", M{}, true)
	add("exists-not-null-miss", "exists:egg_presence_fixture,email,deleted_at,NOT_NULL", "alpha@example.test", M{}, false)
	add("exists-negation", "exists:egg_presence_fixture,email,status,!disabled", "alpha@example.test", M{}, true)
	add("exists-negation-miss", "exists:egg_presence_fixture,email,status,!disabled", "beta@example.test", M{}, false)
	add("exists-array", "exists:egg_presence_fixture,email", []any{"alpha@example.test", "beta@example.test"}, M{}, true)
	add("exists-array-distinct", "exists:egg_presence_fixture,email", []any{"alpha@example.test", "alpha@example.test"}, M{}, true)
	add("exists-array-partial", "exists:egg_presence_fixture,email", []any{"alpha@example.test", "missing@example.test"}, M{}, false)
	add("exists-array-empty", "exists:egg_presence_fixture,email", []any{}, M{}, true)
	add("exists-null-column", "exists:egg_presence_fixture,deleted_at", nil, M{}, true)
	add("unique-found", "unique:egg_presence_fixture,email", "alpha@example.test", M{}, false)
	add("unique-new", "unique:egg_presence_fixture,email", "new@example.test", M{}, true)
	add("unique-ignore-id", "unique:egg_presence_fixture,email,2,id", "beta@example.test", M{}, true)
	add("unique-ignore-incomplete", "unique:egg_presence_fixture,email,1,id", "alpha@example.test", M{}, false)
	add("unique-ignore-null", "unique:egg_presence_fixture,email,NULL,id", "beta@example.test", M{}, false)
	add("unique-ignore-dependency", "unique:egg_presence_fixture,email,[environment.ID],id", "beta@example.test", M{"ID": "2"}, true)
	add("unique-extra", "unique:egg_presence_fixture,email,NULL,id,tenant_id,10", "beta@example.test", M{}, true)
	add("unique-extra-null", "unique:egg_presence_fixture,email,NULL,id,deleted_at,NULL", "beta@example.test", M{}, true)
	add("unique-extra-not-null", "unique:egg_presence_fixture,email,NULL,id,deleted_at,NOT_NULL", "beta@example.test", M{}, false)
	add("unique-extra-negation", "unique:egg_presence_fixture,email,NULL,id,status,!disabled", "beta@example.test", M{}, true)
	add("unique-array-first", "unique:egg_presence_fixture,email,2,id", []any{"beta@example.test", "alpha@example.test"}, M{}, true)
	add("exists-extra-overwrite", "exists:egg_presence_fixture,email,tenant_id,10,tenant_id,20", "beta@example.test", M{}, true)
	return cases
}
func TestEggPostgresDatabasePresenceNativeOracle(t *testing.T) {
	a := eggDatabaseApp(t)
	ctx := context.Background()
	if err := a.exec(ctx, "CREATE TABLE egg_presence_fixture(id bigint PRIMARY KEY,email text,tenant_id bigint,deleted_at text,status text)"); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, `INSERT INTO egg_presence_fixture VALUES(1,'alpha@example.test',10,NULL,'active'),(2,'beta@example.test',20,'2026-01-01','disabled'),(3,'alpha@example.test',20,NULL,'active')`); err != nil {
		t.Fatal(err)
	}
	cases := eggPresenceCases()
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			err := a.validateEggValue(ctx, c.Value, true, c.Rules, c.Env)
			if (err == nil) != c.Pass {
				t.Fatalf("expected %v got %v", c.Pass, err)
			}
		})
	}
	app := os.Getenv("TEST_LARAVEL_APP")
	if app == "" {
		app, _ = filepath.Abs(filepath.Join("..", "..", "..", "pterodactyl-vite"))
	}
	if _, err := os.Stat(filepath.Join(app, "vendor", "autoload.php")); err != nil {
		t.Skip("Installed Laravel unavailable for native presence oracle")
	}
	script := `<?php require $argv[1].'/vendor/autoload.php';if(!extension_loaded('pdo_sqlite')){echo json_encode(['skip'=>'pdo_sqlite unavailable']);exit;}$capsule=new Illuminate\Database\Capsule\Manager();$capsule->addConnection(['driver'=>'sqlite','database'=>':memory:']);$db=$capsule->getConnection();$db->statement('CREATE TABLE egg_presence_fixture(id integer PRIMARY KEY,email text,tenant_id integer,deleted_at text,status text)');$db->statement("INSERT INTO egg_presence_fixture VALUES(1,'alpha@example.test',10,NULL,'active'),(2,'beta@example.test',20,'2026-01-01','disabled'),(3,'alpha@example.test',20,NULL,'active')");$factory=new Illuminate\Validation\Factory(new Illuminate\Translation\Translator(new Illuminate\Translation\ArrayLoader(),'en'));$factory->setPresenceVerifier(new Illuminate\Validation\DatabasePresenceVerifier($capsule->getDatabaseManager()));$out=[];foreach(json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR) as $case){$env=$case['env'];$env['VALUE']=$case['value'];try{$out[]=['name'=>$case['name'],'pass'=>$factory->make(['environment'=>$env],['environment.VALUE'=>$case['rules']])->passes()];}catch(Throwable $e){$out[]=['name'=>$case['name'],'error'=>get_class($e)];}}echo json_encode($out,JSON_THROW_ON_ERROR);`
	path := filepath.Join(t.TempDir(), "egg-presence-reference.php")
	if err := os.WriteFile(path, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		wslPath := func(p string) string { p = filepath.ToSlash(p); return "/mnt/" + strings.ToLower(p[:1]) + p[2:] }
		command = exec.Command("wsl", "-d", "Ubuntu", "--", "php", wslPath(path), wslPath(app))
	} else {
		command = exec.Command("php", path, app)
	}
	data, _ := json.Marshal(cases)
	command.Stdin = bytes.NewReader(data)
	var diagnostics bytes.Buffer
	command.Stderr = &diagnostics
	output, err := command.Output()
	if err != nil {
		t.Fatalf("Native presence oracle failed: %v %s %s", err, output, diagnostics.String())
	}
	if diagnostics.Len() > 0 {
		t.Log("Native presence oracle emitted stderr diagnostics; JSON stdout is parsed separately.")
	}
	if bytes.Contains(output, []byte(`"skip"`)) {
		t.Skip("Native in-memory SQLite oracle unavailable")
	}
	var results []struct {
		Name  string `json:"name"`
		Pass  bool   `json:"pass"`
		Error string `json:"error"`
	}
	if err = json.Unmarshal(output, &results); err != nil {
		t.Fatal("Invalid native presence oracle response")
	}
	if len(results) != len(cases) {
		t.Fatal("native presence cases missing")
	}
	for i, result := range results {
		if result.Error != "" || result.Pass != cases[i].Pass {
			t.Errorf("%s: native=%v expected=%v error=%s", result.Name, result.Pass, cases[i].Pass, result.Error)
		}
	}
	t.Logf("%d exists/unique cases matched real PostgreSQL and original Laravel DatabasePresenceVerifier on isolated in-memory SQLite; original MariaDB untouched", len(cases))
	user, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "presence-model", "email": "presence@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	for _, rule := range []string{`exists:Pterodactyl\Models\User,id`, `exists:pgsql.users,id`} {
		if err = a.validateEggValue(ctx, user["id"], true, rule, M{}); err != nil {
			t.Fatalf("model/connection alias failed %v", err)
		}
	}
	for _, rule := range []string{"exists:egg_presence_fixture;DROP TABLE users,email", "exists:egg_presence_fixture,missing_column", "exists:egg_presence_fixture,email,tenant_id"} {
		if err = a.validateEggValue(ctx, "alpha@example.test", true, rule, M{}); err == nil {
			t.Fatal("invalid presence query was accepted")
		}
	}
	if _, err = a.one(ctx, "SELECT id FROM users WHERE id=$1", user["id"]); err != nil {
		t.Fatal("presence validation mutated user fixture")
	}
}
