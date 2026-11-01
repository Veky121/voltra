package panel

import (
	"strings"
	"testing"
)

func TestUnturnedCommandsFlagPreservation(t *testing.T) {
	// Publisher hosting example command plus startup-emitted commands; synthetic
	// composition, not a native capture or evidence of native consumption.
	original := "// operator\r\nname literal $name \"quote\"\r\npassword fixture-secret\r\nOwner 76561198000000000\r\nWelcome unknown\r\n  cHeAtS  \r\nmap PEI"
	p, err := parseUnturnedCommandsSettings([]byte(original))
	if err != nil {
		t.Fatal(err)
	}
	for _, changes := range []map[string]string{nil, {"Cheats": "true"}} {
		got, err := p.patch(changes)
		if err != nil || string(got) != original {
			t.Fatal("no-op changed bytes", err)
		}
	}
	got, err := p.patch(map[string]string{"Cheats": "false"})
	if err != nil || string(got) != strings.Replace(original, "  cHeAtS  \r\n", "", 1) {
		t.Fatal("flag removal changed other bytes", err)
	}
	for _, changes := range []map[string]string{{"Cheats": "false\nOwner 1"}, {"Cheats": "0"}, {"password": "replacement"}, {"Map": "Washington"}} {
		if _, err := p.patch(changes); err == nil {
			t.Fatal("unsafe patch accepted")
		}
	}
}

func TestUnturnedCommandsAmbiguityAndMissing(t *testing.T) {
	for _, text := range []string{"Cheats\ncheats\n", "Cheats false\n", "Cheats;shutdown\nCheats false", "Cheats\x00\nCheats true"} {
		if _, err := parseUnturnedCommandsSettings([]byte(text)); err == nil {
			t.Fatal("ambiguous flag accepted")
		}
	}
	p, err := parseUnturnedCommandsSettings([]byte("// Cheats\npassword fixture-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.fields) != 2 || p.fields[0].key != "Cheats" || p.fields[0].value != "false" {
		t.Fatal("missing disabled presence flag")
	}
	got, err := p.patch(map[string]string{"Cheats": "true"})
	if err != nil || string(got) != "// Cheats\npassword fixture-secret\nCheats\n" {
		t.Fatal("enable absent flag", err)
	}
	q, err := parseUnturnedCommandsSettings(got)
	if err != nil {
		t.Fatal(err)
	}
	got, err = q.patch(map[string]string{"Cheats": "false"})
	if err != nil || string(got) != "// Cheats\npassword fixture-secret\n" {
		t.Fatal("disable flag", err)
	}
	got, err = p.patch(map[string]string{"Chatrate": "1"})
	if err != nil || string(got) != "// Cheats\npassword fixture-secret\nChatrate 1\n" {
		t.Fatal("insert chatrate", err)
	}

}

func TestUnturnedCommandsChatRate(t *testing.T) {
	original := "password private\r\n ChAtRaTe\t0.25  \r\nCheats\r\nWelcome opaque/1/2/3\n"
	p, err := parseUnturnedCommandsSettings([]byte(original))
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.patch(map[string]string{"Chatrate": "1.5", "Cheats": "false"})
	want := strings.Replace(strings.Replace(original, "0.25", "1.5", 1), "Cheats\r\n", "", 1)
	if err != nil || string(got) != want {
		t.Fatalf("patch mismatch: %v", err)
	}
	for _, v := range []string{"-1", "61", "NaN", "Inf", "1e1", "1\nshutdown", "0/1", " 1", "1;save"} {
		if _, err := p.patch(map[string]string{"Chatrate": v}); err == nil {
			t.Fatalf("accepted %q", v)
		}
	}
	for _, v := range []string{"0", "60", "0.125"} {
		if _, err := p.patch(map[string]string{"Chatrate": v}); err != nil {
			t.Fatal(err)
		}
	}
	for _, s := range []string{"Chatrate 1\nchatrate 2", "Chatrate 61", "Chatrate 1 //comment"} {
		if _, err := parseUnturnedCommandsSettings([]byte(s)); err == nil {
			t.Fatal("invalid command accepted")
		}
	}
}
