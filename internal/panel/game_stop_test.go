package panel

import "testing"

func TestEggStopSignalCompatibility(t *testing.T) {
	for _, spec := range []struct{ input, kind, value string }{
		{"^C", "signal", "SIGINT"},
		{"^^C", "signal", "SIGINT"},
		{"^c", "signal", "SIGINT"},
		{"^SIGINT", "signal", "SIGINT"},
		{"^sigterm", "signal", "SIGTERM"},
		{"quit", "command", "quit"},
		{"c_shutdown()", "command", "c_shutdown()"},
	} {
		t.Run(spec.input, func(t *testing.T) {
			config := eggDaemonConfig(M{"config_stop": spec.input}, M{})
			stop := asMap(config["stop"])
			if stop["type"] != spec.kind || stop["value"] != spec.value {
				t.Fatalf("unexpected Wings stop configuration: %#v", stop)
			}
		})
	}
}
