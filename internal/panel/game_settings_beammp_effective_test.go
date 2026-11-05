package panel

import (
	"encoding/json"
	"github.com/pelletier/go-toml/v2"
	"os"
	"testing"
)

func TestWave167BeamMPEffectiveContract(t *testing.T) {
	b, e := os.ReadFile("../../artifacts/game-parity-20261029/wave167-beammp-effective/effective-cases.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Name, Body string
		Env        M
		Valid      bool
	}
	if e = json.Unmarshal(b, &cases); e != nil {
		t.Fatal(e)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			var d map[string]any
			if e := toml.Unmarshal([]byte(c.Body), &d); e != nil {
				t.Fatal(e)
			}
			e := validateBeamMPEffective(d, c.Env)
			if (e == nil) != c.Valid {
				t.Fatalf("effective acceptance=%v expected=%v", e == nil, c.Valid)
			}
		})
	}
}
