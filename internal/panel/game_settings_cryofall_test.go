package panel

import (
	"bytes"
	"strings"
	"testing"
)

func TestCryoFallSettingsSpanRoundtrip(t *testing.T) {
	data := []byte("\ufeff<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<settings version='20'>\r\n<!--operator-->\r\n<network><port>28000</port><ip>0.0.0.0</ip><is_public_server>1</is_public_server><server_private_guid>private-fixture-guid</server_private_guid></network>\r\n<server><name>A&amp;B</name><players_max_count>32</players_max_count><no_client_mods>0</no_client_mods><server_operators_list>PrivateOperator</server_operators_list><license_key>private-fixture-license</license_key><unknown value='&apos;literal&apos;'>keep &amp; bytes</unknown></server>\r\n</settings>\r\n")
	parsed, err := parseCryoFallSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.fields) != 4 {
		t.Fatalf("unexpected public field count: %d", len(parsed.fields))
	}
	fields := map[string]gameSetting{}
	for _, f := range parsed.fields {
		fields[f.key] = f
	}
	if fields["server/name"].value != "A&B" || fields["server/players_max_count"].kind != "number" {
		t.Fatal("incorrect native scalar decoding")
	}
	if f := fields["network/is_public_server"]; f.kind != "boolean" || f.on != "1" || f.off != "0" {
		t.Fatal("native switch values incorrect")
	}
	noOp, err := parsed.patch(map[string]string{"server/name": "A&B"})
	if err != nil || !bytes.Equal(noOp, data) {
		t.Fatal("no-op rewrote entities or unrelated XML")
	}
	changes := map[string]string{"server/name": "New <&\"'", "network/is_public_server": "0", "server/players_max_count": "48"}
	updated, err := parsed.patch(changes)
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(data, []byte("A&amp;B"), []byte("New &lt;&amp;&#34;&#39;"), 1)
	want = bytes.Replace(want, []byte("<is_public_server>1</is_public_server>"), []byte("<is_public_server>0</is_public_server>"), 1)
	want = bytes.Replace(want, []byte("<players_max_count>32</players_max_count>"), []byte("<players_max_count>48</players_max_count>"), 1)
	if !bytes.Equal(updated, want) {
		t.Fatalf("unrelated XML changed: %q", updated)
	}
	reloaded, err := parseCryoFallSettings(updated)
	if err != nil || len(reloaded.fields) != 4 {
		t.Fatalf("roundtrip failed: %v", err)
	}
	for _, f := range reloaded.fields {
		if value, ok := changes[f.key]; ok && f.value != value {
			t.Fatalf("readback mismatch: %s", f.key)
		}
	}
	for _, key := range []string{"network/port", "network/ip", "network/server_private_guid", "server/server_operators_list", "server/license_key", "server/unknown"} {
		if _, exists := fields[key]; exists {
			t.Fatalf("private/runtime field exposed: %s", key)
		}
		if _, err := parsed.patch(map[string]string{key: "overwrite"}); err == nil {
			t.Fatalf("private/runtime patch accepted: %s", key)
		}
	}
}

func TestCryoFallSettingsUnsafeInput(t *testing.T) {
	for _, data := range []string{
		`<!DOCTYPE settings><settings/>`,
		`<!DOCTYPE settings [<!ENTITY x SYSTEM "file:///etc/passwd">]><settings/>`,
		`<?unsafe action?><settings/>`,
		`<settings/><settings/>`,
		`<Settings/>`,
		`<settings xmlns="urn:private"/>`,
		`<settings><server/><server/></settings>`,
		`<settings><Server/></settings>`,
		`<settings><server><name>a</name><Name>b</Name></server></settings>`,
		`<settings><server><name>a</name><name>b</name></server></settings>`,
		`<settings><network><port>1</port><port>2</port></network></settings>`,
		`<settings><server><server_operators_list>a</server_operators_list><server_operators_list>b</server_operators_list></server></settings>`,
		`<settings><server><players_max_count>301</players_max_count></server></settings>`,
		`<settings><server><players_max_count>1.5</players_max_count></server></settings>`,
		`<settings><server><no_client_mods>true</no_client_mods></server></settings>`,
		`<settings><server><name>&unresolved;</name></server></settings>`,
		`<settings version="20" version="21"/>`,
		"<settings><server><name>bad&#10;name</name></server></settings>",
		"<settings><server><name>" + strings.Repeat("x", 65) + "</name></server></settings>",
		"<settings>\x00</settings>",
		"\xff<settings/>",
	} {
		t.Run(data[:min(len(data), 60)], func(t *testing.T) {
			if _, err := parseCryoFallSettings([]byte(data)); err == nil {
				t.Fatal("unsafe XML accepted")
			}
		})
	}
	if _, err := parseCryoFallSettings([]byte(strings.Repeat(" ", 16*1024*1024+1))); err == nil {
		t.Fatal("oversized XML accepted")
	}
	deep := `<settings>` + strings.Repeat(`<x>`, 128) + strings.Repeat(`</x>`, 128) + `</settings>`
	if _, err := parseCryoFallSettings([]byte(deep)); err == nil {
		t.Fatal("deep XML accepted")
	}
}

func TestCryoFallSettingsMixedContentAndSelfClosing(t *testing.T) {
	data := []byte(`<settings><server><name marker='keep' /><players_max_count>30</players_max_count></server></settings>`)
	parsed, err := parseCryoFallSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := parsed.patch(map[string]string{"server/name": "Literal & name"})
	if err != nil {
		t.Fatal(err)
	}
	want := []byte(`<settings><server><name marker='keep' >Literal &amp; name</name><players_max_count>30</players_max_count></server></settings>`)
	if !bytes.Equal(updated, want) {
		t.Fatalf("self-closing edit incorrect: %q", updated)
	}
	if _, err := parseCryoFallSettings(updated); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{`Before<!--keep-->After`, `Before<unknown secret="private-fixture"/>After`} {
		original := []byte(`<settings><server><name>` + name + `</name><players_max_count>30</players_max_count></server></settings>`)
		parsed, err := parseCryoFallSettings(original)
		if err != nil {
			t.Fatal(err)
		}
		if parsed.fields[0].kind != "readonly" || strings.Contains(parsed.fields[0].value, "private-fixture") {
			t.Fatal("complex content is not safely readonly")
		}
		if _, err := parsed.patch(map[string]string{"server/name": "overwrite"}); err == nil {
			t.Fatal("complex content edit accepted")
		}
		updated, err := parsed.patch(map[string]string{"server/players_max_count": "31"})
		if err != nil || !bytes.Equal(updated, bytes.Replace(original, []byte(">30<"), []byte(">31<"), 1)) {
			t.Fatal("complex/unknown XML or comments lost during unrelated edit")
		}
	}
}

func TestCryoFallSettingsPatchValidation(t *testing.T) {
	parsed, err := parseCryoFallSettings([]byte(`<settings><network><is_public_server>0</is_public_server></network><server><name>before</name><players_max_count>30</players_max_count><no_client_mods>0</no_client_mods></server></settings>`))
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]string{
		{"server/name": "bad\n<inject/>"}, {"server/name": "bad\x00value"}, {"server/name": "bad\ufffe"},
		{"server/players_max_count": "0"}, {"server/players_max_count": "301"}, {"server/players_max_count": "2e2"},
		{"network/is_public_server": "true"}, {"server/no_client_mods": "false"}, {"server/server_operators_list": "attacker"},
	} {
		if _, err := parsed.patch(change); err == nil {
			t.Fatalf("unsafe change accepted: %v", change)
		}
	}
}
