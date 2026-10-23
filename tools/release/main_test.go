package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNightlyPlan(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "VERSION")
	out := filepath.Join(dir, "output")
	_ = os.WriteFile(path, []byte("0.1.0\n"), 0600)
	_ = os.WriteFile(out, nil, 0600)
	t.Setenv("GITHUB_OUTPUT", out)
	if err := run([]string{"nightly", path, "20261023", "42"}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	if !strings.Contains(string(b), "tag=v0.1.0-nightly.20261023.42\n") {
		t.Fatal(string(b))
	}
	_ = os.WriteFile(path, []byte("0.1.0-beta.1"), 0600)
	if run([]string{"nightly", path, "20261023", "42"}) == nil {
		t.Fatal("nightly accepted a prerelease base")
	}
}

func TestChannels(t *testing.T) {
	for tag, want := range map[string]string{"v0.1.0": "stable", "v0.1.0-beta.1": "beta", "v0.1.0-nightly.20261023.1": "nightly"} {
		p, e := parseTag(tag)
		if e != nil || p.Channel != want {
			t.Fatal(tag, p, e)
		}
	}
	for _, tag := range []string{"update-stable", "v01.1.0", "v1.2.3-rc.1", "v1.2.3-beta.0", "v1.2.3-nightly.20261301.1", "v1.2.3+build"} {
		if _, e := parseTag(tag); e == nil {
			t.Fatal("accepted", tag)
		}
	}
}
func TestWailsDigestSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	p, _ := parseTag("v0.1.0-beta.1")
	b := []byte("executable fixture")
	m := makeManifest(p, "Voltra-windows-amd64.exe", b, priv)
	a := m.Artifacts[0]
	d, _ := base64.StdEncoding.DecodeString(a.Digest)
	sig, _ := base64.StdEncoding.DecodeString(a.Signature)
	sum := sha256.Sum256(b)
	if string(d) != string(sum[:]) || !ed25519.Verify(pub, d, sig) || ed25519.Verify(pub, b, sig) {
		t.Fatal("signature must authenticate SHA256 digest bytes")
	}
	d[0] ^= 1
	if ed25519.Verify(pub, d, sig) {
		t.Fatal("tamper accepted")
	}
}
