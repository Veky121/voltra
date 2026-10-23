package steamapi

import (
	"strings"
	"testing"
)

func TestRequestValidation(t *testing.T) {
	valid := Request{JobID: "11111111-1111-1111-1111-111111111111", ServerUUID: "22222222-2222-2222-2222-222222222222", Operation: "check", AppID: 2394010}
	r := valid
	if err := r.Normalize(); err != nil || r.Branch != "public" {
		t.Fatalf("normalize: %+v %v", r, err)
	}
	for _, change := range []func(*Request){func(r *Request) { r.JobID = "../../oops" }, func(r *Request) { r.ServerUUID = "server" }, func(r *Request) { r.Operation = "delete" }, func(r *Request) { r.AppID = -1 }, func(r *Request) { r.Branch = "public +quit" }, func(r *Request) { r.Branch = "-beta" }, func(r *Request) { r.Branch = "test\n+login" }} {
		r := valid
		change(&r)
		if r.Normalize() == nil {
			t.Fatalf("accepted %+v", r)
		}
	}
}

func TestPrivateBranchOptionsValidation(t *testing.T) {
	base := Request{JobID: "11111111-1111-1111-1111-111111111111", ServerUUID: "22222222-2222-2222-2222-222222222222", Operation: "update", AppID: 1690800, Branch: "experimental", BetaPassword: "private-fixture", Validate: true}
	if err := base.Normalize(); err != nil {
		t.Fatal(err)
	}
	if base.WithoutCredentials().BetaPassword != "" || base.BetaPassword != "private-fixture" {
		t.Fatal("Credential sanitization mutated transport or retained credential")
	}
	for _, secret := range []string{"bad\ncredential", "bad\x00credential", strings.Repeat("x", 1025)} {
		request := base
		request.BetaPassword = secret
		if request.Normalize() == nil {
			t.Fatal("Accepted invalid private branch credential")
		}
	}
	request := base
	request.Branch = "public"
	if request.Normalize() == nil {
		t.Fatal("Accepted credential for public branch")
	}
	if !KnownCapability(OptionsCapability) {
		t.Fatal("Updated node options capability not advertised")
	}
}
