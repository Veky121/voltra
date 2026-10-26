package steamapi

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestConsoleLineSanitizesBeforeTransport(t *testing.T) {
	if got := ConsoleLine("\x1b[2J\x1b]0;unsafe\x07Update state (0x61) downloading, progress: 42.00\x00"); got != "Update state (0x61) downloading, progress: 42.00" {
		t.Fatal(got)
	}
	for _, line := range []string{"password=private-value", "Authorization: Bearer secret", "Steam>login username secret", "refresh_token=secret", "Steam Guard code secret"} {
		if got := ConsoleLine(line); strings.Contains(got, "secret") || strings.Contains(got, "private-value") || !strings.Contains(got, "redacted") {
			t.Fatal(got)
		}
	}
	if got := ConsoleLine(strings.Repeat("界", 4000)); len(got) > ConsoleLineBytes || !utf8.ValidString(got) {
		t.Fatal("Unbounded or invalid console line")
	}
}

func TestConsolePreferenceDoesNotChangeDurableRequestIdentity(t *testing.T) {
	r := Request{JobID: "job", StreamOutput: true}
	if r.WithoutCredentials().StreamOutput {
		t.Fatal("stream preference persisted in replay identity")
	}
	if !KnownCapability(ConsoleCapability) {
		t.Fatal("console capability missing")
	}
}
