package panel

import (
	"bytes"
	"testing"
)

func TestSandstormWave28Preserve(t *testing.T) {
	key := "/Script/Insurgency.INSGameMode/bKillFeed"
	input := []byte("\xef\xbb\xbf; operator\r\n[/Script/Insurgency.INSGameMode]\r\nbKillFeed = False ; keep\r\n+Unknown=(A=1)\r\n+Unknown=(A=2)\r\nPassword=private-fixture\r\n")
	p, e := parseSandstormSettings(input)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.fields) != 1 || p.fields[0].kind != "boolean" {
		t.Fatal("typed allowlist")
	}
	out, e := p.patch(map[string]string{key: "True"})
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(out, bytes.Replace(input, []byte("= False"), []byte("= True"), 1)) {
		t.Fatal("unrelated bytes changed")
	}
	same, e := p.patch(nil)
	if e != nil || !bytes.Equal(same, input) {
		t.Fatal("no op")
	}
	for _, changes := range []map[string]string{{key: "True\nInjected=1"}, {"Password": "changed"}, {key: "1"}} {
		if _, e = p.patch(changes); e == nil {
			t.Fatal("unsafe patch")
		}
	}
}
func TestSandstormWave28Refusal(t *testing.T) {
	for _, body := range []string{"bKillFeed=True\nbKillFeed=False", "bkillfeed=True", "+bKillFeed=True", "bKillFeed=maybe", "bKillFeed=True\n[/Script/Insurgency.INSGameMode]\nbKillFeed=False"} {
		if _, e := parseSandstormSettings([]byte("[/Script/Insurgency.INSGameMode]\n" + body)); e == nil {
			t.Fatal(body)
		}
	}
	for k := range sandstormBooleanDefaults {
		p, e := parseSandstormSettings([]byte("[/Script/Insurgency.INSGameMode]\n" + k[len("/Script/Insurgency.INSGameMode/"):] + "=False\n"))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = p.patch(map[string]string{k: "True"}); e != nil {
			t.Fatal(e)
		}
	}
}
func TestSandstormWave28Authority(t *testing.T) {
	startup := "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/tactical_runtime.py"
	for _, extra := range []string{"", "-Mods -ModList=Mods -Mutators=ISMC"} {
		if e := validateSandstormSettingsAuthority(sandstormSettingsRecipe, sandstormSettingsPath, startup, extra, M{"unrelated.ini": M{}}); e != nil {
			t.Fatal(e)
		}
	}
	for _, extra := range []string{"-ini:Game=Other", "-GameIni=Other", "-UserDir=other", "-ExecCmds=x"} {
		if validateSandstormSettingsAuthority(sandstormSettingsRecipe, sandstormSettingsPath, startup, extra, nil) == nil {
			t.Fatal(extra)
		}
	}
	if validateSandstormSettingsAuthority(sandstormSettingsRecipe, sandstormSettingsPath, startup, "", M{sandstormSettingsPath: M{}}) == nil {
		t.Fatal("Wings conflict")
	}
}
