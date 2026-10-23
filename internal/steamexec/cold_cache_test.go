package steamexec

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Each helper starts with a fresh HOME. A metadata helper's cache cannot satisfy
// a later mutation helper. Refresh alone also need not fetch the target app.
// This models the native cold-install failure observed with SteamCMD 1792617903.
type coldCacheDocker struct{ *fakeDocker }

func (d coldCacheDocker) Run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) > 0 && args[0] == "run" && contains(args, "+app_update") {
		login, refresh, target, update := -1, -1, -1, -1
		var fetchedApp, updateApp string
		for i, arg := range args {
			switch arg {
			case "+login":
				login = i
			case "+app_info_update":
				if i+1 < len(args) && args[i+1] == "1" {
					refresh = i
				}
			case "+app_update":
				update = i
				if i+1 < len(args) {
					updateApp = args[i+1]
				}
			case "+app_info_print":
				target = i
				if i+1 < len(args) {
					fetchedApp = args[i+1]
				}
			}
		}
		if login < 0 || refresh <= login || target <= refresh || target >= update || fetchedApp != updateApp {
			_, _ = io.WriteString(out, "ERROR! Failed to install app '2394010' (Missing configuration)\n")
			return errors.New("cold mutation session has no app configuration")
		}
	}
	return d.fakeDocker.Run(ctx, args, out)
}

func TestMutationFetchesTargetInItsOwnColdAppInfoCache(t *testing.T) {
	for _, operation := range []string{"install", "update", "verify"} {
		t.Run(operation, func(t *testing.T) {
			executor, docker := fixture(t)
			if err := os.Remove(filepath.Join(docker.dir, "steamapps/appmanifest_2394010.acf")); err != nil {
				t.Fatal(err)
			}
			executor.docker = coldCacheDocker{docker}
			result := terminal(t, execute(executor, req(operation)))
			if result.Type != "result" || result.InstalledBuild != "200" {
				t.Fatalf("cold %s failed: %+v", operation, result)
			}
			config, err := os.ReadFile(filepath.Join(docker.dir, "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"))
			if err != nil || string(config) != "password=PRIVATE_CONFIG" {
				t.Fatal("native configuration was not preserved", err)
			}
			for _, args := range docker.snapshot() {
				if contains(args, "+app_update") {
					if contains(args, "validate") != (operation == "verify") || !strings.Contains(strings.Join(args, " "), "-beta public") {
						t.Fatal("branch or validation semantics changed", args)
					}
				}
			}
		})
	}
}
