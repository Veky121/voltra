package panel

import (
	"bytes"
	"testing"
)

func TestSoldatNativeSafety(t *testing.T) {
	data := []byte("; preserve\r\n[NETWORK]\r\nPort=29120\r\nMax_Players=8\r\nServer_Name=Before\r\nAdmin_Password=fixture\r\nGame_Password=\r\nLobby_Register=0\r\nUnknown=operator ; retain\r\n[GAME]\r\nFriendly_Fire=0\r\nGameStyle=3\r\n")
	p, e := parseGameSettings("/soldat.ini", data)
	if e != nil {
		t.Fatal(e)
	}
	p = soldatNativeSettingsSafety("/soldat.ini", p)
	fields := map[string]gameSetting{}
	for _, f := range p.fields {
		fields[f.key] = f
	}
	if fields["NETWORK/Port"].kind != "readonly" || fields["NETWORK/Lobby_Register"].kind != "boolean" || fields["GAME/Friendly_Fire"].kind != "boolean" || fields["GAME/GameStyle"].kind != "number" {
		t.Fatalf("unexpected native types: %#v", fields)
	}
	out, e := p.patch(map[string]string{"NETWORK/Max_Players": "6", "NETWORK/Server_Name": "After $ literal"})
	if e != nil {
		t.Fatal(e)
	}
	want := bytes.Replace(data, []byte("Max_Players=8"), []byte("Max_Players=6"), 1)
	want = bytes.Replace(want, []byte("Server_Name=Before"), []byte("Server_Name=After $ literal"), 1)
	if !bytes.Equal(out, want) {
		t.Fatalf("unexpected byte change:\n%s", out)
	}
	for _, c := range []map[string]string{{"NETWORK/Admin_Password": ""}, {"NETWORK/Admin_Password": "   "}, {"NETWORK/Port": "9"}, {"NETWORK/Max_Players": "21"}, {"NETWORK/Max_Players": "2.5"}, {"NETWORK/Server_Name": "bad\nPort=9"}, {"NETWORK/Lobby_Register": "true"}, {"missing": "x"}} {
		if _, e := p.patch(c); e == nil {
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
		p, e := parseGameSettings(file, data)
		if e != nil {
			t.Fatal(e)
		}
		p = soldatNativeSettingsSafety(file, p)
		if file == "/soldat.ini" {
			if _, e := p.patch(map[string]string{"NETWORK/pOrT": "29121"}); e == nil {
				t.Fatal("case-variant managed key accepted")
			}
		}
		if file == "/server.ini" {
			for _, f := range p.fields {
				if f.key == "GAME/AutoRecord" && f.kind != "boolean" {
					t.Fatal("native bit not typed")
				}
			}
		}
	}
}

func TestSoldatLiteralIdentityRemainsText(t *testing.T) {
	for _, name := range []string{"true", "false", "123", "01"} {
		p, e := parseGameSettings("/soldat.ini", []byte("[NETWORK]\nServer_Name="+name+"\n"))
		if e != nil {
			t.Fatal(e)
		}
		p = soldatNativeSettingsSafety("/soldat.ini", p)
		if len(p.fields) != 1 || p.fields[0].kind != "text" || p.fields[0].value != name {
			t.Fatalf("literal identity type changed for %q: %#v", name, p.fields)
		}
	}
}
