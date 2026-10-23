package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"debug/elf"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
)

//go:embed managed_console_assets
var steamCatalogConsoleAssets embed.FS

const steamCatalogConsoleVersion = "0.10.3-voltra-auth1"
const steamCatalogConsolePath = "/.voltra/console-client"
const steamCatalogConsoleMaxBytes = 16 << 20

type steamCatalogConsolePackage struct {
	Binary, Manifest, Licenses []byte
	SHA256, Architecture       string
}
type steamCatalogConsoleManifest struct {
	SchemaVersion    int    `json:"schema_version"`
	Version          string `json:"version"`
	SourceTreeSHA256 string `json:"source_tree_sha256"`
	Artifacts        []struct {
		Architecture, OS, File, SHA256 string
		Bytes                          int
	} `json:"artifacts"`
	Licenses []struct{ Module, Version, File, SHA256 string } `json:"licenses"`
}

func steamCatalogConsoleArtifact(architecture string) (steamCatalogConsolePackage, error) {
	manifest, err := steamCatalogConsoleAssets.ReadFile("managed_console_assets/manifest.json")
	if err != nil {
		return steamCatalogConsolePackage{}, errors.New("Managed console artifact manifest is unavailable.")
	}
	return steamCatalogReadConsoleArtifact(architecture, manifest, func(name string) ([]byte, error) {
		return steamCatalogConsoleAssets.ReadFile("managed_console_assets/" + name)
	})
}

func (a *App) steamCatalogConsoleNodeArtifact(ctx context.Context, server M) (steamCatalogConsolePackage, error) {
	node, err := a.node(ctx, num(server["node_id"]))
	if err != nil {
		return steamCatalogConsolePackage{}, err
	}
	response, err := a.daemon(ctx, node, "GET", "/api/system?v=2", nil)
	if err != nil {
		return steamCatalogConsolePackage{}, err
	}
	defer response.Body.Close()
	var information M
	if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&information) != nil {
		return steamCatalogConsolePackage{}, bad("The node returned invalid console platform information.")
	}
	system := asMap(information["system"])
	if len(system) == 0 {
		system = information
	}
	platform := str(system["os_type"])
	if platform == "" && information["system"] == nil {
		platform = str(information["os"])
	}
	if platform != "linux" {
		return steamCatalogConsolePackage{}, bad("Managed console requires a native Linux node.")
	}
	return steamCatalogConsoleArtifact(str(system["architecture"]))
}

// Only the fixed reviewed executable may use this larger raw-byte boundary.
// Ordinary Quick setup configuration limits remain unchanged.
func (a *App) steamCatalogReadNativeFile(ctx context.Context, server M, file string) ([]byte, bool, error) {
	if file != steamCatalogConsolePath {
		return a.quickSetupRead(ctx, server, file)
	}
	entries, exists, err := a.quickSetupList(ctx, server, "/.voltra")
	if err != nil || !exists {
		return nil, false, err
	}
	entry, exists, err := quickFindEntry(entries, "console-client")
	if err != nil || !exists {
		return nil, false, err
	}
	if !quickFileEntry(entry) {
		return nil, false, bad("Managed console executable must be a regular file.")
	}
	response, err := a.daemonServer(ctx, server, "GET", "/files/contents?"+url.Values{"file": {steamCatalogConsolePath}}.Encode(), nil)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, steamCatalogConsoleMaxBytes+1))
	if err != nil {
		return nil, false, err
	}
	if len(data) > steamCatalogConsoleMaxBytes {
		return nil, false, bad("Managed console executable exceeds its bounded artifact size.")
	}
	return data, true, nil
}

func steamCatalogReadConsoleArtifact(architecture string, manifest []byte, read func(string) ([]byte, error)) (steamCatalogConsolePackage, error) {
	var result steamCatalogConsolePackage
	if architecture != "amd64" && architecture != "arm64" {
		return result, errors.New("Managed console artifact does not support this architecture.")
	}
	var m steamCatalogConsoleManifest
	if json.Unmarshal(manifest, &m) != nil || m.SchemaVersion != 1 || m.Version != steamCatalogConsoleVersion || len(m.Artifacts) != 2 || len(m.Licenses) == 0 || len(m.SourceTreeSHA256) != 64 {
		return result, errors.New("Managed console artifact manifest is invalid.")
	}
	seen := map[string]bool{}
	for _, artifact := range m.Artifacts {
		if (artifact.Architecture != "amd64" && artifact.Architecture != "arm64") || seen[artifact.Architecture] || artifact.OS != "linux" || artifact.File != "console-linux-"+artifact.Architecture || len(artifact.SHA256) != 64 || artifact.Bytes <= 0 || artifact.Bytes > 16<<20 {
			return result, errors.New("Managed console artifact manifest is invalid.")
		}
		seen[artifact.Architecture] = true
		if artifact.Architecture != architecture {
			continue
		}
		binary, err := read(artifact.File)
		if err != nil {
			return result, errors.New("Managed console artifact is missing.")
		}
		digest := sha256.Sum256(binary)
		if len(binary) != artifact.Bytes || hex.EncodeToString(digest[:]) != artifact.SHA256 {
			return result, errors.New("Managed console artifact checksum mismatch.")
		}
		executable, err := elf.NewFile(bytes.NewReader(binary))
		if err != nil {
			return result, errors.New("Managed console artifact is not an ELF executable.")
		}
		machine := elf.EM_X86_64
		if architecture == "arm64" {
			machine = elf.EM_AARCH64
		}
		if executable.Class != elf.ELFCLASS64 || executable.Machine != machine || executable.Type != elf.ET_EXEC {
			return result, errors.New("Managed console artifact architecture mismatch.")
		}
		result.Binary = binary
		result.Manifest = append([]byte(nil), manifest...)
		result.Architecture = architecture
		result.SHA256 = artifact.SHA256
	}
	if len(result.Binary) == 0 {
		return result, errors.New("Managed console artifact is missing.")
	}
	var licenses bytes.Buffer
	for _, license := range m.Licenses {
		if !strings.HasPrefix(license.File, "licenses/") || strings.Contains(license.File, "..") || strings.Contains(license.File, "\\") || len(license.SHA256) != 64 {
			return steamCatalogConsolePackage{}, errors.New("Managed console license manifest is invalid.")
		}
		data, err := read(license.File)
		if err != nil {
			return steamCatalogConsolePackage{}, errors.New("Managed console license is missing.")
		}
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != license.SHA256 {
			return steamCatalogConsolePackage{}, errors.New("Managed console license checksum mismatch.")
		}
		fmt.Fprintf(&licenses, "\n===== %s %s =====\n", license.Module, license.Version)
		licenses.Write(data)
	}
	result.Licenses = licenses.Bytes()
	return result, nil
}
