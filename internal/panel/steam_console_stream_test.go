package panel

import (
	"context"
	"strings"
	"testing"
	"voltra/internal/steamapi"
)

func TestSteamConnectorOutputReachesSavedConsole(t *testing.T) {
	rt := steamRuntime(t)
	h := rt.app.connectors()
	h.mu.Lock()
	h.controls[num(rt.server["node_id"])].capabilities[steamapi.ConsoleCapability] = true
	h.mu.Unlock()
	rt.request(t, "verify", 202)
	rt.run(t)
	rt.mu.Lock()
	streaming := false
	for _, request := range rt.requests {
		if request.StreamOutput {
			streaming = true
		}
	}
	rt.mu.Unlock()
	if !streaming {
		t.Fatal("output not negotiated")
	}
	rows, err := rt.app.query(context.Background(), "SELECT event,line FROM console_log_entries WHERE server_id=$1 ORDER BY id", rt.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	joined := ""
	for _, row := range rows {
		if str(row["event"]) != "steam output" {
			t.Fatal("incorrect event")
		}
		joined += str(row["line"]) + "\n"
	}
	if !strings.Contains(joined, "progress: 42.00") || !strings.Contains(joined, "Success!") || !strings.Contains(joined, "Steam maintenance complete") {
		t.Fatal(joined)
	}
}
