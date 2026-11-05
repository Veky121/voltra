package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// These recipes retain the reviewed v1 adapter and do not request ordered stop
// sequences. Stationeers' sequenced console-input repair is a separate version.
// Keep full-byte integrity instead of requiring an unrelated helper refresh.
func reviewedConsoleV1(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("../../tools/runtime/fixtures/native-console-v1.py")
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.ReplaceAll(string(data), "\r\n", "\n"))
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5" {
		t.Fatal("reviewed console fixture changed")
	}
	return data
}

func TestReviewedConsoleV1Recipes(t *testing.T) {
	sequence := regexp.MustCompile(`\bstop_sequence\s*=`)
	for _, recipe := range []string{
		"counter_strike/counter_strike_source/egg-counter--strike--source.json", "team_fortress_2/egg-team-fortress-2.json",
		"half_life_2_deathmatch/egg-half--life2--deathmatch.json", "fof/egg-fof.json", "black_mesa/egg-black-mesa.json",
		"nmrih/egg-nmrih.json", "left4dead/egg-left4dead.json", "left4dead_2/egg-left4dead_2.json", "iosoccer/eggs-iosoccer.json",
		"gta/openmp/egg-open-m-p.json", "gta/mtasa/egg-multi-theft-auto.json", "unturned/egg-unturned.json", "squad/egg-squad.json",
	} {
		t.Run(recipe, func(t *testing.T) {
			found := false
			for name, body := range wave53Emissions(t, recipe) {
				if strings.ReplaceAll(filepath.Base(name), "_", "-") == "native-console.py" {
					found = true
					if string(body) != string(reviewedConsoleV1(t)) {
						t.Fatal("recipe console differs from pinned reviewed version")
					}
				} else if sequence.Match(body) {
					t.Fatalf("ordered-stop caller requires a separate adapter review: %s", name)
				}
			}
			if !found {
				t.Fatal("missing reviewed console helper")
			}
		})
	}
}
