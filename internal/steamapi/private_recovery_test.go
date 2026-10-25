package steamapi

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestPrivateRecoveryOriginalScopeAndCredentialAbsence(t *testing.T) {
	r := privateFixtureRequest()
	original, e := PrivateRecoveryOriginalFromRequest(r)
	if e != nil || original.Request().Scope() != r.Scope() {
		t.Fatal("scope changed", e)
	}
	v := PrivateReceiptRecoveryRequest{PrivateRecoveryCapability, "33333333-3333-3333-3333-333333333333", original}
	if v.Validate() != nil {
		t.Fatal("valid recovery denied")
	}
	raw, _ := json.Marshal(v)
	for _, key := range []string{"username", "password", "guard", "beta_password"} {
		for _, value := range []string{`""`, `null`, `"fixture-secret"`} {
			tampered := strings.Replace(string(raw), `"original":{`, `"original":{"`+key+`":`+value+`,`, 1)
			d := json.NewDecoder(bytes.NewBufferString(tampered))
			d.DisallowUnknownFields()
			var decoded PrivateReceiptRecoveryRequest
			if d.Decode(&decoded) == nil {
				t.Fatal("credential key accepted", key, value)
			}
		}
	}
	for _, change := range []func(*PrivateRequest){func(r *PrivateRequest) { r.DeadlineSeconds++ }, func(r *PrivateRequest) { r.Selection.Language = "french" }, func(r *PrivateRequest) { r.ContentBudget = "2000000" }} {
		other := r
		change(&other)
		if other.Scope() == r.Scope() {
			t.Fatal("original fields not bound")
		}
	}
	r.Password = "not-accepted"
	if _, e := PrivateRecoveryOriginalFromRequest(r); e == nil {
		t.Fatal("constructor accepted credentials")
	}
}
func TestPrivateRecoveryGrantAndCapabilityIsolation(t *testing.T) {
	r := privateFixtureRequest()
	g := PrivateStreamGrant{Server: r.Server, Owner: r.Owner, Job: r.Job, Nonce: r.Nonce, Action: "recover", RecoveryID: "33333333-3333-3333-3333-333333333333", RequestDigest: r.Scope().RequestDigest}
	if g.Validate() != nil {
		t.Fatal("valid recovery grant denied")
	}
	for _, action := range []string{"run", "reply"} {
		copy := g
		copy.Action = action
		if copy.Validate() == nil {
			t.Fatal("recovery fields accepted on", action)
		}
	}
	copy := g
	copy.RecoveryID = ""
	if copy.Validate() == nil {
		t.Fatal("missing recoveryID accepted")
	}
	copy = g
	copy.RequestDigest = ""
	if copy.Validate() == nil {
		t.Fatal("missing original digest accepted")
	}
	for _, app := range RegisteredPrivateApps() {
		if !KnownPrivateCapability(PrivateRecoveryAppCapability(app)) {
			t.Fatal("registered recovery capability absent")
		}
	}
	for _, cap := range []string{"steam-private-recovery-app:42", "steam-private-recovery-app:02394010", "steam-private-receipt-recovery-v2"} {
		if KnownPrivateCapability(cap) {
			t.Fatal("unknown capability", cap)
		}
	}
	for _, cap := range Capabilities() {
		if strings.Contains(cap, "private-recovery") || cap == PrivateRecoveryCapability {
			t.Fatal("public registry activated recovery")
		}
	}
}

func TestPrivateRecoveryGrantFieldsForbiddenByPresenceOnOldActions(t *testing.T) {
	r := privateFixtureRequest()
	for _, action := range []string{"run", "reply"} {
		g := PrivateStreamGrant{Server: r.Server, Owner: r.Owner, Job: r.Job, Nonce: r.Nonce, Action: action}
		raw, _ := json.Marshal(g)
		for _, key := range []string{"recovery_id", "request_digest"} {
			for _, value := range []string{`""`, `null`} {
				body := strings.TrimSuffix(string(raw), "}") + `,"` + key + `":` + value + `}`
				var decoded PrivateStreamGrant
				if json.Unmarshal([]byte(body), &decoded) == nil {
					t.Fatal("forbidden metadata presence accepted", action, key)
				}
			}
		}
	}
}

func TestPrivateRecoveryPreviousAndScopeSurviveRoundTrip(t *testing.T) {
	r := privateFixtureRequest()
	scope := r.Scope()
	scope.Job = strings.Repeat("c", 64)
	scope.Nonce = strings.Repeat("d", 64)
	scope.RequestDigest = strings.Repeat("e", 64)
	previous := &PrivateReceipt{Scope: scope, Path: scope.Server + "/" + scope.Owner + "/" + scope.Nonce + "/receipt.json", SHA256: strings.Repeat("f", 64), Files: "1"}
	previous.PublisherPlan.App = r.Selection.App
	previous.PublisherPlan.Build = "1"
	if e := json.Unmarshal([]byte(`[{"publisher_app":42,"depot":43,"manifest":"1"}]`), &previous.PublisherPlan.Depots); e != nil {
		t.Fatal(e)
	}
	r.Previous = previous
	original, e := PrivateRecoveryOriginalFromRequest(r)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(original)
	var decoded PrivateRecoveryOriginal
	if e := json.Unmarshal(raw, &decoded); e != nil {
		t.Fatal(e)
	}
	if decoded.Request().Scope() != r.Scope() || decoded.Previous == nil || decoded.Previous.Scope != previous.Scope {
		t.Fatal("original Previous/digest lost")
	}
}
