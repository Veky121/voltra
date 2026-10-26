package panel

import (
	"context"
	"testing"
)

func TestDefaultServerListingIncludesAdministratorAccess(t *testing.T) {
	f := operationsFixtureNew(t)
	outsider, err := f.a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "unrelated", "email": "unrelated@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name  string
		user  M
		query string
		want  int
	}{
		{"admin without ownership or membership", f.admin, "", 1},
		{"owner", f.owner, "", 1},
		{"subuser", f.sub, "", 1},
		{"unrelated user", outsider, "", 0},
		{"explicit administrator owner filter", f.admin, "?type=owner", 0},
		{"explicit administrator remaining filter", f.admin, "?type=admin", 1},
		{"explicit administrator all filter", f.admin, "?type=admin-all", 1},
		{"member cannot request administrator access", f.sub, "?type=admin-all", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := operationsExpect(t, f.request("GET", "/api/client"+test.query, nil, test.user), 200)
			if got := len(asSlice(result["data"])); got != test.want {
				t.Fatalf("listed %d servers; want %d", got, test.want)
			}
		})
	}
}
