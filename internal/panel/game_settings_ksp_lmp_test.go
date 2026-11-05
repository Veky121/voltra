package panel

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestKspLMPSettings(t *testing.T) {
	file := "/LMPServer/Config/GeneralSettings.xml"
	raw := []byte("<GeneralSettingsDefinition><!--keep--><ServerName>A &amp; B</ServerName><Password>opaque-secret</Password><MaxPlayers>20</MaxPlayers><Cheats>true</Cheats><Unknown>keep</Unknown></GeneralSettingsDefinition>")
	p, e := parseKspLMPSettings(file, raw)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 3 {
		t.Fatal(p.fields)
	}
	for _, f := range p.fields {
		if f.value == "opaque-secret" {
			t.Fatal("secret leak")
		}
	}
	b, e := p.patch(map[string]string{"ServerName": "<New>", "Cheats": "false"})
	if e != nil || !bytes.Contains(b, []byte("&lt;New&gt;")) || !bytes.Contains(b, []byte("<Password>opaque-secret</Password>")) {
		t.Fatal(string(b), e)
	}
	for _, k := range []string{"Password", "AdminPassword", "Unknown", "Missing"} {
		if _, e = p.patch(map[string]string{k: "x"}); e == nil {
			t.Fatal(k)
		}
	}
	b, e = p.patch(map[string]string{"ServerName": "A & B"})
	if e != nil || !bytes.Equal(b, raw) {
		t.Fatal("no-op")
	}
	for _, x := range []string{"<!DOCTYPE x><GeneralSettingsDefinition/>", "<GeneralSettingsDefinition xmlns='x'/>", "<GeneralSettingsDefinition><Cheats>true</Cheats><cheats>false</cheats></GeneralSettingsDefinition>", "<GeneralSettingsDefinition><Cheats><x/></Cheats></GeneralSettingsDefinition>", "<GeneralSettingsDefinition><Cheats>&bad;</Cheats></GeneralSettingsDefinition>", "<GeneralSettingsDefinition><Cheats/></GeneralSettingsDefinition>"} {
		if _, e := parseKspLMPSettings(file, []byte(x)); e == nil {
			t.Fatal(x)
		}
	}
	for _, name := range []string{"General", "MasterServer", "Website", "Connection", "Gameplay", "Warp", "Log", "Screenshot", "Interval"} {
		f := "/LMPServer/Config/" + name + "Settings.xml"
		root, kinds := kspLMPSchema(f)
		for k, kind := range kinds {
			v := "x"
			switch kind {
			case "bool":
				v = "true"
			case "int", "float":
				v = "1"
			case "readonly":
				v = "28000"
			default:
				if len(kind) > 5 && kind[:5] == "enum:" {
					v = kind[5:]
					for i, c := range v {
						if c == ',' {
							v = v[:i]
							break
						}
					}
				}
			}
			raw := []byte("<" + root + "><" + k + ">" + v + "</" + k + "></" + root + ">")
			p, e := parseKspLMPSettings(f, raw)
			if e != nil {
				t.Fatal(f, k, e)
			}
			_, e = p.patch(map[string]string{k: v})
			if (kind == "readonly") != (e != nil) {
				t.Fatal(k, e)
			}
		}
	}
}
func TestKspLMPAuthority(t *testing.T) {
	in := settingsAuthorityInput{Startup: kspLMPStartup, Files: map[string][]byte{}}
	for _, n := range []string{"ksp_runtime.py", "native_config.py", "native_console.py"} {
		b, e := os.ReadFile(filepath.Join("../../artifacts/game-parity-20261029/wave63-ksp-lmp-settings/emitted", n))
		if e != nil {
			t.Fatal(e)
		}
		in.Files[".voltra/"+n] = b
	}
	f := "/LMPServer/Config/GeneralSettings.xml"
	if _, e := kspLMPSettingsAuthority(kspLMPRecipe, f, in); e != nil {
		t.Fatal(e)
	}
	for _, x := range []string{"../" + f, "/Config/Settings.txt", f + "/"} {
		if _, e := kspLMPSettingsAuthority(kspLMPRecipe, x, in); e == nil {
			t.Fatal(x)
		}
	}
	in.Startup += " --extra"
	if _, e := kspLMPSettingsAuthority(kspLMPRecipe, f, in); e == nil {
		t.Fatal("startup")
	}
	in.Startup = kspLMPStartup
	in.Files[".voltra/ksp_runtime.py"] = []byte("changed")
	if _, e := kspLMPSettingsAuthority(kspLMPRecipe, f, in); e == nil {
		t.Fatal("hash")
	}
}
