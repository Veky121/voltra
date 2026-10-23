package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestMinecraftRuntimeRulesValidation(t *testing.T) {
	base := M{"id": "graal-pack", "name": "Graal pack", "provider": "modrinth", "project_id": "project", "required_major": int64(21), "required_distribution": "graalvm", "min_memory_mib": int64(4096), "jvm_args": "-XX:+UseG1GC"}
	for _, patch := range []M{{"id": "../escape"}, {"required_major": 21.5}, {"min_memory_mib": -1}, {"enabled": "true"}, {"loader": "unknown"}, {"jvm_args": "-Xmx8G"}, {"jvm_args": "-XX:MaxRAMPercentage=90"}, {"jvm_args": "-Dfoo=$(id)"}, {"project_id": "x", "provider": ""}, {"project_version": "x", "project_id": ""}} {
		rule := M{}
		for key, value := range base {
			rule[key] = value
		}
		for key, value := range patch {
			rule[key] = value
		}
		if _, err := validateMinecraftRuntimeRules([]any{rule}); err == nil {
			t.Fatalf("accepted invalid rule: %v", patch)
		}
	}
	if _, err := validateMinecraftRuntimeRules([]any{base, base}); err == nil {
		t.Fatal("duplicate rule IDs accepted")
	}
	if _, err := validateMinecraftRuntimeRules([]any{base}); err != nil {
		t.Fatal(err)
	}
}

func TestMinecraftRuntimeRulesApplyAndPermissions(t *testing.T) {
	a, _, admin := infraTestApp(t)
	mux := http.NewServeMux()
	a.registerMinecraftRuntimeRules(mux)
	ctx := context.Background()
	user, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "rule-member", "email": "rule-member@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	rules := []M{
		{"id": "pack", "name": "Pack requirement", "provider": "modrinth", "project_id": "special", "required_major": 21, "required_distribution": "graalvm", "min_memory_mib": 4096, "jvm_args": "-XX:+UseG1GC"},
		{"id": "fabric", "name": "Fabric requirement", "loader": "fabric", "required_major": 17},
		{"id": "disabled", "name": "Disabled", "enabled": false, "required_major": 25},
	}
	infraExpect(t, mux, num(user["id"]), "GET", "/api/admin/minecraft/runtime-rules", nil, 403)
	infraExpect(t, mux, num(user["id"]), "PUT", "/api/admin/minecraft/runtime-rules", M{"rules": rules}, 403)
	infraExpect(t, mux, admin, "PUT", "/api/admin/minecraft/runtime-rules", M{"rules": rules}, 200)
	config := M{"enabled": true, "required_major": 17, "extra_args": "-Dpack=true"}
	resolved, err := a.applyMinecraftRuntimeRules(ctx, "modrinth", "special", "v1", "fabric", "1.21.1", config, 8192)
	if err != nil {
		t.Fatal(err)
	}
	if num(resolved["required_major"]) != 21 || str(resolved["required_distribution"]) != "graalvm" || !strings.Contains(str(resolved["extra_args"]), "-Dpack=true") || !strings.Contains(str(resolved["extra_args"]), "-XX:+UseG1GC") {
		t.Fatalf("incorrect requirements: %v", resolved)
	}
	if num(config["required_major"]) != 17 {
		t.Fatal("input config was mutated")
	}
	if _, err := a.applyMinecraftRuntimeRules(ctx, "modrinth", "special", "v1", "fabric", "1.21.1", config, 2048); err == nil {
		t.Fatal("insufficient memory accepted")
	}
	unmatched, err := a.applyMinecraftRuntimeRules(ctx, "curseforge", "special", "v1", "vanilla", "1.21.1", config, 2048)
	if err != nil || num(unmatched["required_major"]) != 17 || str(unmatched["required_distribution"]) != "" {
		t.Fatalf("unrelated rule applied: %v %v", unmatched, err)
	}
	config["required_distribution"] = "temurin"
	if _, err := a.applyMinecraftRuntimeRules(ctx, "modrinth", "special", "v1", "fabric", "1.21.1", config, 8192); err == nil {
		t.Fatal("conflicting distribution accepted")
	}
}

func TestMinecraftRuntimeRulesCustomAndFutureJava(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerJava(mux)
	a.registerMinecraftRuntimeRules(mux)
	catalog := append(javaDefaultRuntimes(), M{"id": "pack-graal-21", "name": "Pack GraalVM", "major": 21, "distribution": "graalvm", "image": "registry.example.invalid/graal:21", "enabled": true}, M{"id": "future-29", "name": "Future Java", "major": 29, "distribution": "temurin", "image": "registry.example.invalid/java:29", "enabled": true})
	infraExpect(t, mux, admin, "PUT", "/api/admin/java/runtimes", M{"runtimes": catalog}, 200)
	rule := M{"id": "custom-jvm", "name": "Pack JVM", "provider": "modrinth", "project_id": "special", "required_major": 21, "required_distribution": "graalvm", "jvm_args": "-Dpack.requirement=true"}
	infraExpect(t, mux, admin, "PUT", "/api/admin/minecraft/runtime-rules", M{"rules": []M{rule}}, 200)
	config, err := a.applyMinecraftRuntimeRules(ctx, "modrinth", "special", "release", "fabric", "1.21.1", M{"enabled": true, "required_major": 21}, 4096)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := a.javaResolve(ctx, M{}, config, 4096)
	if err != nil || resolved["runtime_id"] != "pack-graal-21" || !strings.Contains(str(resolved["jvm_args"]), "-Dpack.requirement=true") {
		t.Fatalf("pack rule did not select the registered distribution: %v %v", resolved, err)
	}
	// A newly required major can be registered without adding another code branch.
	future, err := a.javaResolve(ctx, M{}, M{"enabled": true, "required_major": 29}, 4096)
	if err != nil || future["runtime_id"] != "future-29" {
		t.Fatalf("future runtime registration: %v %v", future, err)
	}
}
