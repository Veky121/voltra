package steamexec

import (
	"os"
	"strings"
	"testing"
)

func TestPrivateBranchCredentialFailsClosedBeforeDocker(t *testing.T) {
	e, docker := fixture(t)
	secret := "private-branch-fixture-credential"
	r := req("update")
	r.Branch = "preview"
	r.BetaPassword = secret
	r.Validate = true
	result := terminal(t, execute(e, r))
	if result.Type != "error" || !strings.Contains(result.Error, "not enabled") || strings.Contains(result.Error, secret) || strings.Contains(result.Detail, secret) {
		t.Fatal("Private credential did not fail closed with a fixed error")
	}
	if len(docker.snapshot()) != 0 {
		t.Fatal("Unproven private password reached Docker")
	}
	if _, err := os.Stat(e.journal); !os.IsNotExist(err) {
		t.Fatal("Private credential request created a durable journal")
	}
}

func TestRequestedValidationUsesTypedSteamArgument(t *testing.T) {
	e, docker := fixture(t)
	request := req("update")
	request.Validate = true
	terminal(t, execute(e, request))
	seen := false
	for _, args := range docker.snapshot() {
		if contains(args, "+app_update") {
			seen = true
			if !contains(args, "validate") {
				t.Fatal("Requested validation argument missing")
			}
		}
	}
	if !seen {
		t.Fatal("Validation mutation not exercised")
	}
}
