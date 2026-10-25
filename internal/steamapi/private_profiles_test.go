package steamapi

import "testing"

func TestPrivateCatalogPolicyDoesNotEnableAnonymousSteamCMD(t *testing.T) {
	p, ok := PrivateProfile(2406780)
	if !ok || p.Platform != "linux" || p.Architecture != "64" || len(p.ProtectedPaths) != 2 || p.ProtectedPaths[1] != "Servers" {
		t.Fatal("missing Banana private preservation policy")
	}
	p.ProtectedPaths[0] = "mutated"
	again, _ := PrivateProfile(2406780)
	if again.ProtectedPaths[0] != ".voltra" {
		t.Fatal("caller mutated registered preservation policy")
	}
	if _, ok := Profile(2406780); ok {
		t.Fatal("private-only game acquired an anonymous profile")
	}
	for _, cap := range Capabilities() {
		if cap == AppCapability(2406780) || cap == PrivateAppCapability(2406780) {
			t.Fatal("private policy leaked into public capability advertisement")
		}
	}
	if !KnownPrivateCapability(PrivateAppCapability(2406780)) {
		t.Fatal("registered private policy missing from control validator")
	}
	if _, ok := PrivateProfile(1); ok {
		t.Fatal("unreviewed app accepted")
	}
}
