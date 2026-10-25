package panel

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"strings"
	"testing"
)

type mcLoaderTestMember struct {
	name, body string
	flags      uint16
	symlink    bool
}

func mcLoaderTestJar(t *testing.T, members ...mcLoaderTestMember) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, member := range members {
		header := &zip.FileHeader{Name: member.name, Method: zip.Store, Flags: member.flags}
		if member.symlink {
			header.SetMode(os.ModeSymlink | 0o777)
		}
		file, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte(member.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
func mcLoaderTestInfo(loader, version string) mcContentInfo {
	return mcContentInfo{Kind: "mod", Loader: loader, LoaderVersion: version, Version: "1.21.1"}
}
func mcLoaderTestManifest(loader, versionRange, extra string) string {
	return fmt.Sprintf("modLoader='javafml'\nloaderVersion='[1,)'\nlicense='MIT'\n[[mods]]\nmodId='ferritecore'\nversion='7.0.3'\n[[dependencies.ferritecore]]\nmodId=%q\nversionRange=%q\n%s\n", loader, versionRange, extra)
}

func TestMinecraftContentLoaderConstraintsFerriteCoreShape(t *testing.T) {
	jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: mcLoaderTestManifest("neoforge", "[21.1.218,)", "type='required'\nside='BOTH'")})
	for _, version := range []string{"21.1.218", "21.1.264"} {
		if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("neoforge", version)); err != nil {
			t.Fatalf("%s: %v", version, err)
		}
	}
	err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("neoforge", "21.1.217"))
	if err == nil || !strings.Contains(err.Error(), "21.1.218") {
		t.Fatalf("older build must fail clearly: %v", err)
	}
	// loaderVersion [1,) describes JavaFML, not NeoForge build21.1.264.
}

func TestMinecraftContentLoaderConstraintsMavenRanges(t *testing.T) {
	for _, test := range []struct {
		rangeText, version string
		ok                 bool
	}{
		{"[21.1.218,21.2)", "21.1.264", true}, {"[21.1.218,21.2)", "21.2.0", false},
		{"(,21.1.218]", "21.1.218", true}, {"(,21.1.218)", "21.1.218", false},
		{"[21.1.218]", "21.1.218", true}, {"[21.1.218]", "21.1.219", false},
		{"(,21.1.200],[21.1.218,)", "21.1.264", true}, {"(,21.1.200],[21.1.218,)", "21.1.210", false},
		{"[21,)", "21.1.264", true}, {"", "21.1.264", true},
		{"[21.1.218-beta,)", "21.1.264", false}, {"[${neo_version},)", "21.1.264", false},
		{"[21.1.218,)", "21.1.264-beta", false}, {"[21.1.218", "21.1.264", false},
	} {
		t.Run(test.rangeText+"/"+test.version, func(t *testing.T) {
			jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: mcLoaderTestManifest("neoforge", test.rangeText, "")})
			err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("neoforge", test.version))
			if (err == nil) != test.ok {
				t.Fatalf("ok=%v error=%v", test.ok, err)
			}
		})
	}
}

func TestMinecraftContentLoaderConstraintsNativeDependencySemantics(t *testing.T) {
	for _, test := range []struct {
		extra string
		ok    bool
	}{
		{"type='optional'", false}, {"mandatory=false", false}, {"mandatory=true", false},
		{"type='incompatible'", true}, {"type='discouraged'", true}, {"side='CLIENT'", true},
		{"side='SERVER'", false}, {"side='UNKNOWN'", false}, {"type='invalid'", false},
	} {
		t.Run(test.extra, func(t *testing.T) {
			jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/mods.toml", body: mcLoaderTestManifest("forge", "[48,)", test.extra)})
			err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("forge", "47.3.0"))
			if (err == nil) != test.ok {
				t.Fatalf("ok=%v error=%v", test.ok, err)
			}
		})
	}
	jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/mods.toml", body: mcLoaderTestManifest("forge", "[47,48)", "type='incompatible'")})
	if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("forge", "1.21.1-47.3.0")); err == nil {
		t.Fatal("incompatible installed build accepted")
	}
}

func TestMinecraftContentLoaderConstraintsMultipleTablesAndFamilies(t *testing.T) {
	body := mcLoaderTestManifest("neoforge", "[21,)", "") + "\n[[mods]]\nmodId='other'\n[[dependencies.other]]\nmodId='neoforge'\nversionRange='[21.1.300,)'\n[[dependencies.ferritecore]]\nmodId='some_other_mod'\nversionRange='not loader syntax'\n"
	jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: body})
	if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("neoforge", "21.1.264")); err == nil {
		t.Fatal("second mod loader dependency ignored")
	}
	if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("forge", "47.3.0")); err == nil {
		t.Fatal("NeoForge-only descriptor accepted on Forge")
	}
	// Both descriptors are legitimate in a multi-loader JAR; only active one applies.
	multi := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: mcLoaderTestManifest("neoforge", "[21,)", "")}, mcLoaderTestMember{name: "META-INF/mods.toml", body: mcLoaderTestManifest("forge", "[47,)", "")})
	if err := mcContentValidateLoaderConstraints(multi, mcLoaderTestInfo("forge", "47.3.0")); err != nil {
		t.Fatal(err)
	}
	if err := mcContentValidateLoaderConstraints(multi, mcLoaderTestInfo("neoforge", "21.1.264")); err != nil {
		t.Fatal(err)
	}
	opposite := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: mcLoaderTestManifest("forge", "[47,)", "")})
	if err := mcContentValidateLoaderConstraints(opposite, mcLoaderTestInfo("neoforge", "21.1.264")); err == nil {
		t.Fatal("required opposite loader accepted")
	}
}

func TestMinecraftContentLoaderConstraintsArchiveAndMetadataLimits(t *testing.T) {
	valid := mcLoaderTestManifest("neoforge", "[21,)", "")
	cases := map[string][]mcLoaderTestMember{
		"duplicate":          {{name: "META-INF/neoforge.mods.toml", body: valid}, {name: "META-INF/neoforge.mods.toml", body: valid}},
		"case_alias":         {{name: "meta-inf/neoforge.mods.toml", body: valid}},
		"symlink":            {{name: "META-INF/neoforge.mods.toml", body: valid, symlink: true}},
		"encrypted":          {{name: "META-INF/neoforge.mods.toml", body: valid, flags: 1}},
		"oversized":          {{name: "META-INF/neoforge.mods.toml", body: strings.Repeat("#", mcContentLoaderMetadataMax+1)}},
		"malformed":          {{name: "META-INF/neoforge.mods.toml", body: "[[mods]\n"}},
		"duplicate_toml_key": {{name: "META-INF/neoforge.mods.toml", body: valid + "modId='again'\n"}},
		"wrong_type":         {{name: "META-INF/neoforge.mods.toml", body: strings.Replace(valid, "modId=\"neoforge\"", "modId=1", 1)}},
	}
	for name, members := range cases {
		t.Run(name, func(t *testing.T) {
			if err := mcContentValidateLoaderConstraints(mcLoaderTestJar(t, members...), mcLoaderTestInfo("neoforge", "21.1.264")); err == nil {
				t.Fatal("invalid metadata accepted")
			}
		})
	}
	members := make([]mcLoaderTestMember, mcContentLoaderJarEntriesMax+1)
	for i := range members {
		members[i].name = fmt.Sprint(i)
	}
	if err := mcContentValidateLoaderConstraints(mcLoaderTestJar(t, members...), mcLoaderTestInfo("forge", "47.3.0")); err == nil {
		t.Fatal("entry limit not enforced")
	}
	jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: valid})
	index := bytes.Index(jar, []byte(valid))
	if index < 0 {
		t.Fatal("stored member absent")
	}
	jar[index] ^= 1
	if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("neoforge", "21.1.264")); err == nil {
		t.Fatal("CRC corrupt metadata accepted")
	}
}

func TestMinecraftContentLoaderConstraintsUnknownMetadataPolicy(t *testing.T) {
	jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "legacy/mod.class", body: "fixture"})
	if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("forge", "47.3.0")); err != nil {
		t.Fatalf("absent descriptor is unknown, preserves existing behavior: %v", err)
	}
	if err := mcContentValidateLoaderConstraints(jar, mcLoaderTestInfo("fabric", "0.20.1")); err != nil {
		t.Fatalf("absent Fabric descriptor remains unknown: %v", err)
	}
	for _, info := range []mcContentInfo{{Kind: "plugin", Loader: "paper"}} {
		if err := mcContentValidateLoaderConstraints([]byte("not parsed in this scope"), info); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMinecraftContentLoaderConstraintsLegacyNeoForgeForgeIdentity(t *testing.T) {
	jar := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/mods.toml", body: mcLoaderTestManifest("forge", "[47.1.100,48)", "mandatory=true")})
	for _, test := range []struct {
		mc, loader, version string
		ok                  bool
	}{
		{"1.20.1", "neoforge", "47.1.106", true}, {"1.20.1", "neoforge", "1.20.1-47.1.106", true},
		{"1.20.1", "neoforge", "47.1.99", false}, {"1.20.2", "neoforge", "47.1.106", false},
		{"1.20.1", "neoforge", "20.1.106", false}, {"1.21.1", "neoforge", "21.1.264", false},
		{"1.20.1", "forge", "47.1.106", true},
	} {
		t.Run(test.mc+"/"+test.loader+"/"+test.version, func(t *testing.T) {
			info := mcLoaderTestInfo(test.loader, test.version)
			info.Version = test.mc
			err := mcContentValidateLoaderConstraints(jar, info)
			if (err == nil) != test.ok {
				t.Fatalf("ok=%v err=%v", test.ok, err)
			}
		})
	}
	modern := mcLoaderTestJar(t, mcLoaderTestMember{name: "META-INF/neoforge.mods.toml", body: mcLoaderTestManifest("neoforge", "[21,)", "")})
	info := mcLoaderTestInfo("neoforge", "47.1.106")
	info.Version = "1.20.1"
	if err := mcContentValidateLoaderConstraints(modern, info); err == nil {
		t.Fatal("modern NeoForge dependency aliased to legacy Forge identity")
	}
}
