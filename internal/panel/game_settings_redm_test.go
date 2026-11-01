package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestRedMPreservation(t *testing.T) {
	raw := []byte("# operator\r\nset gamename rdr3\r\n  sv_hostname  \"Old\" // keep\r\nset sv_lan true # private\r\nsv_maxclients 32\r\nsv_licenseKey \"private-key\"\r\nset steam_webApiKey \"private-steam\"\r\nensure redm-map-one\r\nset unknown 7\r\nset unknown 8")
	p, err := parseRedMSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 2 {
		t.Fatalf("fields: %v", p.fields)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private") {
			t.Fatal("secret exposed")
		}
	}
	unchanged, err := p.patch(nil)
	if err != nil || !bytes.Equal(raw, unchanged) {
		t.Fatal("no-op changed bytes")
	}
	got, err := p.patch(map[string]string{"sv_hostname": "New town", "sv_lan": "false"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(raw, []byte(`"Old"`), []byte(`"New town"`), 1)
	want = bytes.Replace(want, []byte("sv_lan true"), []byte("sv_lan false"), 1)
	if !bytes.Equal(got, want) {
		t.Fatalf("unexpected edit: %s", got)
	}
}

func TestRedMFilesOnly(t *testing.T) {
	for _, suffix := range []string{
		"exec other.cfg", "EXEC other.cfg", "vstr later", `"exec" other.cfg`, "+exec other.cfg",
		"alias later quit", "script do.lua", "set sv_lan true\nsv_lan false",
		"set SV_LAN true", "sv_lan maybe", "sv_hostname", "sv_hostname x\nSV_HOSTNAME y",
		"sv_maxclients 32\nsv_maxplayers 32", "sv_licenseKey x\nset sv_licensekey y",
		"set gamename gta5", `sv_hostname "unterminated`, "unknown x; quit", "unknown { x }",
		"unknown x\\", "sv_hostname x\u2028quit", "sv_hostname x\x00", "sets sv_hostname x",
	} {
		t.Run(suffix, func(t *testing.T) {
			raw := []byte(suffix)
			before := append([]byte(nil), raw...)
			if _, err := parseRedMSettings(raw); err == nil {
				t.Fatal("unsafe config accepted")
			}
			if !bytes.Equal(raw, before) {
				t.Fatal("input mutated")
			}
		})
	}
}

func TestRedMInvalidPatch(t *testing.T) {
	raw := []byte("sv_hostname old\nset sv_lan 1\nsv_maxclients 32\n")
	p, err := parseRedMSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{
		{"sv_lan": "2"}, {"sv_lan": "TRUE"}, {"sv_hostname": "x;quit"}, {"sv_hostname": "x\nquit"},
		{"sv_hostname": `x"`}, {"sv_hostname": `x\`}, {"sv_hostname": strings.Repeat("x", 129)},
		{"sv_hostname": string([]byte{255})}, {"sv_maxclients": "16"}, {"sv_licensekey": "changed"}, {"missing": "x"},
		{"sv_hostname": "valid", "sv_lan": "invalid"},
	} {
		got, e := p.patch(changes)
		if e == nil || got != nil {
			t.Fatalf("accepted %v", changes)
		}
	}
	if string(raw) != "sv_hostname old\nset sv_lan 1\nsv_maxclients 32\n" {
		t.Fatal("input mutated")
	}
}

func TestRedMHostnameUTF8Bytes(t *testing.T) {
	raw := []byte("sv_hostname old\r\nset sv_lan true\r\n")
	p, err := parseRedMSettings(raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{strings.Repeat("x", 128), strings.Repeat("\u00e9", 64), strings.Repeat("\u754c", 42) + "\u00e9", strings.Repeat("\U0001f600", 32)} {
		got, err := p.patch(map[string]string{"sv_hostname": value})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := parseRedMSettings(got); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{strings.Repeat("\u00e9", 65), strings.Repeat("\U0001f600", 33), string([]byte{0xff})} {
		got, err := p.patch(map[string]string{"sv_hostname": value})
		if err == nil || got != nil {
			t.Fatal("invalid UTF8 byte length accepted")
		}
	}
	if string(raw) != "sv_hostname old\r\nset sv_lan true\r\n" {
		t.Fatal("input mutated")
	}
}
