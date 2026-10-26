package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFS25InspectSavedLicenceLiveReadOnly(t *testing.T) {
	if os.Getenv("FS25_LIVE_INSPECT") != "1" {
		t.Skip("Opt-in GIANTS lookup using an existing saved licence")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(os.Getenv("FS25_LIVE_DATABASE_URL"))
	if err != nil {
		t.Fatal("Live database configuration unavailable")
	}
	cfg.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("Read-only database connection failed")
	}
	defer pool.Close()
	a := &App{DB: pool, Config: Config{EncryptionKey: os.Getenv("FS25_LIVE_ENCRYPTION_KEY")}, HTTP: &http.Client{}}
	entry := farmingSimulatorTemplate()
	if _, err = a.one(ctx, "SELECT id FROM eggs WHERE uuid=$1", gameTemplateEggUUID(entry)); err != nil {
		t.Fatal("Canonical metadata must already exist for read-only acceptance")
	}
	record, err := a.one(ctx, "SELECT * FROM integrations WHERE id=3 AND provider='game_license'")
	if err != nil {
		t.Fatal("Saved acceptance licence missing")
	}
	credentials, err := a.integrationCredentials(record)
	if err != nil {
		t.Fatal("Saved licence could not be resolved privately")
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/admin/fs25/licences/inspect", strings.NewReader(`{"integration_id":3}`))
	a.fs25InspectLicence(w, WithUser(r, 1))
	if w.Code != 200 {
		t.Fatalf("Live lookup status %d", w.Code)
	}
	if strings.Contains(w.Body.String(), str(credentials["license_key"])) {
		t.Fatal("Live lookup exposed key")
	}
	result := M{}
	if json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatal("Invalid inspection response")
	}
	products := asSlice(asMap(result["attributes"])["products"])
	if len(products) < 2 {
		t.Fatal("Expected base game and included MacDon product")
	}
	t.Logf("Read-only GIANTS lookup returned %d named products; no key disclosed", len(products))
}

func fs25InspectForm(id int, caption string) string {
	data, _ := json.Marshal(M{"windows": M{"id": id, "caption": caption}})
	return `<form method="post" action="/download.php" data-default-downloads="` + html.EscapeString(string(data)) + `"></form>`
}

func TestFS25PortalProductNames(t *testing.T) {
	fixture := `<h1>Farming Simulator 25 - Retail Bundle</h1><h3>Farming Simulator 25</h3>` + fs25InspectForm(739, "Windows · IMG · 21 GB") + `<h4>Downloads</h4>` + fs25InspectForm(739, "Windows · IMG · 21 GB") + `<h2>Bonus content</h2><h3>Farming Simulator 25: MacDon Pack</h3><a href="https://cdn1.giants-software.com/FarmingSimulator25_macDonPack.exe?private=not-returned">Download</a>`
	products := fs25PortalProducts(fixture)
	if len(products) != 2 || products[0].Name != "Farming Simulator 25" || products[0].Kind != "game" || products[1].Name != "Farming Simulator 25: MacDon Pack" || products[1].Kind != "dlc" {
		t.Fatalf("Wrong product names: %+v", products)
	}
	raw, _ := json.Marshal(products)
	if strings.Contains(string(raw), "private") || strings.Contains(string(raw), "https:") {
		t.Fatal("Download token returned")
	}
	for _, fixture := range []string{
		`<h1>Farming Simulator 22</h1>` + fs25InspectForm(1, "Windows EXE"),
		`<h1>Farming Simulator 25</h1>` + fs25InspectForm(1, "macOS DMG"),
		`<h1>Farming Simulator 25</h1>` + strings.ReplaceAll(fs25InspectForm(1, "Windows EXE"), "/download.php", "https://evil.test/download.php"),
		`<h1>Farming Simulator 25</h1><a href="https://cdn1.giants-software.com.evil.test/FarmingSimulator25_pack.exe">Download</a>`,
	} {
		if len(fs25PortalProducts(fixture)) != 0 {
			t.Fatal("Unsupported product accepted")
		}
	}
}

type fs25InspectTransport func(*http.Request) (*http.Response, error)

func (f fs25InspectTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFS25LicenceInspectPrivate(t *testing.T) {
	a, _, admin, _, _ := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerIntegrations(mux)
	fixture := `<h1>Farming Simulator 25 - Season Pass</h1><h3>Emergency Pack</h3>` + fs25InspectForm(1, "Windows EXE") + `<h3>Second Pack</h3>` + fs25InspectForm(2, "Windows EXE")
	calls := 0
	a.HTTP = &http.Client{Transport: fs25InspectTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://eshop.giants-software.com/downloads.php" || r.Method != "POST" {
			t.Fatal("Unexpected lookup destination")
		}
		body, _ := io.ReadAll(r.Body)
		values, _ := url.ParseQuery(string(body))
		if values.Get("activationKey") != "PRIVATE-TEST-KEY" {
			t.Fatal("Key not posted privately")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(fixture)), Header: http.Header{"Content-Type": []string{"text/html"}}, Request: r}, nil
	})}
	path := "/api/admin/fs25/licences/inspect"
	result := infraExpect(t, mux, admin, "POST", path, M{"key": "PRIVATE-TEST-KEY"}, 200)
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "PRIVATE-TEST-KEY") || strings.Contains(string(raw), "activationKey") {
		t.Fatal("Key leaked in lookup")
	}
	attrs := asMap(result["attributes"])
	if len(asSlice(attrs["products"])) != 2 || str(attrs["kind"]) != "dlc" || num(attrs["egg_id"]) == 0 {
		t.Fatal("Missing discovered products")
	}
	sealed, _ := a.seal(`{"license_key":"PRIVATE-TEST-KEY"}`)
	record, err := a.insert(t.Context(), "integrations", M{"name": "Saved licence", "provider": "game_license", "egg_id": attrs["egg_id"], "enabled": true, "bindings": M{"license_key": []any{"DLC_PRODUCT_KEY"}}, "credentials": sealed})
	if err != nil {
		t.Fatal(err)
	}
	infraExpect(t, mux, admin, "POST", path, M{"integration_id": record["id"]}, 200)
	user, err := a.insert(t.Context(), "users", M{"uuid": newUUID(), "username": "inspect-ordinary", "email": "inspect@example.test", "root_admin": false, "name_first": "Test", "name_last": "User"})
	if err != nil {
		t.Fatal(err)
	}
	before := calls
	infraExpect(t, mux, num(user["id"]), "POST", path, M{"key": "PRIVATE-TEST-KEY"}, 403)
	if calls != before {
		t.Fatal("Non-admin contacted GIANTS")
	}
	a.HTTP = &http.Client{Transport: fs25InspectTransport(func(*http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("PRIVATE-TEST-KEY provider failure")
	})}
	result = infraExpect(t, mux, admin, "POST", path, M{"key": "PRIVATE-TEST-KEY"}, 502)
	raw, _ = json.Marshal(result)
	if strings.Contains(string(raw), "PRIVATE-TEST-KEY") {
		t.Fatal("Provider error leaked key")
	}
	a.HTTP = &http.Client{Transport: fs25InspectTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://evil.test/?key=PRIVATE-TEST-KEY"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})}
	infraExpect(t, mux, admin, "POST", path, M{"key": "PRIVATE-TEST-KEY"}, 422)
}
