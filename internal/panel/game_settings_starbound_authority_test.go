package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func starboundAuthorityFixture() starboundAuthorityInput {
	return starboundAuthorityInput{Recipe: starboundAuthorityRecipe, Startup: starboundAuthorityStartup, EggStartup: starboundAuthorityStartup, RuntimeSHA256: starboundAuthorityRuntimeSHA256, BootState: "regular", Boot: []byte(`{"assetDirectories":["assets/","mods/"],"storageDirectory":"storage"}`), Environment: map[string]string{"SERVER_PORT": "21025", "VOLTRA_ALLOCATED_PORTS": "21025"}}
}

func TestStarboundAuthorityRefusal(t *testing.T) {
	cases := []struct {
		name, code string
		change     func(*starboundAuthorityInput)
	}{
		{"absent", "boot_absent", func(i *starboundAuthorityInput) { i.BootState = "absent" }},
		{"symlink", "boot_unsafe", func(i *starboundAuthorityInput) { i.BootState = "unsafe" }},
		{"wrong root", "boot_malformed", func(i *starboundAuthorityInput) { i.Boot = []byte(`[]`) }},
		{"malformed", "boot_malformed", func(i *starboundAuthorityInput) { i.Boot = []byte(`{"storageDirectory":`) }},
		{"trailing", "boot_malformed", func(i *starboundAuthorityInput) { i.Boot = append(i.Boot, []byte(` {}`)...) }},
		{"missing storage", "storage_absent", func(i *starboundAuthorityInput) { i.Boot = []byte(`{}`) }},
		{"wrong type", "storage_type", func(i *starboundAuthorityInput) { i.Boot = []byte(`{"storageDirectory":null}`) }},
		{"duplicate", "boot_duplicate", func(i *starboundAuthorityInput) {
			i.Boot = []byte(`{"storageDirectory":"storage","storageDirectory":"storage"}`)
		}},
		{"case duplicate", "boot_duplicate", func(i *starboundAuthorityInput) {
			i.Boot = []byte(`{"storageDirectory":"storage","StorageDirectory":"other"}`)
		}},
		{"nested duplicate", "boot_duplicate", func(i *starboundAuthorityInput) {
			i.Boot = []byte(`{"storageDirectory":"storage","x":[{"a":1,"A":2}]}`)
		}},
		{"custom", "storage_custom", func(i *starboundAuthorityInput) { i.Boot = []byte(`{"storageDirectory":"../storage"}`) }},
		{"original launcher", "launcher", func(i *starboundAuthorityInput) { i.Startup = "./starbound_server" }},
		{"argv override", "launcher", func(i *starboundAuthorityInput) { i.Startup += " -bootconfig other" }},
		{"egg drift", "launcher", func(i *starboundAuthorityInput) { i.EggStartup = "other" }},
		{"wrong identity", "launcher", func(i *starboundAuthorityInput) { i.Recipe = "imported-name-only" }},
		{"helper drift", "launcher_unattested", func(i *starboundAuthorityInput) { i.RuntimeSHA256 = "unknown" }},
		{"Wings overwrite", "launcher_unattested", func(i *starboundAuthorityInput) { i.ConfigOverwrites = true }},
		{"update override", "update_precedence", func(i *starboundAuthorityInput) { i.Environment["VOLTRA_STEAM_AUTO_UPDATE"] = "1" }},
		{"wrong app", "environment", func(i *starboundAuthorityInput) { i.Environment["SRCDS_APPID"] = "1" }},
		{"unallocated", "environment", func(i *starboundAuthorityInput) { i.Environment["SERVER_PORT"] = "21026" }},
		{"injection", "environment", func(i *starboundAuthorityInput) { i.Environment["SERVER_PORT"] = "21025;id" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := starboundAuthorityFixture()
			tc.change(&in)
			before, _ := json.Marshal(in)
			b, err := starboundActiveConfigAuthority(in)
			if err == nil || err.Error() != tc.code || b.Path != "" || b.Digest != "" {
				t.Fatalf("binding=%+v error=%v want %s", b, err, tc.code)
			}
			after, _ := json.Marshal(in)
			if string(before) != string(after) {
				t.Fatal("input mutated")
			}
		})
	}
	for _, s := range []string{"/storage", "./storage", "storage/", "Storage", "storage/../storage", "C:\\storage"} {
		in := starboundAuthorityFixture()
		in.Boot, _ = json.Marshal(map[string]string{"storageDirectory": s})
		if _, e := starboundActiveConfigAuthority(in); e == nil {
			t.Fatalf("custom storage accepted %q", s)
		}
	}
}

func TestStarboundAuthorityBinding(t *testing.T) {
	in := starboundAuthorityFixture()
	b, e := starboundActiveConfigAuthority(in)
	if e != nil || b.Path != "/storage/starbound_server.config" || len(b.Digest) != 64 {
		t.Fatalf("%+v %v", b, e)
	}
	original := b.Digest
	in.Boot = append(in.Boot, ' ')
	b, e = starboundActiveConfigAuthority(in)
	if e != nil || b.Digest == original {
		t.Fatal("boot bytes not bound")
	}
	previous := b.Digest
	in.Environment["SERVER_NAME"] = "override preserved but not a gameplay writer"
	b, e = starboundActiveConfigAuthority(in)
	if e != nil || b.Digest == previous {
		t.Fatal("effective env not bound")
	}
	b2, e := starboundActiveConfigAuthority(in)
	if e != nil || b2 != b {
		t.Fatal("unstable binding")
	}
}

func TestStarboundAuthorityReviewedSourceIdentity(t *testing.T) {
	data, e := os.ReadFile("game_library/scripts/starbound-runtime.py")
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != starboundAuthorityRuntimeSHA256 {
		t.Fatal("review runtime contract before changing pinned digest")
	}
	data, e = os.ReadFile("game_library/overrides.json")
	if e != nil {
		t.Fatal(e)
	}
	var profiles map[string]struct {
		Egg struct {
			Startup string
			Config  struct{ Files string }
		}
	}
	if e = json.Unmarshal(data, &profiles); e != nil {
		t.Fatal(e)
	}
	p, ok := profiles[starboundAuthorityRecipe]
	if !ok || p.Egg.Startup != starboundAuthorityStartup || p.Egg.Config.Files != "{}" {
		t.Fatal("canonical imported launcher/config overwrite contract drift")
	}
}
