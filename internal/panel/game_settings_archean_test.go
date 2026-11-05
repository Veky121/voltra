package panel

import "testing"

func TestWave154ArcheanParser(t *testing.T) {
	p := "/Archean-data/server/server.ini"
	base, e := parseGameSettingsLines(p, []byte("[server]\nmax_simultaneous_players=4\n"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = base.patch(map[string]string{"server/max_simultaneous_players": "0"}); e != nil {
		t.Fatal(e)
	}
	t.Log("REPRO B actual generic parser accepts players=0")
	for _, body := range []string{"[server]\nmax_simultaneous_players=0\n", "[game]\nspawn=mars\n", "[server]\nserver_online=maybe\n", "[Server]\npassword=x\n"} {
		if _, e := parseArcheanRepairSettings(p, []byte(body)); e == nil {
			t.Fatalf("accepted %q", body)
		}
	}
	parsed, e := parseArcheanRepairSettings(p, []byte(";keep\r\n[server]\r\nmax_simultaneous_players=4\r\npassword=operator\r\n[game]\r\nunknown=untouched\r\n"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = parsed.patch(map[string]string{"server/max_simultaneous_players": "0"}); e == nil {
		t.Fatal("accepted invalid edit")
	}
	if _, e = parsed.patch(map[string]string{"server/max_simultaneous_players": "5"}); e != nil {
		t.Fatal(e)
	}
	t.Log("CANDIDATE typed parser rejects invalid controls, accepts safe player edit")
}
