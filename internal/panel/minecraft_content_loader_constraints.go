package panel

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"

	"deps.dev/util/semver"
	toml "github.com/pelletier/go-toml/v2"
)

const mcContentLoaderMetadataMax = 256 << 10
const mcContentLoaderJarEntriesMax = 8192

var mcContentStableLoaderVersion = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+){0,3}$`)
var mcContentStableMavenRange = regexp.MustCompile(`^[0-9.,\[\]() \t]+$`)

type mcContentLoaderDependency struct {
	ModID        string `toml:"modId"`
	VersionRange string `toml:"versionRange"`
	Type         string `toml:"type"`
	Mandatory    *bool  `toml:"mandatory"`
	Side         string `toml:"side"`
}
type mcContentLoaderManifest struct {
	Mods []struct {
		ModID string `toml:"modId"`
	} `toml:"mods"`
	Dependencies map[string][]mcContentLoaderDependency `toml:"dependencies"`
}

// mcContentValidateLoaderConstraints runs after provider integrity validation and
// before staging ANY planned file. It only checks stable numeric Forge/NeoForge
// build constraints. No descriptor means unknown, not verified compatibility.
// Fabric declarations are checked by the dedicated validator below. Nested
// JARs, Java/MC constraints, and top-level javafml loaderVersion are outside this
// check; javafml language versions are decoupled from NeoForge builds. Existing
// provider/environment/dependency checks remain.
func mcContentValidateLoaderConstraints(data []byte, info mcContentInfo) error {
	if info.Kind == "mod" && info.Loader == "fabric" {
		return mcContentValidateFabricLoaderConstraints(data, info)
	}
	if info.Kind != "mod" || (info.Loader != "forge" && info.Loader != "neoforge") {
		return nil
	}
	invalid := func(detail string) error {
		return bad("Cannot validate mod loader requirements: " + detail + ". Nothing was installed.")
	}
	if len(data) > mcContentMaxFile {
		return invalid("JAR exceeds the file limit")
	}
	jar, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(jar.File) == 0 {
		return invalid("invalid JAR archive")
	}
	if len(jar.File) > mcContentLoaderJarEntriesMax {
		return invalid("JAR has too many entries")
	}
	const forge = "META-INF/mods.toml"
	const neo = "META-INF/neoforge.mods.toml"
	manifests := map[string]*zip.File{}
	seen := map[string]bool{}
	for _, file := range jar.File {
		if seen[file.Name] {
			return invalid("duplicate JAR entry")
		}
		seen[file.Name] = true
		if file.Flags&1 != 0 {
			return invalid("encrypted JAR entries are unsupported")
		}
		lower := strings.ToLower(file.Name)
		if lower != strings.ToLower(forge) && lower != strings.ToLower(neo) {
			continue
		}
		canonical := forge
		if lower == strings.ToLower(neo) {
			canonical = neo
		}
		if file.Name != canonical || manifests[canonical] != nil {
			return invalid("ambiguous loader metadata path")
		}
		if !file.Mode().IsRegular() || file.UncompressedSize64 > mcContentLoaderMetadataMax {
			return invalid("loader metadata must be a regular file of at most 256 KiB")
		}
		manifests[canonical] = file
	}
	// NeoForge's 1.20.1/47.x branch actually declares modId="forge".
	// Official source a3317fc07a2b36793b8b87c19dd4b05265135d7c:
	// https://github.com/neoforged/NeoForge/blob/a3317fc07a2b36793b8b87c19dd4b05265135d7c/src/main/resources/META-INF/mods.toml
	// This narrow historical identity is not a modern Forge/NeoForge alias.
	family := info.Loader
	installedVersion := strings.TrimPrefix(info.LoaderVersion, info.Version+"-")
	if info.Loader == "neoforge" && info.Version == "1.20.1" && regexp.MustCompile(`^47\.[0-9]+\.[0-9]+$`).MatchString(installedVersion) {
		family = "forge"
	}
	selected, opposite := forge, neo
	if info.Loader == "neoforge" {
		selected, opposite = neo, forge
	}
	file := manifests[selected]
	if file == nil {
		// Earlier NeoForge versions used mods.toml as well. Parse it rather than
		// mistaking the descriptor name alone for an incompatible loader dependency.
		if info.Loader == "neoforge" {
			file = manifests[forge]
		}
		if file == nil {
			if manifests[opposite] != nil {
				return invalid("artifact metadata does not match this server's loader family")
			}
			return nil
		}
	}
	input, err := file.Open()
	if err != nil {
		return invalid("loader metadata could not be read")
	}
	body, readErr := io.ReadAll(io.LimitReader(input, mcContentLoaderMetadataMax+1))
	closeErr := input.Close()
	if readErr != nil || closeErr != nil || len(body) > mcContentLoaderMetadataMax {
		return invalid("loader metadata is corrupt or oversized")
	}
	var manifest mcContentLoaderManifest
	if err = toml.Unmarshal(body, &manifest); err != nil {
		return invalid("malformed loader TOML metadata")
	}
	if len(manifest.Mods) == 0 || len(manifest.Mods) > 128 || len(manifest.Dependencies) > 128 {
		return invalid("invalid or excessive mod tables")
	}
	owners := map[string]bool{}
	for _, mod := range manifest.Mods {
		if !mcContentLoaderText(mod.ModID, 128) || mod.ModID == "" || owners[mod.ModID] {
			return invalid("invalid or duplicate mod identifier")
		}
		owners[mod.ModID] = true
	}
	count := 0
	for owner, dependencies := range manifest.Dependencies {
		if !owners[owner] {
			return invalid("dependency table has no declared owning mod")
		}
		for _, dependency := range dependencies {
			count++
			if count > 512 {
				return invalid("too many dependency declarations")
			}
			if dependency.ModID != "forge" && dependency.ModID != "neoforge" {
				continue
			}
			if !mcContentLoaderText(dependency.VersionRange, 512) {
				return invalid("loader version range is invalid or too long")
			}
			side := dependency.Side
			if side == "" {
				side = "BOTH"
			}
			if side == "CLIENT" {
				continue
			}
			if side != "BOTH" && side != "SERVER" {
				return invalid("unsupported loader dependency side")
			}
			kind := dependency.Type
			if kind == "" {
				kind = "required"
				if dependency.Mandatory != nil && !*dependency.Mandatory {
					kind = "optional"
				}
			}
			switch kind {
			case "required", "optional", "incompatible", "discouraged":
			default:
				return invalid("unsupported loader dependency type")
			}
			if dependency.ModID != family {
				if kind == "required" {
					return bad(fmt.Sprintf("This mod requires %s, but the server uses %s. Nothing was installed.", dependency.ModID, info.Loader))
				}
				continue
			}
			if kind == "discouraged" {
				continue
			} // Native loader permits this with a warning.
			matches := true
			versionRange := strings.TrimSpace(dependency.VersionRange)
			if versionRange != "" {
				version := installedVersion
				if !mcContentStableLoaderVersion.MatchString(version) || !mcContentStableMavenRange.MatchString(versionRange) {
					return invalid("qualified or unresolved loader versions require manual compatibility review")
				}
				constraint, parseErr := semver.Maven.ParseConstraint(versionRange)
				if parseErr != nil {
					return invalid("unsupported Maven loader version range")
				}
				installed, parseErr := semver.Maven.Parse(version)
				if parseErr != nil {
					return invalid("installed loader build could not be parsed")
				}
				matches = constraint.MatchVersion(installed)
			}
			if kind == "incompatible" {
				matches = !matches
			}
			if !matches {
				return bad(fmt.Sprintf("This mod's %s dependency requires %s %q; the installed build is %s. Nothing was installed.", kind, info.Loader, versionRange, info.LoaderVersion))
			}
		}
	}
	return nil
}

func mcContentLoaderText(value string, maximum int) bool {
	if len(value) > maximum {
		return false
	}
	return !strings.ContainsFunc(value, func(r rune) bool { return unicode.IsControl(r) })
}
