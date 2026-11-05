package panel

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestAllocationProtocolLabels(t *testing.T) {
	var mindustry M
	var catalog templateCatalog
	if err := json.Unmarshal(gameTemplateCatalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, entry := range catalog.Entries {
		if entry.Path == "mindustry/egg-mindustry.json" {
			mindustry = M{"uuid": gameTemplateEggUUID(entry)}
			break
		}
	}
	if mindustry == nil {
		t.Fatal("Mindustry recipe missing")
	}
	for _, tc := range []struct {
		name    string
		egg     M
		primary bool
		routes  []M
		want    []string
		source  string
	}{
		{"mindustry", mindustry, true, nil, []string{"udp", "tcp"}, "game"},
		{"managed mindustry startup", M{"startup": "exec bash .voltra/mindustry-native-start.sh"}, true, nil, []string{"udp", "tcp"}, "game"},
		{"managed terraria startup", M{"startup": "exec /bin/bash /home/container/TerrariaServer -config serverconfig.txt -noupnp"}, true, nil, []string{"tcp"}, "game"},
		{"minecraft", M{"uuid": minecraftLibraryEggUUID}, true, nil, []string{"tcp"}, "game"},
		{"extra port does not inherit game protocol", mindustry, false, nil, []string{}, ""},
		{"unknown port", M{}, true, nil, []string{}, ""},
		{"forwarding deduplicated", M{}, false, []M{{"allocation_id": int64(7), "protocol": "tcp"}, {"allocation_id": int64(7), "protocol": "udp"}, {"allocation_id": int64(7), "protocol": "tcp"}, {"allocation_id": int64(8), "protocol": "http"}}, []string{"udp", "tcp"}, "forwarding"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, source := allocationProtocols(tc.egg, tc.primary, 7, tc.routes)
			if !reflect.DeepEqual(got, tc.want) || source != tc.source {
				t.Fatalf("got %v %q, want %v %q", got, source, tc.want, tc.source)
			}
		})
	}
}
