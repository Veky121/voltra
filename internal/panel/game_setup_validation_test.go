package panel

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func setupValidationFixture() ([]templateSetupValidation, M) {
	return []templateSetupValidation{{Environment: "PUBLIC_IP", Type: "public_ipv4", Required: true, Message: "Enter a global unicast IPv4 address."}}, M{"variables": []any{M{"env_variable": "PUBLIC_IP", "rules": "required|string", "default_value": "", "user_viewable": true, "user_editable": true}}}
}

func TestSetupPublicIPv4PythonVectors(t *testing.T) {
	body, err := os.ReadFile("testdata/setup-public-ipv4-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var reference struct {
		Vectors []struct {
			Value  string `json:"value"`
			Accept bool   `json:"accept"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(body, &reference); err != nil {
		t.Fatal(err)
	}
	if len(reference.Vectors) < 800 {
		t.Fatal("missing boundary/reference coverage")
	}
	for _, row := range reference.Vectors {
		if setupPublicIPv4(row.Value) != row.Accept {
			t.Errorf("Python mismatch for %q", row.Value)
		}
	}
}

func TestSetupValidationMetadataAndPreservation(t *testing.T) {
	rules, egg := setupValidationFixture()
	env := M{"PUBLIC_IP": "192.0.0.9", "OTHER": "operator"}
	before, _ := json.Marshal([]any{rules, egg, env})
	if err := validateTemplateSetupEnvironment(rules, egg, env); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal([]any{rules, egg, env})
	if string(before) != string(after) {
		t.Fatal("validation mutated metadata/operator input")
	}
	for _, value := range []any{"", "100.64.0.1", "224.0.0.1", "1.1.1.1\n", nil, 123} {
		if err := validateTemplateSetupEnvironment(rules, egg, M{"PUBLIC_IP": value}); err == nil {
			t.Fatal("invalid value accepted", value)
		}
	}
	rules[0].Required = false
	for _, value := range []M{{}, {"PUBLIC_IP": ""}} {
		if err := validateTemplateSetupEnvironment(rules, egg, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := validateTemplateSetupEnvironment(nil, M{}, M{}); err != nil {
		t.Fatal("unrelated templates affected")
	}
	for _, mutate := range []func(*templateSetupValidation){
		func(r *templateSetupValidation) { r.Environment = "MISSING" }, func(r *templateSetupValidation) { r.Environment = "1IP" },
		func(r *templateSetupValidation) { r.Type = "dns" }, func(r *templateSetupValidation) { r.Message = "" }, func(r *templateSetupValidation) { r.Message = "bad\nmessage" },
	} {
		badRules, _ := setupValidationFixture()
		mutate(&badRules[0])
		if err := validateTemplateSetupMetadata(badRules, egg); err == nil {
			t.Fatal("invalid metadata accepted")
		}
	}
	rules, _ = setupValidationFixture()
	if err := validateTemplateSetupMetadata(append(rules, rules[0]), egg); err == nil {
		t.Fatal("duplicate descriptors accepted")
	}
	egg["variables"] = append(asSlice(egg["variables"]), asSlice(egg["variables"])[0])
	if err := validateTemplateSetupMetadata(rules, egg); err == nil {
		t.Fatal("ambiguous original field accepted")
	}
	if !reflect.DeepEqual(env, M{"PUBLIC_IP": "192.0.0.9", "OTHER": "operator"}) {
		t.Fatal("environment mutated")
	}
}
