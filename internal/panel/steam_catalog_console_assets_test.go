package panel

import (
	"encoding/json"
	"testing"
)

func TestSteamCatalogConsoleArtifactsArchitecturesAndIntegrity(t *testing.T) {
	for _, architecture := range []string{"amd64", "arm64"} {
		asset, err := steamCatalogConsoleArtifact(architecture)
		if err != nil || len(asset.Binary) == 0 || len(asset.Licenses) == 0 || asset.Architecture != architecture {
			t.Fatal("reviewed console package unavailable:", architecture, err)
		}
	}
	if _, err := steamCatalogConsoleArtifact("386"); err == nil {
		t.Fatal("unsupported architecture accepted")
	}
	manifest, err := steamCatalogConsoleAssets.ReadFile("managed_console_assets/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	read := func(file string) ([]byte, error) {
		return steamCatalogConsoleAssets.ReadFile("managed_console_assets/" + file)
	}
	var m map[string]any
	if json.Unmarshal(manifest, &m) != nil {
		t.Fatal("invalid fixture manifest")
	}
	m["version"] = "unsupported"
	bad, _ := json.Marshal(m)
	if _, err = steamCatalogReadConsoleArtifact("amd64", bad, read); err == nil {
		t.Fatal("unknown manifest version accepted")
	}
	if _, err = steamCatalogReadConsoleArtifact("amd64", manifest, func(file string) ([]byte, error) {
		b, e := read(file)
		if file == "console-linux-amd64" && len(b) > 0 {
			b[0] ^= 1
		}
		return b, e
	}); err == nil {
		t.Fatal("corrupt executable accepted")
	}
	if _, err = steamCatalogReadConsoleArtifact("amd64", manifest, func(file string) ([]byte, error) {
		b, e := read(file)
		if len(file) > 9 && file[:9] == "licenses/" {
			b = append(b, 'x')
		}
		return b, e
	}); err == nil {
		t.Fatal("license checksum mismatch accepted")
	}
}
