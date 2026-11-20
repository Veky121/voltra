package panel

import (
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func TestWave65Pins(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if !gamesettings.FinalFiveRecipe(entry.Path) {
			continue
		}
		script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
		for _, chunk := range strings.Split(script, "cat > ")[1:] {
			head, body, _ := strings.Cut(chunk, "\n")
			name, marker, ok := strings.Cut(head, " <<'")
			if !ok {
				continue
			}
			expected, _, ok := strings.Cut(body, "\n"+strings.TrimSuffix(marker, "'")+"\n")
			if ok {
				t.Log(entry.Path, name, gamesettings.SettingsAuthorityHash([]byte(expected+"\n")))
			}
		}
	}
}
