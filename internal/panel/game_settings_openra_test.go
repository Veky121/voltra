package panel

import (
	"strings"
	"testing"
)

func TestOpenRAMiniYAMLTypedSpans(t *testing.T) {
	data := []byte("\ufeff# operator\r\nServer: # section comment\r\n\tPassword: SYNTHETIC-hidden\r\n\tEnableVoteKick: false  # keep this\r\n\tFloodLimitInterval: 5000\r\n\tCustom:\r\n\t\tPassword: SYNTHETIC-nested\r\nOther:\r\n\tToken: SYNTHETIC-other\r\n")
	parsed, err := parseOpenRAMiniYAMLSettings(data)
	if err != nil || len(parsed.fields) != 2 {
		t.Fatalf("parse: %v %#v", err, parsed.fields)
	}
	if parsed.fields[0].kind != "boolean" || parsed.fields[0].value != "False" || parsed.fields[0].on != "True" {
		t.Fatal("boolean schema mismatch")
	}
	if parsed.fields[1].kind != "number" {
		t.Fatal("number missing")
	}
	for _, field := range parsed.fields {
		if strings.Contains(field.value, "SYNTHETIC") {
			t.Fatal("secret exposed")
		}
	}
	actual, err := parsed.patch(map[string]string{"Server.EnableVoteKick": "True", "Server.FloodLimitInterval": "0"})
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(strings.Replace(string(data), "false  # keep this\r\n", "True  # keep this\r\n", 1), "5000\r\n", "0\r\n", 1)
	if string(actual) != want {
		t.Fatalf("unrelated bytes changed: %q", actual)
	}
	again, err := parseOpenRAMiniYAMLSettings(actual)
	if err != nil || again.fields[0].value != "True" {
		t.Fatal("roundtrip", err)
	}
	for _, key := range []string{"Server.Password", "Server.ListenPort", "Server.EnableSingleplayer", "Other.Token", "Server.enablevotekick", "Missing"} {
		if _, err := parsed.patch(map[string]string{key: "True"}); err == nil {
			t.Fatal("forbidden identity editable", key)
		}
	}
}

func TestOpenRAMiniYAMLRefusesAmbiguity(t *testing.T) {
	for _, data := range []string{
		"Server:\n\tEnableVoteKick: True\n\tEnableVoteKick: False\n",
		"Server:\n\tEnableVoteKick: True\n\tenablevotekick: False\n",
		"server:\n\tEnableVoteKick: True\n",
		"Server:\n\tEnableVoteKick: True\nServer:\n\tEnableVoteKick: False\n",
		"Server: unexpected\n\tEnableVoteKick: True\n",
		"Server:\n    EnableVoteKick: True\n",
		"Server:\n\tEnableVoteKick: True\n\t\tChild: False\n",
		"Server:\n\t\tSkippedParent: invalid\n\tEnableVoteKick: True\n",
		"Server:\n\tEnableVoteKick: |\n\t\tscalar: unsupported\n",
		"Server:\n\tEnableVoteKick: True\x00\n",
		"Server:\n\tFloodLimitInterval: 2147483648\n",
		"Server:\n\tFloodLimitInterval: -2147483649\n",
		"Server:\n\tFloodLimitInterval: 1e3\n",
		"Server:\n\tEnableVoteKick: 1\n",
		"Server:\n\tEnableVoteKick: Falſe\n",
	} {
		if _, err := parseOpenRAMiniYAMLSettings([]byte(data)); err == nil {
			t.Fatalf("unsafe accepted: %q", data)
		}
	}
}

func TestOpenRAMiniYAMLNativeDomainsAndInjection(t *testing.T) {
	data := []byte("Server:\n\tEnableVoteKick: True\n\tFloodLimitInterval: 5000\n")
	parsed, err := parseOpenRAMiniYAMLSettings(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"-2147483648", "0", "+0005", "2147483647"} {
		if _, err := parsed.patch(map[string]string{"Server.FloodLimitInterval": value}); err != nil {
			t.Fatal(value, err)
		}
	}
	for _, value := range []string{"True", "true", "FALSE", "False"} {
		if _, err := parsed.patch(map[string]string{"Server.EnableVoteKick": value}); err != nil {
			t.Fatal(value, err)
		}
	}
	for _, value := range []string{"True\nOther: injected", "False\r\n\tPassword: injected", "true\x00", "true #tail", "1", "False; bad", "Falſe"} {
		if _, err := parsed.patch(map[string]string{"Server.EnableVoteKick": value}); err == nil {
			t.Fatal("boolean injection accepted")
		}
	}
	for _, value := range []string{"1\n\tListenPort: 5", "1.5", "NaN", "2147483648", " 5", "5 #tail"} {
		if _, err := parsed.patch(map[string]string{"Server.FloodLimitInterval": value}); err == nil {
			t.Fatal("numeric injection accepted")
		}
	}
}

func TestOpenRAMiniYAMLOpaqueNestedAndMissingValues(t *testing.T) {
	data := []byte("Server:\n\tCustom:\n\t\tEnableVoteKick: False\n\t\tToken: SYNTHETIC\n\tPassword: SYNTHETIC\nOther:\n\tEnableVoteKick: True\n")
	parsed, err := parseOpenRAMiniYAMLSettings(data)
	if err != nil || len(parsed.fields) != 0 {
		t.Fatal("opaque nested exposure", err, parsed.fields)
	}
	if _, err := parsed.patch(map[string]string{"Server.EnableVoteKick": "False"}); err == nil {
		t.Fatal("missing field inserted")
	}
	actual, err := parsed.patch(map[string]string{})
	if err != nil || string(actual) != string(data) {
		t.Fatal("opaque bytes changed", err)
	}
}

func TestOpenRAMiniYAMLActualNativeConsumedSample(t *testing.T) {
	// Actual candidate-created file accepted by publisher engine and observed
	// in its native SyncInfo; only the nested synthetic privacy marker is fake.
	data := []byte(`# Optional native server settings for release-20250330.
# Startup controls own identity, listeners, password, public/auth and replays.
Server:
	QueryMapRepository: True
	EnableSyncReports: True # operator comment retained
	EnableLintChecks: True
	EnableVoteKick: True
	FloodLimitJoinCooldown: 5000
	FloodLimitInterval: 2500
	FloodLimitMessageCount: 5
	FloodLimitCooldown: 15000
	VoteKickTimer: 30000
	VoteKickerCooldown: 120000
	UnknownOperatorGroup:
		Password: SYNTHETIC-HIDDEN-TEST-MARKER
`)
	parsed, err := parseOpenRAMiniYAMLSettings(data)
	if err != nil || len(parsed.fields) != 10 {
		t.Fatal("actual native schema mismatch", err, len(parsed.fields))
	}
	booleans, numbers := 0, 0
	for _, field := range parsed.fields {
		if field.kind == "boolean" {
			booleans++
		}
		if field.kind == "number" {
			numbers++
		}
		if strings.Contains(field.value, "SYNTHETIC") || strings.Contains(field.key, "Password") {
			t.Fatal("opaque secret surfaced")
		}
	}
	if booleans != 4 || numbers != 6 {
		t.Fatal("native type counts", booleans, numbers)
	}
	actual, err := parsed.patch(map[string]string{"Server.EnableSyncReports": "False", "Server.FloodLimitInterval": "3000"})
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(strings.Replace(string(data), "EnableSyncReports: True #", "EnableSyncReports: False #", 1), "FloodLimitInterval: 2500", "FloodLimitInterval: 3000", 1)
	if string(actual) != want {
		t.Fatal("native sample unknown/comment bytes changed")
	}
}
