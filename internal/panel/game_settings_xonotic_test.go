package panel

import (
	"strings"
	"sync"
	"testing"
)

func TestXonoticTypedRoundTrip(t *testing.T) {
	before := "// operator\r\r\n\tSeTa\tg_friendlyfire \"0.5\" // keep\r\r\nsv_taunt 1\r\nset g_warmup_limit 180\nset rcon_password \"private-sentinel\"\nunknown_command \"retained\"\n"
	p, e := parseXonoticSettings([]byte(before))
	if e != nil || len(p.fields) != 3 {
		t.Fatalf("fields %+v err %v", p.fields, e)
	}
	same, e := p.patch(nil)
	if e != nil || string(same) != before {
		t.Fatal("no-op changed bytes", e)
	}
	after, e := p.patch(map[string]string{"g_friendlyfire": "0.25", "sv_taunt": "0", "g_warmup_limit": "-1"})
	want := strings.Replace(before, `"0.5"`, `"0.25"`, 1)
	want = strings.Replace(want, "sv_taunt 1", "sv_taunt 0", 1)
	want = strings.Replace(want, "g_warmup_limit 180", "g_warmup_limit -1", 1)
	if e != nil || string(after) != want {
		t.Fatal("prefix/comment/unknown spans changed", string(after), e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private-sentinel") || strings.Contains(f.key, "password") {
			t.Fatal("secret exposed")
		}
	}
}

func TestXonoticAmbiguityReadonly(t *testing.T) {
	for _, tail := range []string{"G_FRIENDLYFIRE 0.2", "set g_friendlyfire 0.2", "set \"g_friendlyfire\" \"0.2\"", "seta \"g_friendlyfire\" \"0.2\"", "exec\"operator.cfg\"", "set $selector 0.2", "defer 2 g_friendlyfire 0.2", "cvar_resettodefaults_all", "\"g_friendlyfire\" \"0.2\"", "\"exec\" \"operator.cfg\"", "exec operator.cfg", "alias apply \"g_friendlyfire 1\"", "toggle g_friendlyfire", "settemp g_friendlyfire 1", "loadconfig operator.cfg", "if 1 g_friendlyfire 1", "map stormkeep", "wait", "g_friendlyfire 1;quit"} {
		t.Run(tail, func(t *testing.T) {
			before := "g_friendlyfire 0.5\n" + tail + "\n"
			p, e := parseXonoticSettings([]byte(before))
			if e != nil {
				t.Fatal(e)
			}
			if _, e = p.patch(map[string]string{"g_friendlyfire": "0.25"}); e == nil {
				t.Fatal("ambiguous control writable")
			}
			same, e := p.patch(nil)
			if e != nil || string(same) != before {
				t.Fatal("readonly no-op changed bytes")
			}
		})
	}
	// Cvar_FindVar uses strcmp: a lone uppercase name does not configure the known lowercase cvar.
	p, _ := parseXonoticSettings([]byte("G_FRIENDLYFIRE 0.5\n"))
	if _, e := p.patch(map[string]string{"g_friendlyfire": "0.25"}); e == nil {
		t.Fatal("case-sensitive native cvar falsely writable")
	}
}

func TestXonoticTypedBoundsAndIsolation(t *testing.T) {
	p, _ := parseXonoticSettings([]byte("g_friendlyfire 0.5\nsv_taunt 1\ng_warmup_limit 180\nsv_maxidle 0\n"))
	for k, values := range map[string][]string{"g_friendlyfire": {"-0.1", "1.1", "NaN", "1;quit"}, "sv_taunt": {"true", "2"}, "g_warmup_limit": {"-2", "1.5", "86401"}, "sv_maxidle": {"-1", "2\nquit"}, "port": {"29109"}, "rcon_password": {"secret"}} {
		for _, v := range values {
			if _, e := p.patch(map[string]string{k: v}); e == nil {
				t.Fatal("unsafe value accepted", k, v)
			}
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a, _ := parseXonoticSettings([]byte("g_friendlyfire 0.5\n"))
			if _, e := a.patch(map[string]string{"g_friendlyfire": "0.25"}); e != nil {
				t.Error(e)
			}
			b, _ := parseSourceSettings([]byte("mp_friendlyfire 0\n"))
			if _, e := b.patch(map[string]string{"mp_friendlyfire": "0.25"}); e == nil {
				t.Error("CS2 schema weakened")
			}
		}()
	}
	wg.Wait()
}

func TestXonoticMalformedRefusal(t *testing.T) {
	for _, v := range [][]byte{[]byte("\ufeffsv_taunt 1"), {0xff}, []byte("sv_taunt 1\rquit"), []byte("sv_taunt 1\u2028quit"), []byte(strings.Repeat("x", 65537))} {
		if _, e := parseXonoticSettings(v); e == nil {
			t.Fatal("unsafe document accepted")
		}
	}
}
