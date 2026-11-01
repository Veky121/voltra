package panel

import (
	"bytes"
	"strings"
	"testing"
)

func l4d2AuthorityFixture() ([]string, map[string][]byte) {
	a := strings.Fields("/home/container/srcds_run +mp_gamemode coop -game left4dead2 -console -ip 0.0.0.0 -port 27015 -strictportbind -norestart +sv_lan 1 +exec voltra-login.cfg +map c1m1_hotel")
	f := map[string][]byte{}
	for name, content := range map[string]string{
		"server.cfg":         "// operator\r\nsv_alltalk \"0\" // voice\r\n" + l4d2ManagedFooter,
		"voltra-managed.cfg": "// Managed by the setup form. Advanced settings remain in server.cfg.\nhostname \"test\"\nsv_password \"private\"\nrcon_password \"private-rcon\"\nsv_lan 1\n",
		"voltra-variant.cfg": "z_difficulty \"Normal\"\nsv_allow_lobby_connect_only 0\n",
		"voltra-login.cfg":   "// Anonymous game server login.\n",
		"voltra-server.cfg":  "exec server.cfg\nexec voltra-managed.cfg\nexec voltra-variant.cfg\n",
	} {
		f["/left4dead2/cfg/"+name] = []byte(content)
	}
	return a, f
}

func TestL4D2AuthorityFooterPreservesBytes(t *testing.T) {
	a, f := l4d2AuthorityFixture()
	p, e := resolveL4D2Settings(l4d2SettingsRecipe, l4d2CanonicalStartup, a, f)
	if e != nil {
		t.Fatal(e)
	}
	before := bytes.Clone(f[l4d2SettingsPath])
	next, e := p.patch(map[string]string{"sv_alltalk": "1"})
	if e != nil || string(next) != strings.Replace(string(before), "\"0\"", "\"1\"", 1) {
		t.Fatalf("patch failed: %v", e)
	}
	if !bytes.Equal(before, f[l4d2SettingsPath]) {
		t.Fatal("mutated snapshot")
	}
	same, e := p.patch(nil)
	if e != nil || !bytes.Equal(same, before) {
		t.Fatal("no-op changed bytes")
	}
	// Bare parsing still refuses executable statements; only resolver strips footer.
	bare, e := parseL4D2Settings(before)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = bare.patch(map[string]string{"sv_alltalk": "1"}); e == nil {
		t.Fatal("bare parser accepted exec")
	}
}

func TestL4D2AuthorityShadowsAndChains(t *testing.T) {
	cases := map[string]func(map[string][]byte){
		"autoexec": func(f map[string][]byte) { f["/left4dead2/cfg/autoexec.cfg"] = []byte("sv_alltalk 1\n") },
		"addon":    func(f map[string][]byte) { f["/left4dead2/addons/test.vpk"] = []byte("opaque") },
		"mutation": func(f map[string][]byte) { f["/left4dead2/scripts/test.nut"] = nil },
		"missing":  func(f map[string][]byte) { delete(f, "/left4dead2/cfg/voltra-managed.cfg") },
		"managed override": func(f map[string][]byte) {
			f["/left4dead2/cfg/voltra-managed.cfg"] = append(f["/left4dead2/cfg/voltra-managed.cfg"], []byte("sv_alltalk 1\n")...)
		},
		"variant exec": func(f map[string][]byte) { f["/left4dead2/cfg/voltra-variant.cfg"] = []byte("exec other.cfg\n") },
		"footer tail": func(f map[string][]byte) {
			f[l4d2SettingsPath] = append(f[l4d2SettingsPath], []byte("sv_alltalk 1\n")...)
		},
		"reordered": func(f map[string][]byte) {
			f[l4d2SettingsPath] = []byte(strings.Replace(string(f[l4d2SettingsPath]), "exec voltra-managed.cfg\nexec voltra-variant.cfg", "exec voltra-variant.cfg\nexec voltra-managed.cfg", 1))
		},
		"duplicate footer": func(f map[string][]byte) {
			f[l4d2SettingsPath] = append(f[l4d2SettingsPath], []byte(l4d2ManagedFooter)...)
		},
		"login chain": func(f map[string][]byte) { f["/left4dead2/cfg/voltra-login.cfg"] = []byte("exec other.cfg\n") },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			a, f := l4d2AuthorityFixture()
			change(f)
			if _, e := resolveL4D2Settings(l4d2SettingsRecipe, l4d2CanonicalStartup, a, f); e == nil {
				t.Fatal("accepted shadow or executable chain")
			}
		})
	}
	// Even a second exec in the operator prefix never becomes writable.
	a, f := l4d2AuthorityFixture()
	f[l4d2SettingsPath] = append([]byte("exec other.cfg\n"), f[l4d2SettingsPath]...)
	p, e := resolveL4D2Settings(l4d2SettingsRecipe, l4d2CanonicalStartup, a, f)
	if e != nil {
		return
	}
	if _, e = p.patch(map[string]string{"sv_alltalk": "1"}); e == nil {
		t.Fatal("accepted operator exec")
	}
}

func TestL4D2AuthorityArgv(t *testing.T) {
	a, _ := l4d2AuthorityFixture()
	if !l4d2ManagedArgv(a) {
		t.Fatal("canonical argv rejected")
	}
	optional := append(append(append([]string{}, a[:12]...), "+clientport", "27016"), a[12:]...)
	if !l4d2ManagedArgv(optional) {
		t.Fatal("optional client port rejected")
	}
	for _, bad := range [][]string{append(append([]string{}, a...), "+exec", "other.cfg"), append([]string{"srcds_run"}, a[1:]...), append(append([]string{}, a[:2]...), append([]string{"mutation"}, a[3:]...)...), a[:12]} {
		if l4d2ManagedArgv(bad) {
			t.Fatal("accepted custom argv")
		}
	}
	_, f := l4d2AuthorityFixture()
	if _, e := resolveL4D2Settings(l4d2SettingsRecipe, l4d2CanonicalStartup+" ", a, f); e == nil {
		t.Fatal("accepted custom startup")
	}
}
