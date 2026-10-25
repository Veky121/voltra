package panel

import (
	"context"
	"testing"
)

func TestConsoleConnectorOriginValidationAndScope(t *testing.T) {
	for _, raw := range []string{"https://panel.example", "http://127.0.0.1:18088", "https://panel.example/base"} {
		if got := connectorPanelOrigin(raw); got != raw {
			t.Fatalf("valid origin %q became %q", raw, got)
		}
	}
	for _, raw := range []string{"", "https://user:password@panel.example", "file:///tmp/panel", "https://panel.example?token=secret", "https://panel.example#fragment", "https://panel.example\r\nInjected: bad"} {
		if connectorPanelOrigin(raw) != "" {
			t.Fatalf("unsafe origin accepted: %q", raw)
		}
	}
	a := &App{Config: Config{PublicURL: "https://public.example"}}
	h := a.connectors()
	h.controls[147] = &connectorControl{panelOrigin: "http://127.0.0.1:18088"}
	if got := a.consoleUpstreamOrigin(context.Background(), M{"id": 147, "connection_mode": "outbound"}); got != "http://127.0.0.1:18088" {
		t.Fatal(got)
	}
	for _, n := range []M{{"id": 148, "connection_mode": "outbound"}, {"id": 147, "connection_mode": "direct"}} {
		if got := a.consoleUpstreamOrigin(context.Background(), n); got != "https://public.example" {
			t.Fatalf("origin leaked across node/mode: %q", got)
		}
	}
}
