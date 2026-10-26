package panel

import (
	"context"
	"testing"
)

func TestDesktopPairingPublicURLSetting(t *testing.T) {
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	a.Config.PublicURL = "https://panel.example.test"
	if got, err := a.desktopPairingPublicURL(ctx); err != nil || got != a.Config.PublicURL {
		t.Fatalf("default origin: %q, %v", got, err)
	}
	if err := a.exec(ctx, `INSERT INTO settings(key,value) VALUES('desktop.public_url','"https://desktop.example.test"')`); err != nil {
		t.Fatal(err)
	}
	if got, err := a.desktopPairingPublicURL(ctx); err != nil || got != "https://desktop.example.test" {
		t.Fatalf("configured origin: %q, %v", got, err)
	}
	if got := a.panelPublicURL(ctx); got != a.Config.PublicURL {
		t.Fatal("desktop override changed the browser origin")
	}
	if err := a.exec(ctx, `UPDATE settings SET value='true' WHERE key='desktop.public_url'`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.desktopPairingPublicURL(ctx); err == nil {
		t.Fatal("invalid operator setting silently accepted")
	}
}

func TestDesktopPairingURLPreservesBrowserOrigin(t *testing.T) {
	const browser = "https://panel.example.test"
	for _, test := range []struct {
		name       string
		configured any
		want       string
	}{
		{"default", nil, browser},
		{"separate", "https://desktop.example.test/", "https://desktop.example.test"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := desktopPairingURL(browser, test.configured)
			if err != nil || got != test.want {
				t.Fatalf("got %q, %v; want %q", got, err, test.want)
			}
		})
	}
	for _, invalid := range []any{true, 123, "", "http://desktop.example.test", "https://user:pass@desktop.example.test", "https://desktop.example.test/api", "https://desktop.example.test/?token=secret", "https://desktop.example.test/#fragment"} {
		if got, err := desktopPairingURL(browser, invalid); err == nil {
			t.Fatalf("accepted invalid configured origin: %q", got)
		}
	}
}
