package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEggFieldTypeMetadataCompatibility(t *testing.T) {
	for _, tc := range []struct {
		value any
		want  string
	}{{nil, "text"}, {"", "text"}, {"text", "text"}, {"password", "password"}, {"textarea", "textarea"}, {"select", "select"}, {"community-custom", "community-custom"}, {false, "text"}, {42, "text"}, {[]any{"password"}, "text"}, {M{"type": "password"}, "text"}} {
		d := asMap(eggSlice(eggFixture()["variables"])[0])
		d["field_type"] = tc.value
		v, err := normalizeEggVariable(d, true)
		if err != nil || str(v["field_type"]) != tc.want {
			t.Fatalf("metadata normalization %T: got %q err %v", tc.value, v["field_type"], err)
		}
	}
	for _, version := range []string{"PTDL_v1", "PTDL_v2"} {
		document := eggFixture()
		document["meta"] = M{"version": version}
		v := asMap(eggSlice(document["variables"])[0])
		v["field_type"] = "password"
		_, variables, err := parseEggDocument(document)
		if err != nil {
			t.Fatal(err)
		}
		want := "password"
		if version == "PTDL_v1" {
			want = "text"
		}
		if str(variables[0]["field_type"]) != want {
			t.Fatal("version-specific field presentation lost")
		}
		if v["field_type"] != "password" {
			t.Fatal("v1 parser mutated caller document")
		}
	}
}

func TestEggPostgresFieldTypesAdminRoundTrip(t *testing.T) {
	a := eggDatabaseApp(t)
	ctx := context.Background()
	admin, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "field-type-editor", "email": "field-type@example.test", "root_admin": true})
	if err != nil {
		t.Fatal(err)
	}
	nest, err := a.insert(ctx, "nests", M{"uuid": newUUID(), "name": "Field types", "author": "field-type@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.registerEggs(mux)
	request := func(method, path string, body M, want int) M {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Content-Type", "application/json")
		r = WithUser(r, num(admin["id"]))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s status %d, want %d", method, path, w.Code, want)
		}
		var result M
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	kinds := []string{"text", "password", "textarea", "select", "community-custom", "text", "text", "text"}
	document := eggFixture()
	variables := []any{}
	for i, kind := range kinds {
		v := M{"name": fmt.Sprintf("Variable %d", i), "env_variable": fmt.Sprintf("TYPE_%d", i), "default_value": "", "description": "presentation fixture", "rules": "nullable|string", "user_viewable": true, "user_editable": true}
		if i < 5 {
			v["field_type"] = kind
		}
		if i == 6 {
			v["field_type"] = nil
		}
		if i == 7 {
			v["field_type"] = ""
		}
		variables = append(variables, v)
	}
	document["variables"] = variables
	imported := request("POST", "/api/admin/eggs/import", M{"nest_id": nest["id"], "egg": document}, 201)
	id := num(asMap(imported["attributes"])["id"])
	if id == 0 {
		t.Fatal("import response missing ID")
	}
	exportPath := fmt.Sprintf("/api/admin/eggs/%d/export", id)
	check := func(doc M, expected []string) {
		t.Helper()
		got := eggSlice(doc["variables"])
		if len(got) != len(expected) {
			t.Fatal("variable count changed")
		}
		for i, v := range got {
			if str(asMap(v)["field_type"]) != expected[i] {
				t.Fatalf("field type %d got %q want %q", i, asMap(v)["field_type"], expected[i])
			}
		}
	}
	exported := request("GET", exportPath, nil, 200)
	check(exported, kinds)
	clone := request("POST", "/api/admin/eggs/import", M{"nest_id": nest["id"], "egg": exported}, 201)
	cloneID := num(asMap(clone["attributes"])["id"])
	if cloneID == id || cloneID == 0 {
		t.Fatal("export re-import did not create a separate egg")
	}
	check(request("GET", fmt.Sprintf("/api/admin/eggs/%d/export", cloneID), nil, 200), kinds)
	rows, err := a.eggVariables(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	firstID := num(rows[1]["id"])
	// Re-import the actual exported document through the normal admin API.
	request("POST", fmt.Sprintf("/api/admin/eggs/%d/import", id), M{"egg": exported}, 200)
	after, err := a.eggVariables(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if num(after[1]["id"]) != firstID {
		t.Fatal("re-import changed variable identity")
	}
	check(request("GET", exportPath, nil, 200), kinds)
	variablePath := fmt.Sprintf("/api/admin/eggs/%d/variables/%d", id, firstID)
	// Ordinary unrelated updates must retain the stored password classification.
	updated := request("PATCH", variablePath, M{"description": "edited description"}, 200)
	if str(asMap(updated["attributes"])["field_type"]) != "password" {
		t.Fatal("partial update erased password presentation")
	}
	request("PATCH", variablePath, M{"field_type": "textarea"}, 200)
	kinds[1] = "textarea"
	check(request("GET", exportPath, nil, 200), kinds)
	// An invalid variable edit is rejected without changing field metadata.
	request("PATCH", variablePath, M{"field_type": "password", "rules": ""}, 422)
	check(request("GET", exportPath, nil, 200), kinds)
	request("PATCH", variablePath, M{"field_type": "community-custom"}, 200)
	kinds[1] = "community-custom"
	check(request("GET", exportPath, nil, 200), kinds)
	// Import-update also changes presentation without replacing variable IDs.
	changed := request("GET", exportPath, nil, 200)
	asMap(eggSlice(changed["variables"])[1])["field_type"] = "password"
	request("POST", fmt.Sprintf("/api/admin/eggs/%d/import", id), M{"egg": changed}, 200)
	kinds[1] = "password"
	check(request("GET", exportPath, nil, 200), kinds)
	rows, err = a.eggVariables(ctx, id)
	if err != nil || num(rows[1]["id"]) != firstID {
		t.Fatal("import-update replaced variable identity")
	}
	// Missing field_type on admin create uses the old text default.
	created := request("POST", fmt.Sprintf("/api/admin/eggs/%d/variables", id), M{"name": "Default", "env_variable": "DEFAULT_TYPE", "default_value": "", "rules": "nullable|string"}, 201)
	if str(asMap(created["attributes"])["field_type"]) != "text" {
		t.Fatal("missing field_type has no text default")
	}
}
