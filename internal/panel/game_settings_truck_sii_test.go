package panel

import (
	"bytes"
	"strings"
	"testing"
)

const truckFixture = "\ufeffSiiNunit\r\n{\r\nserver_config : _nameless.123 {\r\n lobby_name: \"A // lobby\" // keep\r\n traffic: true\r\n max_players: 8\r\n timezones: 2\r\n password: \"secret\"\r\n server_logon_token: ABC123\r\n moderator_list: 2\r\n moderator_list[0]: 123\r\n moderator_list[1]: 456\r\n unknown: 42\r\n}\r\nother_unit : _nameless.other {\r\n traffic: false\r\n entries[]: 1\r\n entries[]: 2\r\n}\r\n}\r\n"

func TestTruckSIILossless(t *testing.T) {
	d, e := ParseTruckSII([]byte(truckFixture))
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := d.Values()["password"]; ok {
		t.Fatal("secret exposed")
	}
	got, e := d.Patch(nil)
	if e != nil || string(got) != truckFixture {
		t.Fatal("no-op changed bytes", e)
	}
	got, e = d.Patch(map[string]any{"traffic": false, "lobby_name": "New lobby", "max_players": 4})
	if e != nil {
		t.Fatal(e)
	}
	want := strings.Replace(truckFixture, `lobby_name: "A // lobby"`, `lobby_name: "New lobby"`, 1)
	want = strings.Replace(want, " traffic: true", " traffic: false", 1)
	want = strings.Replace(want, "max_players: 8", "max_players: 4", 1)
	if string(got) != want {
		t.Fatal("unrelated bytes changed")
	}
	if _, e = ParseTruckSII(got); e != nil {
		t.Fatal(e)
	}
}
func TestTruckSIIRefusal(t *testing.T) {
	for _, s := range []string{strings.Replace(truckFixture, " traffic: true", " traffic: true\r\n traffic: false", 1), strings.Replace(truckFixture, " traffic: true", " Traffic: true", 1), strings.Replace(truckFixture, " traffic: true", " traffic: 1", 1), strings.Replace(truckFixture, " unknown: 42", " @include \"x\"", 1), strings.Replace(truckFixture, " unknown: 42", " #include \"x\"", 1), strings.Replace(truckFixture, " unknown: 42", " unknown: exec(x)", 1), strings.Replace(truckFixture, " unknown: 42", " unknown: {", 1), truckFixture + "exec x\n", strings.Replace(truckFixture, " lobby_name: \"A // lobby\"", " lobby_name: \"bad\\q\"", 1)} {
		before := []byte(s)
		copyBefore := append([]byte(nil), before...)
		if _, e := ParseTruckSII(before); e == nil {
			t.Fatalf("accepted unsafe input %q", s)
		}
		if !bytes.Equal(before, copyBefore) {
			t.Fatal("mutated refusal")
		}
	}
	d, e := ParseTruckSII([]byte(truckFixture))
	if e != nil {
		t.Fatal(e)
	}
	for _, c := range []map[string]any{{"password": "x"}, {"connection_dedicated_port": 1}, {"player_damage": true}, {"traffic": "true"}, {"max_players": 9}, {"timezones": -1}, {"lobby_name": "a\nb"}, {"lobby_name": strings.Repeat("a", 64)}, {"traffic": false, "timezones": 3}} {
		if out, e := d.Patch(c); e == nil || out != nil {
			t.Fatal("accepted invalid change", c)
		}
		out, _ := d.Patch(nil)
		if string(out) != truckFixture {
			t.Fatal("refusal mutated source")
		}
	}
}

func TestTruckSIINativeLayout(t *testing.T) {
	source := strings.ReplaceAll(truckFixture, " {\r\n", "\r\n{\r\n")
	source = strings.Replace(source, "ABC123", "6544F7E034119F113526E96474F", 1)
	d, e := ParseTruckSII([]byte(source))
	if e != nil {
		t.Fatal(e)
	}
	out, e := d.Patch(map[string]any{"traffic": false})
	if e != nil {
		t.Fatal(e)
	}
	if string(out) != strings.Replace(source, " traffic: true", " traffic: false", 1) {
		t.Fatal("native layout changed")
	}
}
