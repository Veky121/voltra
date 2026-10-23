package panel

import (
	"context"
	"strings"
	"testing"
)

func TestJavaLegacyStartupValidationAndSelection(t *testing.T) {
	config := M{"enabled": true, "memory_mode": "argfile", "legacy_startup": `java -jar "{{SERVER_JARFILE}}" nogui`}
	normal, err := javaNormalize(config, true)
	if err != nil {
		t.Fatal(err)
	}
	egg := M{"java_config": normal}
	server := M{"startup": "java @unix_args.txt nogui"}
	for _, major := range []int64{8, 21, 25} {
		_, env, err := javaInvocation(egg, server, M{"major": major, "jvm_args": "-Xms128M -Xmx1024M"})
		if err != nil {
			t.Fatal(err)
		}
		script := str(env["VOLTRA_JAVA_SCRIPT"])
		if major == 8 && (!strings.Contains(script, `-jar "${SERVER_JARFILE}"`) || strings.Contains(script, "@unix_args.txt")) {
			t.Fatal("Java8 did not use direct fallback", script)
		}
		if major > 8 && (!strings.Contains(script, "@unix_args.txt") || strings.Contains(script, "SERVER_JARFILE")) {
			t.Fatal("modern invocation changed", script)
		}
	}
	for _, unsafe := range []string{"bash run.sh", "java @args.txt", "java -jar x.jar; touch bad", "java -jar $(touch bad).jar", "java -jar `bad`.jar", "java -jar ../outside.jar", "java -jar x.jar\nwhoami", "java -jar x.jar | cat", "java -jar x.jar > output", "java -jar x.jar -Xmx4G", `java -jar "unfinished.jar`} {
		if _, err := javaNormalize(M{"enabled": true, "memory_mode": "argfile", "legacy_startup": unsafe}, true); err == nil {
			t.Fatalf("unsafe legacy command accepted: %q", unsafe)
		}
	}
	if _, err := javaNormalize(config, false); err == nil {
		t.Fatal("server can override egg legacy command")
	}
	if _, err := javaNormalize(M{"enabled": true, "legacy_startup": "java -jar old.jar"}, true); err == nil {
		t.Fatal("command-mode egg accepted argfile fallback metadata")
	}
	if _, _, err := javaInvocation(M{"java_config": M{"memory_mode": "argfile"}}, server, M{"major": int64(8)}); err == nil {
		t.Fatal("absent-field Java8 argfile safety changed")
	}
}

func TestJavaLegacyStartupAPIAndReadable(t *testing.T) {
	f := operationsFixtureNew(t)
	f.a.registerJava(f.mux)
	ctx := context.Background()
	config := M{"enabled": true, "required_major": 8, "default_major": 25, "memory_mode": "argfile", "legacy_startup": `java -jar "{{SERVER_JARFILE}}" nogui`}
	egg, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"java_config": config})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.a.update(ctx, "servers", num(f.server["id"]), M{"startup": "java @unix_args.txt nogui", "java_config": M{"enabled": true, "runtime_id": "temurin-8"}, "memory": 2048}); err != nil {
		t.Fatal(err)
	}
	view := operationsExpect(t, f.request("GET", f.serverPath("/java"), nil, f.owner), 200)
	attributes := asMap(view["attributes"])
	if num(asMap(attributes["effective"])["major"]) != 8 || str(asMap(attributes["egg"])["legacy_startup"]) == "" {
		t.Fatal("actual API omitted selected fallback metadata", view)
	}
	server, err := f.a.one(ctx, "SELECT * FROM servers WHERE id=$1", f.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	display, _ := f.a.javaReadable(ctx, egg, server, true)
	if !strings.Contains(display, `-jar "{{SERVER_JARFILE}}"`) || strings.Contains(display, "@unix_args.txt") {
		t.Fatal("display differs from actual legacy invocation", display)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/java"), M{"enabled": true, "runtime_id": "temurin-25"}, f.owner), 200)
	server, _ = f.a.one(ctx, "SELECT * FROM servers WHERE id=$1", f.server["id"])
	display, _ = f.a.javaReadable(ctx, egg, server, true)
	if !strings.Contains(display, "@unix_args.txt") || strings.Contains(display, "SERVER_JARFILE") {
		t.Fatal("modern display did not restore argfile", display)
	}
}
