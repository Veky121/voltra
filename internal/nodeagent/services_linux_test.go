//go:build linux

package nodeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSteamServiceWritePathsLegacyUpgradeAndCustomRefusal(t *testing.T) {
	for _, scenario := range []string{"upgrade", "custom", "home-storage"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			bin := filepath.Join(dir, "bin")
			_ = os.MkdirAll(bin, 0755)
			log := filepath.Join(dir, "commands")
			t.Setenv("COMMAND_LOG", log)
			t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
			_ = os.WriteFile(filepath.Join(bin, "wings"), []byte("#!/bin/sh\nexit 0\n"), 0755)
			_ = os.WriteFile(filepath.Join(bin, "systemctl"), []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$COMMAND_LOG\"\nexit 0\n"), 0755)
			root := filepath.Join(dir, "data")
			storage := filepath.Join(root, "volumes")
			wings := filepath.Join(dir, "wings.yml")
			writeConfig := func(storage string) {
				t.Helper()
				raw := fmt.Sprintf("system:\n  root_directory: %s\n  data: %s\n", root, storage)
				if err := os.WriteFile(wings, []byte(raw), 0600); err != nil {
					t.Fatal(err)
				}
			}
			writeConfig(storage)
			o := SetupOptions{StartServices: true, Out: io.Discard, ConfigPath: filepath.Join(dir, "node.json"), WingsConfigPath: wings, SystemdDir: filepath.Join(dir, "systemd"), SteamJournalPath: filepath.Join(dir, "steam-jobs")}
			if err := installServices(context.Background(), o); err != nil {
				t.Fatal(err)
			}
			nodePath, _ := unitArg(o.ConfigPath)
			configPath, _ := unitArg(filepath.Dir(o.ConfigPath))
			unitPath := filepath.Join(o.SystemdDir, "voltra-node.service")
			legacy := nodeServiceUnit(nodePath, configPath)
			if scenario == "custom" {
				legacy += "# operator settings\n"
			}
			if err := os.WriteFile(unitPath, []byte(legacy), 0644); err != nil {
				t.Fatal(err)
			}
			if scenario == "home-storage" {
				writeConfig("/home/voltra/games")
			}
			_ = os.WriteFile(log, nil, 0600)
			err := installServices(context.Background(), o)
			if (err == nil) != (scenario == "upgrade") {
				t.Fatalf("%s: %v", scenario, err)
			}
			text, _ := os.ReadFile(unitPath)
			commands, _ := os.ReadFile(log)
			if scenario != "upgrade" {
				if string(text) != legacy || len(commands) != 0 {
					t.Fatal("refusal changed unit or ran systemctl")
				}
				return
			}
			for _, path := range []string{filepath.Dir(o.ConfigPath), o.SteamJournalPath, storage} {
				arg, _ := unitArg(path)
				if !strings.Contains(string(text), arg) {
					t.Fatalf("write path missing: %s", path)
				}
			}
			if !strings.Contains(string(text), "ProtectSystem=strict\nProtectHome=true\n") {
				t.Fatal("lost service sandbox")
			}
			if _, err := os.Stat(o.SteamJournalPath); err != nil {
				t.Fatal("journal not precreated")
			}
			if strings.Contains(string(commands), "restart voltra-wings.service") || !strings.Contains(string(commands), "restart voltra-node.service") {
				t.Fatalf("connector upgrade restarted Wings: %s", commands)
			}
		})
	}
}

func TestServicesActualCommandsAndSafeStatus(t *testing.T) {
	for _, scenario := range []string{"success", "restart-fails", "node-inactive", "storage-fails"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			bin := filepath.Join(dir, "bin")
			if err := os.MkdirAll(bin, 0755); err != nil {
				t.Fatal(err)
			}
			log := filepath.Join(dir, "commands")
			t.Setenv("COMMAND_LOG", log)
			t.Setenv("SCENARIO", scenario)
			t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
			for name, script := range map[string]string{
				"wings": "#!/bin/sh\nexit 0\n",
				"systemctl": `#!/bin/sh
printf '%s\n' "$*" >> "$COMMAND_LOG"
if [ "$SCENARIO" = restart-fails ] && [ "$1" = restart ]; then echo 'TERMINAL_SECRET' >&2; exit 1; fi
if [ "$SCENARIO" = node-inactive ] && [ "$1" = is-active ] && [ "$3" = voltra-node.service ]; then exit 3; fi
exit 0
`,
			} {
				if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0755); err != nil {
					t.Fatal(err)
				}
			}
			root := filepath.Join(dir, "data")
			if scenario == "storage-fails" {
				if err := os.WriteFile(root, []byte("occupied"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			wings := filepath.Join(dir, "wings.yml")
			if err := os.WriteFile(wings, []byte(fmt.Sprintf("system:\n  root_directory: %s\n  data: %s\n", root, filepath.Join(root, "games"))), 0600); err != nil {
				t.Fatal(err)
			}
			var stages []string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/api/remote/connector/status" || r.Header.Get("Authorization") != "Bearer NEW_CONNECTOR_SECRET" {
					t.Error("wrong status endpoint or credential")
				}
				var body map[string]string
				_ = json.NewDecoder(r.Body).Decode(&body)
				if strings.Contains(body["detail"], "SECRET") || strings.Contains(body["detail"], dir) {
					t.Error("unsafe status detail")
				}
				if body["stage"] == "error" && body["detail"] != "Node services failed to start. Check systemd logs on the node." {
					t.Error("nonfixed error detail")
				}
				stages = append(stages, body["stage"])
				w.WriteHeader(204)
			}))
			defer srv.Close()
			var output bytes.Buffer
			err := finishSetup(context.Background(), SetupOptions{StartServices: true, SteamJournalPath: filepath.Join(dir, "steam-jobs"), Out: &output, ConfigPath: filepath.Join(dir, "node.json"), WingsConfigPath: wings, SystemdDir: filepath.Join(dir, "systemd")}, Config{PanelURL: srv.URL, Token: "NEW_CONNECTOR_SECRET", WingsAddress: "127.0.0.1:8080"})
			want := []string{"starting", "error"}
			if scenario == "success" {
				want = []string{"starting", "checking"}
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("service/storage failure ignored")
			}
			if !reflect.DeepEqual(stages, want) {
				t.Fatalf("status=%v want %v", stages, want)
			}
			if scenario == "restart-fails" && !strings.Contains(err.Error(), "journalctl") {
				t.Fatal("failure lacks next action", err)
			}
			if scenario == "storage-fails" && !strings.Contains(err.Error(), "storage") {
				t.Fatal("storage failure lacks next action", err)
			}
			if strings.Contains(output.String(), "TERMINAL_SECRET") {
				t.Fatal("uploaded/logged stderr")
			}
			commands, _ := os.ReadFile(log)
			if scenario == "success" {
				for _, command := range []string{"restart voltra-wings.service voltra-node.service", "is-active --quiet voltra-wings.service", "is-active --quiet voltra-node.service"} {
					if !strings.Contains(string(commands), command) {
						t.Errorf("missing command %s", command)
					}
				}
			}
			if strings.Contains(string(commands), "SECRET") {
				t.Fatal("credential in systemctl argv")
			}
		})
	}
}

func TestRunSavedResumesRecoveryServiceRestartAfterACK(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			dir := t.TempDir()
			bin := filepath.Join(dir, "bin")
			if err := os.MkdirAll(bin, 0755); err != nil {
				t.Fatal(err)
			}
			log := filepath.Join(dir, "commands")
			t.Setenv("COMMAND_LOG", log)
			t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
			exit := "0"
			if fail {
				exit = "1"
			}
			if err := os.WriteFile(filepath.Join(bin, "systemctl"), []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$COMMAND_LOG\"\nexit "+exit+"\n"), 0755); err != nil {
				t.Fatal(err)
			}
			var stages []string
			connections := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer NEW_CONNECTOR_SECRET" {
					t.Error("old credential used")
				}
				if r.URL.Path == "/api/remote/connector/status" {
					var body map[string]string
					_ = json.NewDecoder(r.Body).Decode(&body)
					stages = append(stages, body["stage"])
					w.WriteHeader(204)
					return
				}
				if r.URL.Path != "/api/remote/connector" {
					t.Error("resume enrolled or ACKed again")
				}
				connections++
				w.WriteHeader(401)
			}))
			defer srv.Close()
			path := filepath.Join(dir, "node.json")
			c := SavedConfig{Config: Config{PanelURL: srv.URL, Token: "NEW_CONNECTOR_SECRET", WingsAddress: "127.0.0.1:8080"}, Recovery: true, RestartWings: true}
			if err := saveConfig(path, c, false); err != nil {
				t.Fatal(err)
			}
			err := RunSaved(context.Background(), path)
			saved, loadErr := LoadConfig(path)
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			commands, _ := os.ReadFile(log)
			if strings.Contains(string(commands), "voltra-node.service") {
				t.Fatal("connector attempted to restart itself")
			}
			if fail {
				if err == nil || !saved.RestartWings || connections != 0 || !reflect.DeepEqual(stages, []string{"starting", "error"}) {
					t.Fatalf("failed restart lost journal or connected: %v %v", err, stages)
				}
			} else {
				if !errors.Is(err, errUnauthorized) || saved.RestartWings || connections != 1 || !reflect.DeepEqual(stages, []string{"starting", "checking"}) {
					t.Fatalf("successful restart not persisted before connection: %v %v", err, stages)
				}
				if string(commands) != "restart voltra-wings.service\nis-active --quiet voltra-wings.service\n" {
					t.Fatalf("wrong restart commands: %s", commands)
				}
			}
		})
	}
}
