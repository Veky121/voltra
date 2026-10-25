package steamapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func privateFixtureRequest() PrivateRequest {
	return PrivateRequest{Version: PrivateVersion, Job: "11111111-1111-1111-1111-111111111111", Server: "22222222-2222-2222-2222-222222222222", Owner: strings.Repeat("a", 64), Nonce: strings.Repeat("b", 64), Selection: PrivateSelection{App: 42, Branch: "preview", Platform: "linux", Architecture: "64", Language: "english", DLC: []uint32{}, Protected: []string{}}, ContentBudget: "1048576", RollbackReserve: "4096", CacheQuota: "1048576", DeadlineSeconds: 10}
}
func TestPrivateTypedScope(t *testing.T) {
	r := privateFixtureRequest()
	if e := r.Validate(); e != nil {
		t.Fatal(e)
	}
	scope := r.Scope()
	r.Username = " +literal"
	r.Password = "'?? leading +quit"
	r.BetaPassword = " +literal beta"
	if e := r.Validate(); e != nil {
		t.Fatal(e)
	}
	if r.Scope() != scope {
		t.Fatal("secret in replay identity")
	}
	r.Selection.App++
	if r.Scope() == scope {
		t.Fatal("selection unbound")
	}
	for _, v := range []string{"01", "-1", "18446744073709551616"} {
		r.ContentBudget = v
		if r.Validate() == nil {
			t.Fatal("noncanonical budget accepted")
		}
	}
}
func TestPrivateReceiptFixtureRejected(t *testing.T) {
	r := privateFixtureRequest()
	ref := map[string]any{"scope": r.Scope(), "path": r.Scope().Server + "/" + r.Scope().Owner + "/" + r.Nonce + "/receipt.json", "sha256": strings.Repeat("c", 64), "files": "1", "publisher_plan": map[string]any{"app": 42, "build": "18446744073709551615", "depots": []any{map[string]any{"publisher_app": 42, "depot": 43, "manifest": "18446744073709551615"}}}}
	raw, _ := json.Marshal(ref)
	if e := r.CheckReceipt(raw); e != nil {
		t.Fatal(e)
	}
	ref["fixture_provider"] = "fixture-private-content-v1"
	raw, _ = json.Marshal(ref)
	if r.CheckReceipt(raw) == nil {
		t.Fatal("fixture accepted")
	}
}
func TestPrivateLiteralPoliciesAndFrameBound(t *testing.T) {
	r := privateFixtureRequest()
	for _, v := range []string{"", " +quit", "-literal", "  whitespace  ", "quote'\"\\", "emoji??", "line\naccount", "\x00literal"} {
		r.Username = v
		r.Password = v
		r.Guard = v
		if r.Validate() != nil {
			t.Fatal("parent UTF8 literal policy narrowed")
		}
	}
	r.Password = string([]byte{0xff})
	if r.Validate() == nil {
		t.Fatal("invalid UTF8 accepted")
	}
	r.Password = strings.Repeat("x", 65536)
	if r.Validate() != nil {
		t.Fatal("semantic validation narrowed account field policy")
	}
	r = privateFixtureRequest()
	r.BetaPassword = "\n"
	if r.Validate() == nil {
		t.Fatal("beta newline accepted")
	}
}
func TestPrivatePreviousScopeBinding(t *testing.T) {
	old := privateFixtureRequest()
	ref := &PrivateReceipt{Scope: old.Scope(), SHA256: strings.Repeat("c", 64), Files: "1"}
	ref.Path = ref.Scope.Server + "/" + ref.Scope.Owner + "/" + ref.Scope.Nonce + "/receipt.json"
	ref.PublisherPlan.App = 42
	ref.PublisherPlan.Build = "1"
	raw := []byte(`[{"publisher_app":42,"depot":43,"manifest":"1"}]`)
	json.Unmarshal(raw, &ref.PublisherPlan.Depots)
	next := privateFixtureRequest()
	next.Job = "33333333-3333-3333-3333-333333333333"
	next.Nonce = strings.Repeat("d", 64)
	without := next.Scope()
	next.Previous = ref
	if e := next.Validate(); e != nil {
		t.Fatal(e)
	}
	if next.Scope() == without {
		t.Fatal("previous identity absent from digest")
	}
	ref.SHA256 = strings.Repeat("e", 64)
	if next.Scope().RequestDigest == without.RequestDigest {
		t.Fatal("previous digest unbound")
	}
	ref.Scope.Owner = strings.Repeat("f", 64)
	if next.Validate() == nil {
		t.Fatal("other owner previous accepted")
	}
	ref.Scope.Owner = old.Scope().Owner
	ref.Path = "../../receipt.json"
	if next.Validate() == nil {
		t.Fatal("unsafe previous path accepted")
	}
}
