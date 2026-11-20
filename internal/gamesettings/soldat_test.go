package gamesettings

import (
	"bytes"
	"testing"
)

func TestSoldatNativeSafety(t *testing.T) {
	data := []byte("; preserve\r\n[NETWORK]\r\nPort=29120\r\nMax_Players=8\r\nServer_Name=Before\r\nAdmin_Password=fixture\r\nGame_Password=\r\nLobby_Register=0\r\nUnknown=operator ; retain\r\n[GAME]\r\nFriendly_Fire=0\r\nGameStyle=3\r\n")
	p, e := Parse("/soldat.ini", data)
	if e != nil {
		t.Fatal(e)
	}
	p = soldatNativeSettingsSafety("/soldat.ini", p)
	fields := map[string]Setting{}
	for _, f := range p.Fields {
		fields[f.Key] = f
	}
	if fields["NETWORK/Port"].Kind != "readonly" || fields["NETWORK/Lobby_Register"].Kind != "boolean" || fields["GAME/Friendly_Fire"].Kind != "boolean" || fields["GAME/GameStyle"].Kind != "number" {
		t.Fatalf("unexpected native types: %#v", fields)
	}
	out, e := p.Patch(map[string]string{"NETWORK/Max_Players": "6", "NETWORK/Server_Name": "After $ literal"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("Max_Players=8"), []byte("Max_Players=6"), 1)
	want = bytes.Replace(want, []byte("Server_Name=Before"), []byte("Server_Name=After $ literal"), 1)
	if !bytes.Equal(out, want) {
		t.Fatalf("unexpected byte change:\n%s", out)
	}
	for _, c := range []map[string]string{{"NETWORK/Admin_Password": ""}, {"NETWORK/Admin_Password": "   "}, {"NETWORK/Port": "9"}, {"NETWORK/Max_Players": "21"}, {"NETWORK/Max_Players": "2.5"}, {"NETWORK/Server_Name": "bad\nPort=9"}, {"NETWORK/Lobby_Register": "true"}, {"missing": "x"}} {
		if _, e := p.Patch(c); e == nil {
			t.Fatalf("accepted invalid patch %#v", c)
		}
	}
}

func TestSoldatCaseManagedAndFileBoundaries(t *testing.T) {
	if !soldatNativeManaged("/soldat.ini", "network/pOrT") || soldatNativeManaged("/server.ini", "NETWORK/Port") || soldatNativeBit("/other.ini", "GAME/Friendly_Fire") {
		t.Fatal("recipe document/key boundary mismatch")
	}
	for _, file := range []string{"/soldat.ini", "/server.ini"} {
		data := []byte("[NETWORK]\npOrT=29120\n[GAME]\nAutoRecord=1\n")
		p, e := Parse(file, data)
		if e != nil {
			t.Fatal(e)
		}
		p = soldatNativeSettingsSafety(file, p)
		if file == "/soldat.ini" {
			if _, e := p.Patch(map[string]string{"NETWORK/pOrT": "29121"}); e == nil {
				t.Fatal("case-variant managed key accepted")
			}
		}
		if file == "/server.ini" {
			for _, f := range p.Fields {
				if f.Key == "GAME/AutoRecord" && f.Kind != "boolean" {
					t.Fatal("native bit not typed")
				}
			}
		}
	}
}

func TestSoldatLiteralIdentityRemainsText(t *testing.T) {
	for _, name := range []string{"true", "false", "123", "01"} {
		p, e := Parse("/soldat.ini", []byte("[NETWORK]\nServer_Name="+name+"\n"))
		if e != nil {
			t.Fatal(e)
		}
		p = soldatNativeSettingsSafety("/soldat.ini", p)
		if len(p.Fields) != 1 || p.Fields[0].Kind != "text" || p.Fields[0].Value != name {
			t.Fatalf("literal identity type changed for %q: %#v", name, p.Fields)
		}
	}
}
