package panel

import (
	"bytes"
	"testing"
)

func TestETLegacySettingsByteSpans(t *testing.T) {
	original := []byte("// keep CRLF\r\n\tSeTa g_friendlyFire \"1\" // preserve\r\nsets sv_hostname \"Original\"\r\nset unknown \"operator\"\r\nsetu g_warmup 10\r\n")
	parsed, err := parseETLegacySettings(original)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.fields) != 3 {
		t.Fatalf("fields=%v", parsed.fields)
	}
	changed, err := parsed.patch(map[string]string{"g_friendlyfire": "0", "sv_hostname": "New name", "g_warmup": "20"})
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(original, []byte(`g_friendlyFire "1"`), []byte(`g_friendlyFire "0"`), 1)
	want = bytes.Replace(want, []byte(`"Original"`), []byte(`"New name"`), 1)
	want = bytes.Replace(want, []byte("g_warmup 10"), []byte("g_warmup 20"), 1)
	if !bytes.Equal(changed, want) {
		t.Fatalf("changed=%q want=%q", changed, want)
	}
	roundtrip, err := parsed.patch(nil)
	if err != nil || !bytes.Equal(roundtrip, original) {
		t.Fatalf("roundtrip %q %v", roundtrip, err)
	}
}
func TestETLegacySettingsAmbiguityAndCommands(t *testing.T) {
	for _, text := range []string{
		"set g_friendlyFire 1\nseta G_FRIENDLYFIRE 0\n",
		"set g_friendlyFire 1\nset G_FRIENDLYFIRE\n",
		"set g_friendlyFire 1\nexec other.cfg\n",
		"set g_friendlyFire 1\ntoggle g_friendlyFire\n",
		"set g_friendlyFire 1; quit\n",
		"set g_friendlyFire 1\nset \"g_friendlyFire\" 0\n",
		"set g_friendlyFire 1\n\"g_friendlyFire\" 0\n",
		"set g_friendlyFire 1\nseta\"g_friendlyFire\" 0\n",
	} {
		t.Run(text, func(t *testing.T) {
			p, e := parseETLegacySettings([]byte(text))
			if e != nil {
				t.Fatal(e)
			}
			for _, f := range p.fields {
				if f.kind != "readonly" {
					t.Errorf("writable %v", f)
				}
			}
			if _, e = p.patch(map[string]string{"g_friendlyfire": "0"}); e == nil {
				t.Fatal("unsafe write accepted")
			}
		})
	}
}
func TestETLegacySettingsValueSafety(t *testing.T) {
	p, e := parseETLegacySettings([]byte("set sv_hostname \"Host\"\nset g_password \"private\"\nset g_doWarmup \"0\"\nset sv_maxclients 20\nset g_warmup 10\n"))
	if e != nil {
		t.Fatal(e)
	}
	for _, test := range []struct{ k, v string }{{"sv_hostname", "bad\nquit"}, {"sv_hostname", "bad;quit"}, {"g_password", "bad\"quote"}, {"g_password", "bad\\escape"}, {"sv_maxclients", "0"}, {"sv_maxclients", "65"}, {"sv_maxclients", "020"}, {"g_warmup", "NaN"}, {"g_dowarmup", "true"}, {"g_dowarmup", "2"}} {
		if _, e := p.patch(map[string]string{test.k: test.v}); e == nil {
			t.Errorf("accepted %s=%q", test.k, test.v)
		}
	}
	if _, e := p.patch(map[string]string{"g_password": "", "sv_maxclients": "12", "g_dowarmup": "1"}); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"g_password", "rconpassword", "sv_privatepassword", "refereepassword", "shoutcastpassword"} {
		if !gameSettingSecret.MatchString(key) {
			t.Fatalf("credential not masked: %s", key)
		}
	}
}
func TestETLegacySettingsInvalidNativeValuesReadonly(t *testing.T) {
	p, e := parseETLegacySettings([]byte("set g_friendlyFire 2\nset sv_maxclients 999\n"))
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range p.fields {
		if f.kind != "readonly" {
			t.Errorf("invalid native writable: %v", f)
		}
	}
}
