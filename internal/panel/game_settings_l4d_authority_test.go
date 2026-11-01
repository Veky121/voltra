package panel

import "testing"

func TestL4DAuthoritySelectors(t *testing.T) {
	cfg := []byte("sv_alltalk 0\n" + l4dManagedFooter)
	path, err := l4dSettingsCandidateDocument(l4dSettingsRecipe, l4dSettingsStartup, "222840", "", cfg)
	if err != nil || path != l4dSettingsPath {
		t.Fatalf("canonical candidate: %q %v", path, err)
	}
	for _, v := range [][4]string{
		{"left4dead_2/egg-left4dead_2.json", l4dSettingsStartup, "222840", ""},
		{l4dSettingsRecipe, l4dSettingsStartup, "222860", ""},
		{l4dSettingsRecipe, l4dSettingsStartup + " +exec other.cfg", "222840", ""},
		{l4dSettingsRecipe, "./srcds_run -console", "222840", ""},
		{l4dSettingsRecipe, l4dSettingsStartup, "222840", "custom"},
	} {
		path, err := l4dSettingsCandidateDocument(v[0], v[1], v[2], v[3], cfg)
		if err != nil || path != "" {
			t.Fatalf("wrong selector authorized: %v", v)
		}
	}
}

func TestL4DAuthorityExecutableCFG(t *testing.T) {
	for _, body := range []string{"// operator\r\nSV_ALLTALK \"0\" // preserved\r\n", "hostname \"literal name\"\nsv_password \"\"\n", ""} {
		if !l4dCFGAuthority([]byte(body + l4dManagedFooter)) {
			t.Fatalf("safe syntax refused: %q", body)
		}
	}
	for _, body := range []string{"exec other.cfg\n", "alias later sv_alltalk\n", "sv_alltalk 0;quit\n", "sv_alltalk 0\nSV_ALLTALK 1\n", "unknown 1\n", "hostname \"a;quit\"\n", "hostname \"unterminated\n", "/* block\n", "sv_alltalk 0\rquit", "\ufeffsv_alltalk 0\n", "sv_alltalk 0\u2028quit\n", string([]byte{255}), "// BEGIN VOLTRA L4D MANAGED\n"} {
		if l4dCFGAuthority([]byte(body + l4dManagedFooter)) {
			t.Fatalf("unsafe syntax accepted: %q", body)
		}
	}
	for _, cfg := range []string{"sv_alltalk 0\n", l4dManagedFooter + "exec other.cfg\n", l4dManagedFooter + l4dManagedFooter} {
		if l4dCFGAuthority([]byte(cfg)) {
			t.Fatal("invalid footer accepted")
		}
	}
	_, err := l4dSettingsCandidateDocument(l4dSettingsRecipe, l4dSettingsStartup, "222840", "", []byte("exec other.cfg\n"+l4dManagedFooter))
	if err == nil {
		t.Fatal("candidate accepted executable override")
	}
}
