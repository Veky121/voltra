package panel

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestClusterioSettingsManagedProjection(t *testing.T) {
	// Synthetic helper-shaped fixture; no claim of emitted native configuration.
	data := []byte("{\r\n \"controller.name\":\"Operator\", \"controller.http_port\":8080, \"controller.auth_secret\":\"private-fixture\", \"plugin.options\":[{\"nested\":true}], \"unknown\":12345678901234567890\r\n}\n")
	fields, err := clusterioManagedSettings("controller", data)
	if err != nil || len(fields) != 2 {
		t.Fatalf("projection: %v %v", fields, err)
	}
	for _, f := range fields {
		if f["readOnly"] != true || f["managed"] != true || strings.Contains(f["key"].(string), "secret") {
			t.Fatal("unsafe projection")
		}
	}
	next, err := clusterioSettingsPatch("controller", data, nil)
	if err != nil || !bytes.Equal(next, data) {
		t.Fatal("no-op changed bytes")
	}
	if _, err = clusterioManagedSettings("controller", next); err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{{"/controller.name": "changed"}, {"/controller.http_port": "9000"}, {"/controller.auth_secret": "replacement"}, {"/new": "value"}} {
		if _, err := clusterioSettingsPatch("controller", data, changes); err == nil {
			t.Fatal("accepted unproved writable field")
		}
	}
	if !bytes.Equal(next, data) {
		t.Fatal("refusal mutated bytes")
	}
	fields, err = clusterioManagedSettings("host", []byte(`{"host.id":4,"host.name":"Host","host.controller_token":"private-fixture","controller.name":"inactive"}`))
	if err != nil || len(fields) != 2 {
		t.Fatal("role leakage", fields, err)
	}
	empty, err := clusterioManagedSettings("controller", []byte(`{"plugin":{"secret":"private-fixture"}}`))
	if err != nil || len(empty) != 0 {
		t.Fatal("invented defaults")
	}
}

func TestClusterioSettingsRefusals(t *testing.T) {
	for _, s := range []string{`[]`, `{"controller.name":"a","controller.name":"b"}`, `{"controller.name":"a","Controller.Name":"b"}`, `{"controller.http_port":"8080"}`, `{"controller.http_port":1.5}`, `{"controller.http_port":65536}`, `{"controller.name":"line\nfeed"}`, `{"plugin":{"x":1,"X":2}}`, `{} trailing`} {
		if _, err := clusterioManagedSettings("controller", []byte(s)); err == nil {
			t.Fatalf("accepted %s", s)
		}
	}
}

func TestClusterioSettingsSelectionDrift(t *testing.T) {
	makeInput := func(role string) settingsAuthorityInput {
		t.Helper()
		files := map[string][]byte{".voltra/clusterio-mode": []byte(role + "\n"), "config-" + role + ".json": []byte(`{}`)}
		for _, name := range []string{"clusterio-start.mjs", "clusterio-setup.mjs", "clusterio-controller.mjs"} {
			data, err := os.ReadFile("game_library/scripts/" + name)
			if err != nil {
				t.Fatal(err)
			}
			files[".voltra/"+name] = data
		}
		return settingsAuthorityInput{Startup: clusterioSettingsStartup, Env: map[string]string{"SERVER_MODE": role}, Files: files}
	}
	for _, role := range []string{"controller", "host"} {
		in := makeInput(role)
		selected, err := clusterioSettingsSelection(clusterioSettingsRecipe, clusterioSettingsStartup, in)
		if err != nil || selected.Path != "/config-"+role+".json" {
			t.Fatal(selected, err)
		}
	}
	for _, mutate := range []func(*settingsAuthorityInput){
		func(i *settingsAuthorityInput) { i.Startup += " --config other.json" },
		func(i *settingsAuthorityInput) { i.Env["SERVER_MODE"] = "../host" },
		func(i *settingsAuthorityInput) { i.Env["NODE_OPTIONS"] = "--import evil.mjs" },
		func(i *settingsAuthorityInput) { i.Files[".voltra/clusterio-mode"] = []byte("host\n") },
		func(i *settingsAuthorityInput) { delete(i.Files, "config-controller.json") },
		func(i *settingsAuthorityInput) { i.Files[".voltra/clusterio-start.mjs"] = []byte("drift") },
	} {
		in := makeInput("controller")
		mutate(&in)
		if _, err := clusterioSettingsSelection(clusterioSettingsRecipe, clusterioSettingsStartup, in); err == nil {
			t.Fatal("accepted drift")
		}
	}
	in := makeInput("controller")
	if _, err := clusterioSettingsSelection("other", clusterioSettingsStartup, in); err == nil {
		t.Fatal("foreign recipe")
	}
}
