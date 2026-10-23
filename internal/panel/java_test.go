package panel

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestJavaResolutionAndValidation(t *testing.T) {
	a, ctx := &App{}, context.Background()
	if got, err := a.javaResolve(ctx, M{}, M{}, 128); err != nil || len(got) != 0 {
		t.Fatalf("legacy behavior changed: %v %v", got, err)
	}
	for _, major := range []int64{8, 11, 16, 17, 21, 25} {
		got, err := a.javaResolve(ctx, M{}, M{"enabled": true, "required_major": major, "xms_mib": 128}, 2048)
		if err != nil || num(got["major"]) != major || num(got["xmx_mib"]) != 1843 || num(got["reserved_mib"]) != 205 {
			t.Fatalf("Java%d: %v %v", major, got, err)
		}
		if !strings.Contains(str(got["jvm_args"]), "-Xms128M -Xmx1843M") {
			t.Fatal(got)
		}
	}
	egg := M{"java_config": M{"enabled": true, "required_major": 21, "required_distribution": "temurin"}}
	for _, c := range []M{
		{"enabled": true, "runtime_id": "temurin-17"},
		{"enabled": true, "required_major": 17},
		{"enabled": true, "required_distribution": "openj9"},
		{"enabled": true, "runtime_id": "custom-user-image"},
		{"enabled": true, "xms_mib": 1800, "xmx_mib": 1024},
		{"enabled": true, "xmx_mib": 2048},
		{"enabled": true, "xmx_mib": math.NaN()},
		{"enabled": true, "xmx_mib": math.Inf(1)},
		{"enabled": true, "xmx_mib": 1.5},
		{"enabled": true, "xmx_mib": "1024"},
		{"enabled": true, "extra_args": "-Xmx1G"},
		{"enabled": true, "extra_args": "-XX:MaxRAMPercentage=80"},
		{"enabled": true, "extra_args": `-X"mx"1G`},
		{"enabled": true, "extra_args": `"-jar" other.jar`},
		{"enabled": true, "extra_args": "com.example.OtherMain"},
		{"enabled": true, "extra_args": "-Dfoo=$(cat /etc/passwd)"},
	} {
		if _, err := a.javaResolve(ctx, egg, c, 2048); err == nil {
			t.Fatalf("accepted invalid config %#v", c)
		}
	}
	if _, err := a.javaResolve(ctx, egg, M{}, 0); err == nil {
		t.Fatal("unlimited automatic heap accepted")
	}
	got, err := a.javaResolve(ctx, egg, M{"enabled": true, "xmx_mib": 1024}, 0)
	if err != nil || num(got["xmx_mib"]) != 1024 {
		t.Fatalf("explicit unlimited heap: %v %v", got, err)
	}
	got, err = a.javaResolve(ctx, M{}, M{"enabled": true, "extra_args": nil, "required_distribution": nil}, 2048)
	if err != nil || num(got["major"]) != 17 {
		t.Fatalf("decoded empty text/default17: %v %v", got, err)
	}
}

func TestJavaRequirementPermissions(t *testing.T) {
	egg := M{"java_config": M{"enabled": true, "required_major": 17}}
	server := M{"java_config": M{"enabled": true, "required_major": 21, "required_distribution": "temurin", "runtime_id": "auto"}}
	for _, next := range []M{M{}, {"enabled": false, "required_major": 21, "required_distribution": "temurin"}, {"enabled": true, "required_major": 17, "required_distribution": "temurin"}, {"enabled": true, "required_major": 21, "required_distribution": "openj9"}} {
		if javaCheckUpdate(M{}, server, egg, next) == nil {
			t.Fatalf("ordinary user weakened requirements: %v", next)
		}
		if err := javaCheckUpdate(M{"root_admin": true}, server, egg, next); err != nil {
			t.Fatal(err)
		}
	}
	if err := javaCheckUpdate(M{}, server, egg, M{"enabled": true, "required_major": 21, "required_distribution": "temurin", "runtime_id": "temurin-25"}); err != nil {
		t.Fatal(err)
	}
	if !javaMinecraftEgg(M{"features": []any{"minecraft"}}) || javaMinecraftEgg(M{"features": []any{"java_version"}}) {
		t.Fatal("Minecraft feature detection")
	}
}

func TestJavaPreferredDefaultPreservesHistoricalRuntimeChoices(t *testing.T) {
	a, ctx := &App{}, context.Background()
	egg := M{"java_config": M{"enabled": true, "required_major": 8, "default_major": 25}}
	for _, row := range []struct {
		name   string
		config M
		major  int64
	}{
		{"automatic preferred default", M{}, 25},
		{"explicit historical runtime", M{"enabled": true, "runtime_id": "temurin-8"}, 8},
		{"explicit server major", M{"enabled": true, "required_major": 17}, 17},
		{"explicit newer runtime", M{"enabled": true, "runtime_id": "temurin-21"}, 21},
	} {
		t.Run(row.name, func(t *testing.T) {
			got, err := a.javaResolve(ctx, egg, row.config, 2048)
			if err != nil || num(got["major"]) != row.major {
				t.Fatalf("%v %v", got, err)
			}
		})
	}
	for _, config := range []M{
		{"enabled": true, "required_major": 7},
		{"enabled": true, "required_major": 25, "runtime_id": "temurin-8"},
		{"enabled": true, "default_major": 25},
	} {
		if _, err := a.javaResolve(ctx, egg, config, 2048); err == nil {
			t.Fatalf("accepted incompatible server config %v", config)
		}
	}
	for _, value := range []any{nil, 0, 7, 25.5, "25", math.NaN(), 1000} {
		if _, err := javaNormalize(M{"enabled": true, "required_major": 8, "default_major": value}, true); err == nil {
			t.Fatalf("accepted invalid preferred major %v", value)
		}
	}
	if _, err := javaNormalize(M{"enabled": true, "required_major": 21, "default_major": 17}, true); err == nil {
		t.Fatal("default below minimum accepted")
	}
	if _, err := a.javaResolve(ctx, M{"java_config": M{"enabled": true, "required_major": 8, "default_major": 22}}, M{}, 2048); err == nil {
		t.Fatal("unregistered automatic default accepted")
	}
	for _, major := range []int64{8, 21} {
		config, err := javaNormalize(M{"enabled": true, "required_major": major}, true)
		if err != nil {
			t.Fatal(err)
		}
		if _, present := config["default_major"]; present {
			t.Fatal("legacy Java configs gained a default setting")
		}
		got, err := a.javaResolve(ctx, M{"java_config": config}, M{}, 2048)
		if err != nil || num(got["major"]) != major {
			t.Fatalf("existing Java%d behavior changed: %v %v", major, got, err)
		}
	}
	if got, err := a.javaResolve(ctx, M{}, M{}, 2048); err != nil || len(got) != 0 {
		t.Fatal("unmanaged Rising-style template changed", got, err)
	}
}

func TestJavaPreferredDefaultAPIAndEggRoundTrip(t *testing.T) {
	f := operationsFixtureNew(t)
	f.a.registerJava(f.mux)
	f.a.registerEggs(f.mux)
	ctx := context.Background()
	eggID := num(f.server["egg_id"])
	if _, err := f.a.update(ctx, "eggs", eggID, M{"java_config": M{"enabled": true, "required_major": 8, "default_major": 25}, "startup": "java -jar server.jar"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.a.update(ctx, "servers", num(f.server["id"]), M{"java_config": M{}, "memory": 2048, "startup": "java -jar server.jar"}); err != nil {
		t.Fatal(err)
	}
	view := operationsExpect(t, f.request("GET", f.serverPath("/java"), nil, f.owner), 200)
	attributes := asMap(view["attributes"])
	if num(asMap(attributes["effective"])["major"]) != 25 || num(asMap(attributes["egg"])["default_major"]) != 25 {
		t.Fatal("preferred automatic default missing from API", view)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/java"), M{"enabled": true, "runtime_id": "temurin-8", "xms_mib": 128}, f.owner), 200)
	view = operationsExpect(t, f.request("GET", f.serverPath("/java"), nil, f.owner), 200)
	if num(asMap(asMap(view["attributes"])["effective"])["major"]) != 8 {
		t.Fatal("historical explicit runtime blocked", view)
	}
	operationsExpect(t, f.request("PUT", f.serverPath("/java"), M{"enabled": true, "default_major": 25}, f.owner), 422)
	doc, err := f.a.eggExport(ctx, eggID)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, err := parseEggDocument(doc)
	if err != nil || num(asMap(parsed["java_config"])["required_major"]) != 8 || num(asMap(parsed["java_config"])["default_major"]) != 25 {
		t.Fatalf("preferred default egg roundtrip: %v %v", parsed, err)
	}
}

func TestJavaInvocationSafety(t *testing.T) {
	effective := M{"major": int64(8), "jvm_args": "-Xms128M -Xmx1024M"}
	for _, startup := range []string{"java @args.txt", "bash run.sh", "java -jar app.jar; curl example.org"} {
		if _, _, err := javaInvocation(M{}, M{"startup": startup}, effective); err == nil {
			t.Fatalf("unsafe Java8 startup accepted: %s", startup)
		}
	}
	if _, _, err := javaInvocation(M{"java_config": M{"memory_mode": "argfile"}}, M{"startup": "java -jar app.jar"}, effective); err != nil {
		t.Fatal("Java8 direct startup must fall back to command mode:", err)
	}
	for _, file := range []string{"../args.txt", "x/y.txt", "x;touch evil", ".."} {
		if _, err := javaNormalize(M{"enabled": true, "memory_mode": "argfile", "args_file": file}, true); err == nil {
			t.Fatalf("unsafe filename: %s", file)
		}
	}
}

func TestJavaPostgresAPIAndRollback(t *testing.T) {
	f := operationsFixtureNew(t)
	f.a.registerJava(f.mux)
	f.a.registerLifecycle(f.mux)
	f.a.registerEggs(f.mux)
	ctx := context.Background()
	eggID := num(f.server["egg_id"])
	_, err := f.a.update(ctx, "eggs", eggID, M{"java_config": M{"enabled": true, "required_major": 17}, "features": []string{"minecraft"}, "startup": "java -Xmx2G -jar server.jar"})
	if err != nil {
		t.Fatal(err)
	}
	f.server, err = f.a.update(ctx, "servers", num(f.server["id"]), M{"java_config": M{"enabled": true, "required_major": 21}, "startup": "java -Xms128M -Xmx2G -jar server.jar", "memory": int64(2048), "image": "ghcr.io/pterodactyl/yolks:java_21"})
	if err != nil {
		t.Fatal(err)
	}
	path := f.serverPath("/java")
	operationsExpect(t, f.request("GET", path, nil, f.sub), 200)
	operationsExpect(t, f.request("PUT", path, M{"enabled": true, "required_major": 21}, f.sub), 403)
	if err = f.a.exec(ctx, "UPDATE subusers SET permissions=$1 WHERE server_id=$2", []string{"startup.read", "startup.update"}, f.server["id"]); err != nil {
		t.Fatal(err)
	}
	config := M{"enabled": true, "required_major": 21, "runtime_id": "auto", "required_distribution": "", "xms_mib": 256, "xmx_mib": 1024, "extra_args": ""}
	operationsExpect(t, f.request("PUT", path, config, f.sub), 200)
	config["runtime_id"] = "temurin-25"
	operationsExpect(t, f.request("PUT", path, config, f.sub), 403)
	config["runtime_id"] = "auto"
	config["required_major"] = 17
	operationsExpect(t, f.request("PUT", path, config, f.sub), 403)
	config["required_major"] = 21
	config["enabled"] = false
	operationsExpect(t, f.request("PUT", path, config, f.sub), 403)
	config["enabled"] = true
	// Build and startup mutations also compensate their dependent data.
	f.mu.Lock()
	f.failPath = "/sync"
	f.mu.Unlock()
	appPath := "/api/application/servers/" + str(f.server["id"])
	operationsExpect(t, f.request("PATCH", appPath+"/build", M{"memory": 4096}, f.admin), 502)
	rolled, err := f.a.one(ctx, "SELECT memory,startup FROM servers WHERE id=$1", f.server["id"])
	if err != nil || num(rolled["memory"]) != 2048 {
		t.Fatal("build failed to restore memory", err)
	}
	operationsExpect(t, f.request("PATCH", appPath+"/startup", M{"startup": "java -jar changed.jar", "environment": M{"VISIBLE": "changed", "SECRET": "very-secret"}}, f.admin), 502)
	rolled, err = f.a.one(ctx, "SELECT startup FROM servers WHERE id=$1", f.server["id"])
	if err != nil || rolled["startup"] != f.server["startup"] {
		t.Fatal("startup failed to restore invocation", err)
	}
	varCount, err := f.a.one(ctx, "SELECT count(*) AS count FROM server_variables WHERE server_id=$1", f.server["id"])
	if err != nil || num(varCount["count"]) != 0 {
		t.Fatal("startup failed to restore variables", err)
	}
	// A failed sync must restore both image and Java settings.
	f.mu.Lock()
	f.failPath = "/sync"
	f.mu.Unlock()
	config["runtime_id"] = "temurin-25"
	operationsExpect(t, f.request("PUT", path, config, f.admin), 502)
	stored, err := f.a.one(ctx, "SELECT * FROM servers WHERE id=$1", f.server["id"])
	if err != nil || str(stored["image"]) != "ghcr.io/pterodactyl/yolks:java_21" || str(asMap(stored["java_config"])["runtime_id"]) != "auto" {
		t.Fatalf("sync rollback: %v %v", stored["image"], err)
	}
	f.mu.Lock()
	f.failPath = ""
	f.mu.Unlock()
	// Removing the active runtime must leave GET usable and permit repair.
	catalog := javaDefaultRuntimes()
	for _, runtime := range catalog {
		if num(runtime["major"]) == 21 {
			runtime["enabled"] = false
		}
	}
	operationsExpect(t, f.request("PUT", "/api/admin/java/runtimes", M{"runtimes": catalog}, f.owner), 403)
	operationsExpect(t, f.request("PUT", "/api/admin/java/runtimes", M{"runtimes": catalog}, f.admin), 200)
	view := asMap(operationsExpect(t, f.request("GET", path, nil, f.sub), 200)["attributes"])
	if str(view["effective_error"]) == "" || len(asMap(view["effective"])) != 0 {
		t.Fatalf("missing repair information: %v", view)
	}
	operationsExpect(t, f.request("PUT", path, config, f.admin), 200)
	// Daemon configuration receives the selected image and generated launcher.
	stored, err = f.a.one(ctx, "SELECT * FROM servers WHERE id=$1", f.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	wire, err := f.a.serverConfig(ctx, stored)
	if err != nil {
		t.Fatal(err)
	}
	if str(asMap(wire["container"])["image"]) != "ghcr.io/pterodactyl/yolks:java_25" || wire["invocation"] != asMap(wire["environment"])["STARTUP"] || !strings.Contains(str(asMap(wire["environment"])["VOLTRA_JAVA_SCRIPT"]), "-Xmx1024M") {
		t.Fatal("Java settings missing from daemon configuration")
	}
	// Reject a limit change that can no longer contain the configured heap.
	operationsExpect(t, f.request("PATCH", "/api/application/servers/"+str(stored["id"])+"/build", M{"memory": 512}, f.admin), 422)
	// Import/export preserves the Voltra extension, while ordinary eggs stay empty.
	doc, err := f.a.eggExport(ctx, eggID)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, err := parseEggDocument(doc)
	if err != nil || num(asMap(parsed["java_config"])["required_major"]) != 17 {
		t.Fatalf("Java extension roundtrip failed: %v", err)
	}
	client, err := f.a.clientServer(ctx, f.owner, stored)
	if err != nil || client["game"] != "minecraft" {
		t.Fatalf("managed Minecraft detection: %v", err)
	}
	if !boolean(client["java_managed"]) || !strings.Contains(str(client["invocation"]), "-Xmx1024M") || strings.Contains(str(client["invocation"]), "VOLTRA_JAVA_SCRIPT") || strings.Contains(str(client["invocation"]), "-Xmx2G") {
		t.Fatal("client invocation does not describe effective heap")
	}
	startupView := operationsExpect(t, f.request("GET", f.serverPath("/startup"), nil, f.owner), 200)
	meta := asMap(startupView["meta"])
	if !boolean(meta["java_managed"]) || !strings.Contains(str(meta["startup_command"]), "-Xmx1024M") || strings.Contains(str(meta["startup_command"]), "VOLTRA_JAVA_SCRIPT") {
		t.Fatal("Startup command does not describe effective heap")
	}
}

func TestJavaDockerYolksLaunch(t *testing.T) {
	if os.Getenv("JAVA_DOCKER_TESTS") != "1" {
		t.Skip("set JAVA_DOCKER_TESTS=1 to run official Yolks containers")
	}
	for _, major := range []int64{8, 21} {
		t.Run(str(major), func(t *testing.T) {
			image := "ghcr.io/pterodactyl/yolks:java_" + str(major)
			dir := t.TempDir()
			write := func(name, value string) {
				t.Helper()
				if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0644); err != nil {
					t.Fatal(err)
				}
			}
			write("Probe.java", `public class Probe { public static void main(String[] args) { System.out.println("HEAP="+Runtime.getRuntime().maxMemory()); System.out.println("FLAGS="+java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments()); System.out.println("CUSTOM="+System.getProperty("custom")); } }`)
			write("prepare.sh", "set -eu\njavac Probe.java\njar cfe probe.jar Probe Probe.class\n")
			docker := func(extra []string, env M) string {
				t.Helper()
				ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
				defer cancel()
				args := []string{"run", "--rm", "--network", "none", "--mount", "type=bind,source=" + dir + ",target=/home/container"}
				for k := range env {
					args = append(args, "--env", k)
				}
				args = append(args, extra...)
				cmd := exec.CommandContext(ctx, "docker", args...)
				cmd.Env = os.Environ()
				for k, v := range env {
					cmd.Env = append(cmd.Env, k+"="+str(v))
				}
				b, err := cmd.CombinedOutput()
				if err != nil {
					t.Fatalf("Yolks Java%d failed: %v\n%s", major, err, b)
				}
				return string(b)
			}
			docker([]string{"--entrypoint", "bash", image, "prepare.sh"}, M{})
			// Fix the collector so Java8's maxMemory accounting is comparable
			// across hosts with different CPU counts and default collectors.
			effective := M{"major": major, "jvm_args": "-Xms96M -Xmx384M -XX:+UseSerialGC"}
			startup, env, err := javaInvocation(M{}, M{"startup": `java -Xms1G -Xmx2G -XX:MaxRAMPercentage=90 -Dcustom="hello world" -jar {{SERVER_JARFILE}}`}, effective)
			if err != nil {
				t.Fatal(err)
			}
			env["STARTUP"], env["SERVER_JARFILE"] = startup, "probe.jar"
			out := docker([]string{image}, env)
			assertHeap := func(out string) {
				t.Helper()
				for _, line := range strings.Split(out, "\n") {
					if strings.HasPrefix(line, "HEAP=") {
						heap, e := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "HEAP=")), 10, 64)
						if e != nil || heap > 385<<20 || heap < 350<<20 || !strings.Contains(out, "-Xmx384M") || strings.Contains(out, "-Xmx2G") {
							t.Fatalf("generated heap was not applied: %s", line)
						}
						t.Logf("JVM reported maximum heap %.2f MiB", float64(heap)/(1<<20))
						return
					}
				}
				t.Fatal("JVM heap probe missing")
			}
			assertHeap(out)
			if !strings.Contains(out, "CUSTOM=hello world") || !strings.Contains(out, "HEAP=") {
				t.Fatalf("entrypoint lost quoting or startup variables: %s", out)
			}
			if major == 8 {
				return
			}
			write("user_jvm_args.txt", "# custom comment retained\n-Xms1G\n-Xmx2G -XX:MaxRAMPercentage=90\n-Dcustom=\"hello world\"\n-Dliteral=\"literal -Xmx9G\"\n")
			if err = os.MkdirAll(filepath.Join(dir, "libraries"), 0755); err != nil {
				t.Fatal(err)
			}
			write("libraries/unix_args.txt", "-cp . Probe\n")
			for _, customScript := range []bool{false, true} {
				command := "java @libraries/unix_args.txt"
				if customScript {
					write("run.sh", "#!/bin/bash\n# Forge custom startup\njava @user_jvm_args.txt @libraries/unix_args.txt \"$@\"\n")
					command = "bash run.sh"
				}
				startup, env, err = javaInvocation(M{"java_config": M{"memory_mode": "argfile", "args_file": "user_jvm_args.txt"}}, M{"startup": command}, effective)
				if err != nil {
					t.Fatal(err)
				}
				env["STARTUP"] = startup
				out = docker([]string{image}, env)
				assertHeap(out)
				if !strings.Contains(out, "CUSTOM=hello world") {
					t.Fatalf("argfile not consumed: %s", out)
				}
				contents, err := os.ReadFile(filepath.Join(dir, "user_jvm_args.txt"))
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(contents), "# custom comment retained") || !strings.Contains(string(contents), `-Dliteral="literal -Xmx9G"`) || strings.Contains(string(contents), "-Xmx2G") || strings.Count(string(contents), "-Xmx384M") != 1 {
					t.Fatalf("custom args changed or duplicate heap remained: %s", contents)
				}
			}
		})
	}
}

func TestJavaCatalogValidation(t *testing.T) {
	encoded, _ := json.Marshal(javaDefaultRuntimes())
	var values any
	_ = json.Unmarshal(encoded, &values)
	if _, err := javaValidateCatalog(values); err != nil {
		t.Fatal(err)
	}
	if _, err := javaValidateCatalog([]any{asSlice(values)[0], asSlice(values)[0]}); err == nil {
		t.Fatal("duplicate runtime IDs accepted")
	}
}
