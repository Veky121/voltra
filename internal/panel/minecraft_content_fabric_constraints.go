package panel

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// Only top-level schema-1 fabricloader declarations are checked here. Missing
// metadata and schema 0 remain unknown. Nested candidate selection, overrides,
// Java, Minecraft and other-mod resolution are not verified by this check.
func mcContentValidateFabricLoaderConstraints(data []byte, info mcContentInfo) error {
	if info.Kind != "mod" || info.Loader != "fabric" {
		return nil
	}
	invalid := func(s string) error {
		return bad("Cannot validate Fabric loader requirements: " + s + ". Nothing was installed.")
	}
	if len(data) > mcContentMaxFile {
		return invalid("JAR exceeds the file limit")
	}
	jar, e := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if e != nil || len(jar.File) == 0 {
		return invalid("invalid JAR archive")
	}
	if len(jar.File) > mcContentLoaderJarEntriesMax {
		return invalid("JAR has too many entries")
	}
	var selected *zip.File
	seen := map[string]bool{}
	for _, f := range jar.File {
		if seen[f.Name] {
			return invalid("duplicate JAR entry")
		}
		seen[f.Name] = true
		if f.Flags&1 != 0 {
			return invalid("encrypted JAR entries are unsupported")
		}
		if !strings.EqualFold(f.Name, "fabric.mod.json") {
			continue
		}
		if f.Name != "fabric.mod.json" || selected != nil {
			return invalid("ambiguous Fabric metadata path")
		}
		if !f.Mode().IsRegular() || f.UncompressedSize64 > mcContentLoaderMetadataMax {
			return invalid("metadata must be a regular file of at most 256 KiB")
		}
		selected = f
	}
	if selected == nil {
		return nil
	}
	input, e := selected.Open()
	if e != nil {
		return invalid("metadata could not be read")
	}
	body, re := io.ReadAll(io.LimitReader(input, mcContentLoaderMetadataMax+1))
	ce := input.Close()
	if re != nil || ce != nil || len(body) > mcContentLoaderMetadataMax {
		return invalid("metadata is corrupt or oversized")
	}
	if e = mcFabricUniqueJSON(body); e != nil {
		return invalid("malformed or duplicate JSON metadata")
	}
	var manifest map[string]json.RawMessage
	if json.Unmarshal(body, &manifest) != nil || manifest == nil {
		return invalid("metadata must be an object")
	}
	schema := 0
	if raw, ok := manifest["schemaVersion"]; ok {
		if json.Unmarshal(raw, &schema) != nil || string(raw) == "null" {
			return invalid("invalid schemaVersion")
		}
	}
	if schema == 0 {
		return nil
	}
	if schema != 1 {
		return invalid("unsupported schemaVersion")
	}
	for _, key := range []string{"id", "version"} {
		var value string
		if json.Unmarshal(manifest[key], &value) != nil || value == "" {
			return invalid("missing or invalid " + key)
		}
	}
	for _, kind := range []string{"depends", "breaks", "recommends", "conflicts", "suggests"} {
		raw, exists := manifest[kind]
		if !exists {
			continue
		}
		var dependencies map[string]json.RawMessage
		if json.Unmarshal(raw, &dependencies) != nil || dependencies == nil {
			return invalid("invalid " + kind + " declaration")
		}
		target, exists := dependencies["fabricloader"]
		if !exists {
			continue
		}
		var ranges []string
		var single string
		if json.Unmarshal(target, &single) == nil && string(target) != "null" {
			ranges = []string{single}
		} else {
			var entries []json.RawMessage
			if json.Unmarshal(target, &entries) != nil || string(target) == "null" {
				return invalid("fabricloader must be a string or string array")
			}
			for _, entry := range entries {
				var value string
				if json.Unmarshal(entry, &value) != nil || string(entry) == "null" {
					return invalid("fabricloader alternatives must be strings")
				}
				ranges = append(ranges, value)
			}
		}
		if len(ranges) > 128 {
			return invalid("too many loader alternatives")
		}
		for _, r := range ranges {
			if len(r) > 512 {
				return invalid("loader predicate is too long")
			}
		}
		matches, err := mcFabricPredicateMatches(ranges, info.LoaderVersion)
		if err != nil {
			return invalid("invalid fabricloader predicate")
		}
		if (kind == "depends" && !matches) || (kind == "breaks" && matches) {
			return bad(fmt.Sprintf("This mod's %s.fabricloader declaration %q does not permit the installed Fabric build %s. Nothing was installed.", kind, ranges, info.LoaderVersion))
		}
	}
	return nil
}

// Reject duplicate keys rather than silently selecting a different declaration
// from the native streaming parser. This is an explicit ambiguity policy.
func mcFabricUniqueJSON(body []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var value func(int) error
	value = func(depth int) error {
		if depth > 64 {
			return fmt.Errorf("JSON nesting limit")
		}
		t, e := decoder.Token()
		if e != nil {
			return e
		}
		d, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch d {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				k, e := decoder.Token()
				if e != nil {
					return e
				}
				key, ok := k.(string)
				if !ok || seen[key] {
					return fmt.Errorf("duplicate key")
				}
				seen[key] = true
				if e = value(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			for decoder.More() {
				if e = value(depth + 1); e != nil {
					return e
				}
			}
		default:
			return fmt.Errorf("unexpected delimiter")
		}
		_, e = decoder.Token()
		return e
	}
	if e := value(0); e != nil {
		return e
	}
	if _, e := decoder.Token(); e != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}
