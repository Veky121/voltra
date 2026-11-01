package panel

import (
	"os"
	"strings"
	"testing"
)

func TestQuakeLiveCapturedOperator(t *testing.T) {
	file := os.Getenv("QUAKELIVE_NATIVE_CFG")
	if file == "" {
		t.Skip("Private actual native capture not supplied")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	p, err := parseQuakeLiveSettings(data)
	if err != nil || len(p.fields) != 8 {
		t.Fatal("actual publisher fields", len(p.fields), err)
	}
	want := map[string]string{"sv_tags": "local parity arena", "sv_floodprotect": "12", "g_floodprot_maxcount": "15", "g_floodprot_decay": "1200", "g_allowvote": "0", "g_votedelay": "250", "g_votelimit": "3", "g_inactivity": "90"}
	for _, f := range p.fields {
		if f.kind == "readonly" || f.value != want[f.key] {
			t.Fatal("native field", f)
		}
	}
	updated, err := p.patch(map[string]string{"g_votedelay": "251"})
	if err != nil || string(updated) != strings.Replace(string(data), `G_VoteDelay "250"`, `G_VoteDelay "251"`, 1) {
		t.Fatal("native span preservation", err)
	}
}

func TestQuakeLiveTypedPreservation(t *testing.T) {
	before := "// operator\r\n\tSeTa\tsv_tags \"quiet arena\" // retained\r\nset g_allowVote 1\r\nset g_voteDelay \"0\"\r\nset unknown \"untouched\"\r\nset zmq_rcon_password \"private-fixture\"\r\n" + quakeLiveManagedFooter
	p, e := parseQuakeLiveSettings([]byte(before))
	if e != nil || len(p.fields) != 3 {
		t.Fatal(p.fields, e)
	}
	for _, f := range p.fields {
		if strings.Contains(f.value, "private") {
			t.Fatal("secret exposed")
		}
	}
	out, e := p.patch(map[string]string{"sv_tags": "local match", "g_allowvote": "0", "g_votedelay": "250"})
	want := strings.Replace(before, "quiet arena", "local match", 1)
	want = strings.Replace(want, "g_allowVote 1", "g_allowVote 0", 1)
	want = strings.Replace(want, `g_voteDelay "0"`, `g_voteDelay "250"`, 1)
	if e != nil || string(out) != want {
		t.Fatal(string(out), e)
	}
	same, e := p.patch(nil)
	if e != nil || string(same) != before {
		t.Fatal("no-op changed bytes", e)
	}
}
func TestQuakeLiveTypedRefusesAmbiguity(t *testing.T) {
	for _, tail := range []string{`set "g_voteDelay" "30"`, `seta"g_voteDelay" "30"`, `"g_voteDelay" "30"`, `exec"other.cfg"`, `exec other.cfg`, `vstr rotation`, `map campgrounds`, `alias rule quit`, `set g_voteDelay 30`, `SET G_VOTEDELAY 30`, `set g_voteDelay 1;quit`} {
		t.Run(tail, func(t *testing.T) {
			before := "set g_voteDelay 0\n" + tail + "\n"
			p, e := parseQuakeLiveSettings([]byte(before))
			if e != nil {
				t.Fatal(e)
			}
			if _, e = p.patch(map[string]string{"g_votedelay": "1"}); e == nil {
				t.Fatal("ambiguous writable")
			}
			out, e := p.patch(nil)
			if e != nil || string(out) != before {
				t.Fatal("no-op changed")
			}
		})
	}
}
func TestQuakeLiveTypedBoundsAndFooter(t *testing.T) {
	p, e := parseQuakeLiveSettings([]byte("set sv_tags \"\"\nset g_allowVote 1\nset g_voteDelay 0\n"))
	if e != nil {
		t.Fatal(e)
	}
	for key, values := range map[string][]string{"sv_tags": {"bad;quit", "bad\nquit", "bad\u2028quit", `bad"value`}, "g_allowvote": {"true", "2"}, "g_votedelay": {"-1", "1.5", "2147483648"}, "sv_hostname": {"managed"}} {
		for _, v := range values {
			if _, e = p.patch(map[string]string{key: v}); e == nil {
				t.Fatal("unsafe accepted", key)
			}
		}
	}
	for _, s := range []string{"set g_voteDelay 0\n// BEGIN VOLTRA QUAKE MANAGED\nexec other.cfg\n// END VOLTRA QUAKE MANAGED\n", "set g_voteDelay 0" + quakeLiveManagedFooter + quakeLiveManagedFooter, "\ufeffset g_voteDelay 0", "set g_voteDelay 0\rquit"} {
		if _, e := parseQuakeLiveSettings([]byte(s)); e == nil {
			t.Fatal("invalid format accepted")
		}
	}
}
