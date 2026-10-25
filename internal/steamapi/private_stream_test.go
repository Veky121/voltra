package steamapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPrivateStreamGrantBindingAndCapabilityAllowlist(t *testing.T) {
	g := PrivateStreamGrant{Server: "11111111-1111-1111-1111-111111111111", Owner: strings.Repeat("a", 64), Job: "22222222-2222-2222-2222-222222222222", Nonce: strings.Repeat("b", 64), Action: "run"}
	if g.Validate() != nil {
		t.Fatal("valid grant rejected")
	}
	for _, mutate := range []func(*PrivateStreamGrant){func(v *PrivateStreamGrant) { v.Server = "elsewhere" }, func(v *PrivateStreamGrant) { v.Owner = strings.Repeat("A", 64) }, func(v *PrivateStreamGrant) { v.Job = "" }, func(v *PrivateStreamGrant) { v.Nonce = strings.Repeat("z", 64) }, func(v *PrivateStreamGrant) { v.Action = "readiness" }} {
		v := g
		mutate(&v)
		if v.Validate() == nil {
			t.Fatal("malformed grant accepted")
		}
	}
	g.Action = "reply"
	if g.Validate() != nil {
		t.Fatal("reply grant rejected")
	}
	raw, _ := json.Marshal(g)
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)
	if len(fields) != 5 || fields["server"] != g.Server || fields["nonce"] != g.Nonce {
		t.Fatal("wire field contract changed")
	}
	if PrivateCapability != PrivateVersion || PrivateStreamService != "steam-private-v1" {
		t.Fatal("private protocol identifier changed")
	}
	for _, app := range RegisteredPrivateApps() {
		if !KnownPrivateCapability(PrivateAppCapability(app)) {
			t.Fatal("registered profile not recognized")
		}
	}
	for _, value := range []string{"steam-private-app:42", "steam-private-app:02394010", "steam-private-app:-1", "steam-private-app:2147483648", "steam-private-v1"} {
		if KnownPrivateCapability(value) {
			t.Fatal("unknown private capability accepted", value)
		}
	}
	for _, value := range Capabilities() {
		if value == PrivateCapability || strings.HasPrefix(value, "steam-private-app:") {
			t.Fatal("public capability registry enabled private capability")
		}
	}
}
