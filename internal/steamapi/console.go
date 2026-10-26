package steamapi

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const ConsoleLineBytes = 8192
const ConsoleBatchLines = 32

var consoleEscape = regexp.MustCompile(`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]`)
var consoleSecret = regexp.MustCompile(`(?i)(password|passwd|authorization|(?:access|refresh)[_ -]?token|steam[_ -]?guard|guard code|two.factor|(?:\+|>)login\s)`)

// Anonymous SteamCMD output is operator-visible. Remove terminal commands and
// redact credential-bearing lines before they leave the node or enter history.
func ConsoleLine(line string) string {
	line = consoleEscape.ReplaceAllString(strings.ToValidUTF8(line, "�"), "")
	line = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\t' {
			return -1
		}
		return r
	}, line)
	line = strings.TrimSpace(line)
	if consoleSecret.MatchString(line) {
		return "[credential-related Steam output redacted]"
	}
	if len(line) > ConsoleLineBytes {
		line = line[:ConsoleLineBytes]
		for !utf8.ValidString(line) {
			line = line[:len(line)-1]
		}
	}
	return line
}
