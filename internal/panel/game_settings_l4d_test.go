package panel

import (
	"bytes"
	"testing"
)

func TestL4DSettingsWithholdsUnverifiedControl(t *testing.T) {
	for _, input := range []string{"sv_alltalk 0\n" + l4dManagedFooter, "SV_ALLTALK \"1\" // operator\r\n", "sv_alltalk 0\nexec other.cfg\n", "// empty\n"} {
		data := []byte(input)
		p, err := parseL4DSettings(data)
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range p.fields {
			if f.kind != "readonly" {
				t.Fatal("unverified typed control")
			}
		}
		for _, changes := range []map[string]string{{"sv_alltalk": "1"}, {"hostname": "new"}, {"unknown": "1"}} {
			if _, err := p.patch(changes); err == nil {
				t.Fatal("unverified mutation accepted")
			}
		}
		if len(data) > 0 {
			data[0] = '!'
		}
		got, err := p.patch(nil)
		if err != nil || string(got) != input {
			t.Fatal("no-op changed original bytes")
		}
		if len(got) > 0 {
			got[0] = '!'
		}
		again, _ := p.patch(nil)
		if !bytes.Equal(again, []byte(input)) {
			t.Fatal("returned bytes alias captured original")
		}
	}
}
