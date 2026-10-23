package steamapi

import "testing"

func TestProfileCapabilitiesMatchProtectedPaths(t *testing.T) {
	seen := map[string]bool{}
	for _, capability := range Capabilities() {
		if seen[capability] || !KnownCapability(capability) {
			t.Fatal("invalid capability registry")
		}
		seen[capability] = true
	}
	for _, id := range []int64{1690800, 2394010, 896660, 294420} {
		profile, ok := Profile(id)
		if !ok || len(profile.ProtectedPaths) == 0 || !seen[AppCapability(id)] {
			t.Fatalf("app %d lacks a complete node policy", id)
		}
		profile.ProtectedPaths[0] = "mutated"
		again, _ := Profile(id)
		if again.ProtectedPaths[0] == "mutated" {
			t.Fatal("caller mutated preservation policy")
		}
	}
	if _, ok := Profile(1); ok || KnownCapability("steam-app:1") || KnownCapability("steam-v99") {
		t.Fatal("unknown capability accepted")
	}
}
