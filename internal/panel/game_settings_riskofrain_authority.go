package panel

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"strings"
	"unicode/utf8"
)

const riskOfRainAuthorityRecipe = "risk_of_rain_2/egg-risk-of-rain2.json"
const riskOfRainAuthorityStartup = "exec /usr/bin/python3 .voltra/risk-of-rain-owner.py run"
const riskOfRainOwnerHash = "972540f3ed88d6d02d81a1f719e974af0e75f44673a9b3a40622f01b117e4590"

// reviewRiskOfRainSettingsCandidate validates the candidate's source-provable
// restrictions, not effective engine authority. Files are complete bounded,
// confined Wings reads; a read error must never be represented as absence.
// Keys are volume-relative. Callers must repeat reads after the settings lock.
// This deliberately leaves ScriptsReviewed and NativeSchemaReviewed false:
// imported helpers/mods and current native ordering/escapes remain unproven.
// It must not be used to enable typed writes or as a runtime attestation.
func reviewRiskOfRainSettingsCandidate(recipe, eggStartup, startup string, files map[string][]byte) (riskOfRainSettingsAuthority, error) {
	refused := func() (riskOfRainSettingsAuthority, error) { return riskOfRainSettingsAuthority{}, riskOfRainRefusal }
	if recipe != riskOfRainAuthorityRecipe || eggStartup != riskOfRainAuthorityStartup || startup != eggStartup {
		return refused()
	}
	helper, ok := files[".voltra/risk-of-rain-owner.py"]
	if !ok || fmt.Sprintf("%x", sha256.Sum256(helper)) != riskOfRainOwnerHash {
		return refused()
	}
	prefix := strings.TrimPrefix(riskOfRainSettingsPath, "/")
	data, ok := files[prefix]
	if !ok {
		return refused()
	}
	// Validate candidate grammar without manufacturing native authority.
	if _, err := parseRiskOfRainCandidateGrammar(data); err != nil {
		return refused()
	}
	dir := strings.TrimSuffix(prefix, "server.cfg")
	for _, name := range []string{"server_startup.cfg", "server_pregame.cfg"} {
		data, exists := files[dir+name]
		if !exists {
			continue
		}
		if !utf8.Valid(data) {
			return refused()
		}
		data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
		for _, c := range data {
			if c < 32 && c != 9 && c != 10 && c != 13 || c == 127 {
				return refused()
			}
		}
		// Exact token programs only. Quotes, escapes and arbitrary commands
		// have no place in this reviewed bootstrap subset.
		rows := []string{}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.SplitN(line, "//", 2)[0]
			for _, row := range strings.Split(line, ";") {
				row = strings.TrimSpace(row)
				if row != "" {
					rows = append(rows, row)
				}
			}
		}
		if name == "server_pregame.cfg" {
			if len(rows) != 0 {
				return refused()
			}
			continue
		}
		if len(rows) == 3 && rows[2] == "remove_all_local_users" {
			rows = rows[:2]
		}
		if len(rows) != 2 || (rows[0] != "exec server" && rows[0] != "exec server.cfg") || rows[1] != "host" {
			return refused()
		}
	}
	return riskOfRainSettingsAuthority{ActivePath: riskOfRainSettingsPath, StartupReviewed: true}, nil
}
