package panel

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const zandronumSettingsRecipe = "doom/zandronum/egg-zandronum.json"
const zandronumSettingsPath = "/zandronum/zandronum.ini"
const zandronumWebsiteKey = "Doom.NetServerInfo/sv_website"
const zandronumSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/id_family_runtime.py zandronum"

func zandronumStartupManaged(key string) bool {
	section, name, ok := strings.Cut(key, "/")
	if !ok || (section != "Doom.NetServerInfo" && section != "Doom.ConsoleVariables") {
		return false
	}
	switch name {
	case "sv_maxplayers", "sv_hostname", "sv_broadcast", "sv_updatemaster", "sv_password", "sv_forcepassword", "dmflags", "dmflags2", "zadmflags", "compatflags", "compatflags2", "zacompatflags":
		return true
	}
	return false
}

// The byte limit is an application policy, not an engine maximum.
func zandronumWebsiteValid(value string) bool {
	if len(value) > 2048 || !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return false
		}
	}
	if value == "" {
		return true
	}
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.Hostname() != "" && u.User == nil && u.Opaque == "" && !strings.ContainsAny(value, "\"'\\")
}

func parseZandronumSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Unsupported or ambiguous Zandronum settings document.")
	}
	if len(data) > 8*1024*1024 || !utf8.Valid(data) || strings.HasPrefix(string(data), "\ufeff") {
		return invalid()
	}
	section := ""
	sections, targets := 0, 0
	parsed := gameSettingsParsed{}
	seen := map[string]bool{}
	offset, targetStart, targetEnd := 0, 0, 0
	var target gameSettingsParsed
	const targetHeader = "[Doom.NetServerInfo]\n"
	for _, originalLine := range strings.SplitAfter(string(data), "\n") {
		lineStart := offset
		offset += len(originalLine)
		line := strings.TrimSuffix(originalLine, "\n")
		line = strings.TrimSuffix(line, "\r")
		for _, r := range line {
			if (unicode.IsControl(r) && r != '\t') || r == '\u2028' || r == '\u2029' {
				return invalid()
			}
		}
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, ";") {
			continue
		}
		if strings.HasPrefix(t, "[") {
			end := strings.IndexByte(t, ']')
			if end < 2 {
				return invalid()
			}
			tail := strings.TrimSpace(t[end+1:])
			if tail != "" && !strings.HasPrefix(tail, "#") && !strings.HasPrefix(tail, ";") {
				return invalid()
			}
			section = t[1:end]
			if strings.EqualFold(section, "Doom.NetServerInfo") {
				sections++
				if section != "Doom.NetServerInfo" || sections != 1 {
					return invalid()
				}
			}
			continue
		}
		name, rawValue, ok := strings.Cut(t, "=")
		name = strings.TrimSpace(name)
		if !ok || name == "" || strings.ContainsAny(name, "[]/\"' \t") {
			return invalid()
		}
		if strings.EqualFold(section, "Doom.NetServerInfo") && strings.EqualFold(name, "sv_website") {
			if !regexp.MustCompile(`^(?:"(?:\\.|[^"\\])*"|'[^']*'|[^"'#;]*)(?:[ \t]*[#;].*)?$`).MatchString(strings.TrimSpace(rawValue)) {
				return invalid()
			}
			targets++
			if name != "sv_website" || targets != 1 {
				return invalid()
			}
			var err error
			target, err = parseGameSettingsLines(zandronumSettingsPath, []byte(targetHeader+originalLine))
			if err != nil || len(target.fields) != 1 {
				return invalid()
			}
			targetStart, targetEnd = lineStart, offset
		}
		key := section + "/" + name
		if seen[key] {
			continue
		}
		seen[key] = true
		f := gameSettingType(key, strings.TrimSpace(rawValue))
		f.kind = "readonly"
		if key == zandronumWebsiteKey {
			f = target.fields[0]
			f.kind = "text"
		}
		parsed.fields = append(parsed.fields, f)
		if len(parsed.fields) > 4000 {
			return invalid()
		}
	}
	if sections != 1 || targets != 1 {
		return invalid()
	}
	// Native unquoted chat macros contain apostrophes. Parse only the editable
	// line as a scalar; preserve every other native byte without interpreting it.
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key, value := range changes {
			if key != zandronumWebsiteKey || !zandronumWebsiteValid(value) {
				return nil, bad("Only an empty website or an absolute HTTP(S) URL without credentials can be saved here.")
			}
		}
		patched, err := target.patch(changes)
		if err != nil {
			return nil, err
		}
		result := append([]byte{}, data[:targetStart]...)
		result = append(result, patched[len(targetHeader):]...)
		result = append(result, data[targetEnd:]...)
		return result, nil
	}
	return parsed, nil
}

// Pins are the exact emitted frozen recipe bytes, including the final newline.
func zandronumSourceHelpers(files map[string][]byte) bool {
	pins := map[string]string{
		".voltra/native_release.py":       "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
		".voltra/native_zip_release.py":   "ec5537319192fb653721fa0266a768381a4bce3608151df44bc67e1f8371ce95",
		".voltra/native_console.py":       "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
		".voltra/steam_template.py":       "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
		".voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
		".voltra/zandronum_huffman.py":    "11690167b807fd5303b204a18d43be8bd8dd47c82a976471e65e077847668932",
		".voltra/id_family_install.py":    "ad8ac3f5f61e232945529617efeb90d5535587f702c4d38bc2aea056f7dd2b9c",
		".voltra/id_family_runtime.py":    "cef3ffd89a7439f5ab4a66b34153b2857af0021cd61e2001e92d6907f7121ae0",
		".voltra/id_family_query.py":      "8721fa0873b1ffe7c2a96f39e856a7b9dc1f49aebc245a029e7b5c31db5bec4a",
		".voltra/zandronum-default.ini":   "9b2aab0053ead57747c91cbe8ec949d3b703c00c8efab7ffabe4de810ff2426d",
	}
	for name, want := range pins {
		if fmt.Sprintf("%x", sha256.Sum256(files[name])) != want {
			return false
		}
	}
	return true
}
