package panel

import (
	"strings"
	"testing"
)

func TestGameTemplateExcludesDedicatedMinecraftModpacks(t *testing.T) {
	variants := map[string]bool{}
	for _, entry := range gameTemplates().Entries {
		for _, prefix := range []string{"minecraft/java/curseforge/", "minecraft/java/modrinth/", "minecraft/java/ftb/", "minecraft/java/technic/"} {
			if strings.HasPrefix(strings.ToLower(entry.Path), prefix) {
				t.Fatalf("modpack egg remains in setup catalog: %s", entry.Path)
			}
		}
		for _, variant := range []string{"minecraft/java/mohist/", "minecraft/java/glowstone/", "minecraft/bedrock/nukkit/"} {
			if strings.HasPrefix(entry.Path, variant) {
				variants[variant] = true
			}
		}
	}
	if len(variants) != 3 {
		t.Fatal("removing modpacks also removed custom server variants")
	}
}
