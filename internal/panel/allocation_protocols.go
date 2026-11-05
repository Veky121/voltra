package panel

import (
	"encoding/json"
	"sync"
)

var allocationProtocolCatalog struct {
	sync.Once
	entries []gameTemplate
}

// Use recipe identity and exact, unique startup matching for display metadata.
// This lookup does not depend on installer overrides or change forwarding policy.
func allocationProtocolRecipe(egg M) (gameTemplate, bool) {
	allocationProtocolCatalog.Do(func() {
		var catalog templateCatalog
		if json.Unmarshal(gameTemplateCatalogJSON, &catalog) == nil {
			allocationProtocolCatalog.entries = catalog.Entries
		}
	})
	return gameSettingsProfileFrom(egg, allocationProtocolCatalog.entries)
}

// Allocation protocol labels describe the recipe or saved forwarding, not live listeners.
func allocationProtocols(egg M, primary bool, allocationID int64, routes []M) ([]string, string) {
	if primary {
		// Exact startup commands from the reviewed managed recipes. Overrides
		// change recipe UUIDs, so retain these display-only identities too.
		switch str(egg["startup"]) {
		case "exec bash .voltra/mindustry-native-start.sh":
			return []string{"udp", "tcp"}, "game"
		case "java -Xms128M -jar \"{{SERVER_JARFILE}}\" --nogui":
			return []string{"tcp"}, "game"
		case "exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp":
			return []string{"tcp"}, "game"
		}
		if str(egg["uuid"]) == minecraftLibraryEggUUID {
			return []string{"tcp"}, "game"
		}
		if entry, ok := allocationProtocolRecipe(egg); ok {
			// https://github.com/MindustryGame/wiki/blob/master/docs/servers.md
			if entry.Path == "mindustry/egg-mindustry.json" {
				return []string{"udp", "tcp"}, "game"
			}
			if protocols := gameForwardProtocols(entry.Path, "game"); len(protocols) > 0 {
				return protocols, "game"
			}
		}
	}
	seen := map[string]bool{}
	for _, route := range routes {
		if num(route["allocation_id"]) == allocationID {
			seen[str(route["protocol"])] = true
		}
	}
	protocols := []string{}
	for _, protocol := range []string{"udp", "tcp", "http", "https"} {
		if seen[protocol] {
			protocols = append(protocols, protocol)
		}
	}
	if len(protocols) > 0 {
		return protocols, "forwarding"
	}
	return protocols, ""
}
