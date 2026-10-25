package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestNodeInstallerEndpointAdminAndPanelAddress(t *testing.T) {
	t.Setenv("NODE_RELEASE_VERSION", "")
	t.Setenv("NODE_RELEASE_CHANNEL", "beta")
	a, h, admin := pairingTestApp(t)
	release, bodies := nodeFixtureRelease("v1.2.3-beta.2", true)
	calls := 0
	fixture := nodeFixtureApp(t, []nodePublishedRelease{release}, map[string]map[string][]byte{release.Tag: bodies}, &calls)
	a.HTTP = fixture.HTTP
	member, e := a.insert(context.Background(), "users", M{"uuid": newUUID(), "username": "node-installer-member", "email": "node-installer@example.invalid"})
	if e != nil {
		t.Fatal(e)
	}
	path := "/api/admin/node-installer?panel_url=https%3A%2F%2Fpanel.example.com"
	for _, user := range []int64{0, num(member["id"])} {
		status, _ := pairingRequest(t, h, user, "GET", path, "", nil)
		if status == http.StatusOK || calls != 0 {
			t.Fatal("non-admin could resolve installer")
		}
	}
	for _, address := range []string{"https%3A%2F%2Fuser%3Apassword%40panel.example.com", "https%3A%2F%2Fpanel.example.com%23private-token", "http%3A%2F%2Fpublic.example.com"} {
		status, _ := pairingRequest(t, h, admin, "GET", "/api/admin/node-installer?panel_url="+address, "", nil)
		if status != 422 || calls != 0 {
			t.Fatal("unsafe panel address accepted")
		}
	}
	status, result := pairingRequest(t, h, admin, "GET", path, "", nil)
	if status != 200 || result["version"] != release.Tag || result["panel_url"] != "https://panel.example.com" {
		t.Fatal(status, result)
	}
	command := str(result["install_command"])
	if !strings.Contains(command, "'v1.2.3-beta.2' 'https://panel.example.com'") || strings.Contains(command, "private-token") {
		t.Fatal("wrong or sensitive command")
	}
}
