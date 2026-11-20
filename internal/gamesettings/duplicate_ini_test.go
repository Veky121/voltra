package gamesettings

import (
	"strings"
	"testing"
)

func TestINIRepeatedKeysPreserveSourceAndOtherEdits(t *testing.T) {
	source := "[OnlineSubsystem]\r\n+Bindings=First ; keep\r\n+Bindings=Second\r\nPort=7777\r\n"
	parsed, err := Parse("Engine.ini", []byte(source))
	if err != nil {
		t.Fatal(err)
	}
	var repeated Setting
	for _, field := range parsed.Fields {
		if field.Key == "OnlineSubsystem/+Bindings" {
			repeated = field
		}
	}
	if repeated.Kind != "readonly" || !strings.Contains(repeated.Value, "Multiple values") {
		t.Fatalf("repeated key must be represented as read-only: %#v", repeated)
	}
	if _, err := parsed.Patch(map[string]string{repeated.Key: "replacement"}); err == nil {
		t.Fatal("patch accepted ambiguous repeated key")
	}
	if _, err := Changes(parsed.Fields, M{repeated.Key: "replacement"}, M{}, "Engine.ini"); err == nil {
		t.Fatal("API validation accepted repeated key")
	}
	updated, err := parsed.Patch(map[string]string{"OnlineSubsystem/Port": "8888"})
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != strings.Replace(source, "Port=7777", "Port=8888", 1) {
		t.Fatal("editing scalar changed repeated values, comments or newline style")
	}
}

func TestTOMLRepeatedKeysRemainInvalid(t *testing.T) {
	if _, err := Parse("server.toml", []byte("[server]\nport=7777\nport=8888\n")); err == nil {
		t.Fatal("invalid TOML duplicate key accepted")
	}
}

func TestINIRepeatedScalarsAndStructuresAreReadOnly(t *testing.T) {
	for _, input := range []string{"x=1\nx=2\n", "[Core.System]\nPaths=First\nPaths=Second\n", "[World]\nOptions=(Enabled=True)\nOptions=(Enabled=False)\n"} {
		parsed, err := Parse("server.ini", []byte(input))
		if err != nil {
			t.Fatal(err)
		}
		if len(parsed.Fields) != 1 || parsed.Fields[0].Kind != "readonly" {
			t.Fatalf("repeated value is editable: %#v", parsed.Fields)
		}
		if _, err := parsed.Patch(map[string]string{parsed.Fields[0].Key: "replacement"}); err == nil {
			t.Fatal("repeated value patch accepted")
		}
	}
}
