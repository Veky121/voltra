package panel

import (
	"bytes"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// This synthetic edge fixture follows dst_config.configure's emitted sections;
// it is not a publisher capture and does not prove native consumption.
const dstSettingsFixture = "\ufeff; operator\r\n[GAMEPLAY]\r\ngame_mode = survival\r\nmax_players=16\r\npvp=false\r\npause_when_empty=true\r\n[NETWORK]\r\ncluster_name=My cluster\r\ncluster_description=Description\r\ncluster_password=private-test\r\noffline_cluster=true\r\nlan_only_cluster=true\r\n[SHARD]\r\ncluster_key=private-shard-test\r\nmaster_port=10889\r\n[MOD]\r\nunknown=(nested=(token=opaque))\r\n"

func TestDSTSettingsByteEdits(t *testing.T) {
	path := "/DoNotStarveTogether/config/test/cluster.ini"
	data := []byte(dstSettingsFixture)
	p, e := parseDSTSettings(path, data)
	if e != nil {
		t.Fatal(e)
	}
	same, e := p.patch(nil)
	if e != nil || !bytes.Equal(data, same) {
		t.Fatal("read/no-op mutated bytes", e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private-") || strings.Contains(f.value, "opaque") {
			t.Fatal("secret or nested projection", f.key)
		}
	}
	changes := map[string]string{"GAMEPLAY/max_players": "23", "GAMEPLAY/pvp": "true", "GAMEPLAY/game_mode": "endless", "NETWORK/cluster_name": "New cluster"}
	next, e := p.patch(changes)
	if e != nil {
		t.Fatal(e)
	}
	want := strings.NewReplacer("max_players=16", "max_players=23", "pvp=false", "pvp=true", "game_mode = survival", "game_mode = endless", "cluster_name=My cluster", "cluster_name=New cluster").Replace(dstSettingsFixture)
	if string(next) != want {
		t.Fatal("unrelated bytes changed")
	}
	if _, e := parseDSTSettings(path, next); e != nil {
		t.Fatal(e)
	}
	for k, v := range map[string]string{"GAMEPLAY/max_players": "32", "GAMEPLAY/pvp": "1", "NETWORK/cluster_name": "bad\n[SHARD]", "NETWORK/cluster_description": "bad;comment", "NETWORK/cluster_password": "new", "SHARD/master_port": "4", "MOD/unknown": "x", "NETWORK/offline_cluster": "false", "GAMEPLAY/absent": "x"} {
		if _, e := p.patch(map[string]string{k: v}); e == nil {
			t.Fatalf("accepted %s", k)
		}
	}
	for _, bad := range []string{"[GAMEPLAY]\npvp=true\npvp=false\n", "[GAMEPLAY]\nPVP=true\n", "[gameplay]\npvp=true\n", "[GAMEPLAY]\npvp=true\n[GAMEPLAY]\nmax_players=2\n", "[DEFAULT]\npvp=true\n", "[GAMEPLAY]\n pvp=true\n"} {
		if _, e := parseDSTSettings(path, []byte(bad)); e == nil {
			t.Fatalf("accepted ambiguous %q", bad)
		}
	}
	empty, e := parseDSTSettings(path, []byte("; empty\n"))
	if e != nil || len(empty.fields) != 0 {
		t.Fatal("seeded defaults")
	}
	shard, e := parseDSTSettings("/DoNotStarveTogether/config/test/Master/server.ini", []byte("[NETWORK]\nserver_port=10998\n[SHARD]\ncluster_key=private-shard-test\n"))
	if e != nil {
		t.Fatal(e)
	}
	if len(shard.fields) != 1 || shard.fields[0].kind != "readonly" {
		t.Fatal("shard projection")
	}
}
func TestDSTSettingsPinnedAuthority(t *testing.T) {
	data, e := os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string `json:"startup"`
			Scripts struct {
				Installation struct {
					Script string `json:"script"`
				} `json:"installation"`
			} `json:"scripts"`
		} `json:"egg"`
	}
	if e = json.Unmarshal(data, &profiles); e != nil {
		t.Fatal(e)
	}
	egg := profiles[dstSettingsRecipe].Egg
	files := map[string][]byte{}
	re := regexp.MustCompile(`(?s)cat > (\S+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE`)
	for _, m := range re.FindAllStringSubmatch(egg.Scripts.Installation.Script, -1) {
		files["/"+m[1]] = []byte(m[2] + "\n")
	}
	path := "/DoNotStarveTogether/config/custom-42/cluster.ini"
	if e := dstSettingsAuthority(dstSettingsRecipe, egg.Startup, "custom-42", path, 0, files); e != nil {
		t.Fatal(e)
	}
	for _, p := range []string{path + "/../cluster.ini", strings.ToLower(path), strings.ReplaceAll(path, "/", "\\"), "/DoNotStarveTogether/config/server/cluster.ini"} {
		if dstSettingsAuthority(dstSettingsRecipe, egg.Startup, "custom-42", p, 0, files) == nil {
			t.Fatal("path drift", p)
		}
	}
	for _, id := range []string{"", "../custom-42", "custom-42;exec", "custom-42/other"} {
		if dstSettingsAuthority(dstSettingsRecipe, egg.Startup, id, path, 0, files) == nil {
			t.Fatal("identity drift")
		}
	}
	if dstSettingsAuthority(dstSettingsRecipe, egg.Startup+" -cluster other", "custom-42", path, 0, files) == nil {
		t.Fatal("arg drift")
	}
	if dstSettingsAuthority(dstSettingsRecipe, egg.Startup, "custom-42", path, 1, files) == nil {
		t.Fatal("mapping drift")
	}
	for name, b := range files {
		if !strings.HasSuffix(name, ".py") {
			continue
		}
		files[name] = append(bytes.Clone(b), ' ')
		if dstSettingsAuthority(dstSettingsRecipe, egg.Startup, "custom-42", path, 0, files) == nil {
			t.Fatal("helper drift", name)
		}
		files[name] = b
	}
}
