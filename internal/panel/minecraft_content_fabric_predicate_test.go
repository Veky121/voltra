package panel

import (
	"encoding/json"
	"os"
	"testing"
)

func TestMinecraftContentFabricOfficialPredicateOracle(t *testing.T) {
	body, e := os.ReadFile("../../tools/runtime/fabric-oracle-fixtures.json")
	if e != nil {
		t.Fatal(e)
	}
	var record struct {
		Fixtures []struct {
			Version  string
			Ranges   []string
			Expected string
		}
	}
	if e = json.Unmarshal(body, &record); e != nil {
		t.Fatal(e)
	}
	if len(record.Fixtures) < 1700 {
		t.Fatal("missing oracle coverage")
	}
	for _, f := range record.Fixtures {
		matched, e := mcFabricPredicateMatches(f.Ranges, f.Version)
		actual := "false"
		if e != nil {
			actual = "error"
		} else if matched {
			actual = "true"
		}
		if actual != f.Expected {
			t.Errorf("version=%q ranges=%q: Go=%s official Java=%s", f.Version, f.Ranges, actual, f.Expected)
		}
	}
}
