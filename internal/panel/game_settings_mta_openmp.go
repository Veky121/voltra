package panel

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"io"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Native credentials and all startup-owned scalars are deliberately absent.
// Existing source-evidenced ordinary scalars only; native secrets remain opaque.
func parseOpenMPNativeSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous open.mp settings.")
	}
	if len(data) > 4<<20 || !utf8.Valid(data) || !json.Valid(data) {
		return invalid()
	}
	spans, err := bananaJSONSpans(data)
	if err != nil || !spans[""].object {
		return invalid()
	}
	seen := map[string]bool{}
	for key := range spans {
		low := strings.ToLower(key)
		if seen[low] {
			return invalid()
		}
		seen[low] = true
		for _, known := range []string{"/language", "/website", "/name", "/max_players", "/announce", "/enable_query", "/rcon/enable"} {
			if strings.EqualFold(key, known) && key != known {
				return invalid()
			}
		}
	}
	out := gameSettingsParsed{fields: []gameSetting{}}
	existing := map[string]string{}
	for _, key := range []string{"/language", "/website", "/name", "/max_players", "/announce", "/enable_query", "/rcon/enable"} {
		if s, ok := spans[key]; ok {
			value, kind, valid := gtaScalar(key, data[s.start:s.end])
			if !valid {
				return invalid()
			}
			existing[key] = value
			out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"})
		}
	}
	original := append([]byte(nil), data...)
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for key, value := range changes {
			old, ok := existing[key]
			if !ok || !gtaScalarEdit(key, value) {
				return nil, bad("Unsupported open.mp edit.")
			}
			if old != value {
				keys = append(keys, key)
			}
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), original...)
		for _, key := range keys {
			s := spans[key]
			v := []byte(changes[key])
			if key != "/max_players" && key != "/announce" && key != "/enable_query" && key != "/rcon/enable" {
				v, _ = json.Marshal(changes[key])
			}
			result = append(append(append([]byte{}, result[:s.start]...), v...), result[s.end:]...)
		}
		return result, nil
	}
	return out, nil
}
func gtaNativeText(value string) bool {
	return utf8.ValidString(value) && len(value) <= 4096 && strings.IndexFunc(value, func(c rune) bool { return c < 32 || c == 127 || c == 0x2028 || c == 0x2029 }) < 0
}

// MTA is XML, never JSON or INI. No unverified publisher fields are invented.
// Only direct ordinary scalar nodes are patched; resources and unknown nodes stay opaque.
func parseMTANativeSettings(data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or unsupported MTA XML.")
	}
	if len(data) > 4<<20 || !utf8.Valid(data) {
		return invalid()
	}
	d := xml.NewDecoder(bytes.NewReader(data))
	depth, roots := 0, 0
	seen := map[string]bool{}
	spans := map[string][2]int{}
	values := map[string]string{}
	active := ""
	begin := 0
	for {
		offset := int(d.InputOffset())
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch v := token.(type) {
		case xml.Directive:
			return invalid()
		case xml.StartElement:
			depth++
			if v.Name.Space != "" {
				return invalid()
			}
			if depth == 1 {
				roots++
				if v.Name.Local != "config" {
					return invalid()
				}
			}
			if depth == 2 {
				key := strings.ToLower(v.Name.Local)
				if seen[key] && key != "resource" && key != "module" {
					return invalid()
				}
				seen[key] = true
				if key == "servername" || key == "maxplayers" {
					if key != v.Name.Local || len(v.Attr) != 0 {
						return invalid()
					}
					active = key
					begin = int(d.InputOffset())
				}
			} else if active != "" && depth > 2 {
				return invalid()
			}
		case xml.EndElement:
			if depth == 2 && active != "" {
				part := data[begin:offset]
				if bytes.Contains(part, []byte("<")) {
					return invalid()
				}
				var value string
				if xml.Unmarshal(append(append([]byte("<x>"), part...), []byte("</x>")...), &value) != nil || !gtaScalarEdit("/"+active, value) {
					return invalid()
				}
				values[active] = value
				spans[active] = [2]int{begin, offset}
				active = ""
			}
			depth--
		}
	}
	if roots != 1 || depth != 0 {
		return invalid()
	}
	original := append([]byte(nil), data...)
	fields := []gameSetting{}
	for _, key := range []string{"servername", "maxplayers"} {
		if value, ok := values[key]; ok {
			kind := "text"
			if key == "maxplayers" {
				kind = "number"
			}
			fields = append(fields, gameSetting{key: key, value: value, kind: kind, on: "true", off: "false"})
		}
	}
	return gameSettingsParsed{fields: fields, patch: func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for key, value := range changes {
			old, ok := values[key]
			if !ok || !gtaScalarEdit("/"+key, value) {
				return nil, bad("Unsupported MTA edit.")
			}
			if old != value {
				keys = append(keys, key)
			}
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]][0] > spans[keys[j]][0] })
		result := append([]byte(nil), original...)
		for _, key := range keys {
			var value bytes.Buffer
			xml.EscapeText(&value, []byte(changes[key]))
			span := spans[key]
			result = append(append(append([]byte{}, result[:span[0]]...), value.Bytes()...), result[span[1]:]...)
		}
		return result, nil
	}}, nil
}

func gtaScalarEdit(key, value string) bool {
	switch key {
	case "/max_players", "/maxplayers":
		n, e := strconv.Atoi(value)
		limit := 1000
		if key == "/maxplayers" {
			limit = 4096
		}
		return e == nil && n >= 1 && n <= limit && strconv.Itoa(n) == value
	case "/announce", "/enable_query", "/rcon/enable":
		return value == "true" || value == "false"
	default:
		return gtaNativeText(value)
	}
}
func gtaScalar(key string, raw []byte) (string, string, bool) {
	switch key {
	case "/max_players":
		v := string(raw)
		return v, "number", gtaScalarEdit(key, v)
	case "/announce", "/enable_query", "/rcon/enable":
		v := string(raw)
		return v, "boolean", gtaScalarEdit(key, v)
	default:
		var v string
		e := json.Unmarshal(raw, &v)
		return v, "text", e == nil && gtaNativeText(v)
	}
}

// Pure authority over bounded regular snapshots. Caller owns RBAC, stopped state,
// locks, revisions and final re-read. Candidate pins grant no runtime acceptance.
func ResolveGTANativeAuthority(recipe string, mappings []byte, in settingsAuthorityInput) (settingsPathAuthority, error) {
	refuse := bad("Unsupported GTA startup/helper/path/port authority.")
	game, path := "", ""
	switch recipe {
	case "gta/openmp/egg-open-m-p.json":
		game = "openmp"
		path = "openmp/config.json"
	case "gta/mtasa/egg-multi-theft-auto.json":
		game = "mtasa"
		path = "mtasa/mods/deathmatch/mtaserver.conf"
	default:
		return settingsPathAuthority{}, refuse
	}
	if in.Startup != "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/gta-runtime.py "+game {
		return settingsPathAuthority{}, refuse
	}
	if root := in.Env["VOLTRA_SERVER_ROOT"]; root != "" && root != "/home/container" {
		return settingsPathAuthority{}, refuse
	}
	var writers map[string]json.RawMessage
	if json.Unmarshal(mappings, &writers) != nil || writers == nil || len(writers) != 0 {
		return settingsPathAuthority{}, refuse
	}
	for name, hash := range gtaReviewedCandidatePins {
		if settingsAuthorityHash(in.Files[name]) != hash {
			return settingsPathAuthority{}, refuse
		}
	}
	port, e := strconv.Atoi(in.Env["SERVER_PORT"])
	if e != nil || port < 1 || port > 65535 {
		return settingsPathAuthority{}, refuse
	}
	ports := map[int]bool{}
	for _, v := range strings.Split(in.Env["VOLTRA_ALLOCATED_PORTS"], ",") {
		n, e := strconv.Atoi(v)
		if e != nil || n < 1 || n > 65535 {
			return settingsPathAuthority{}, refuse
		}
		ports[n] = true
	}
	if !ports[port] {
		return settingsPathAuthority{}, refuse
	}
	raw, ok := in.Files[path]
	if !ok {
		return settingsPathAuthority{}, refuse
	}
	if game == "openmp" {
		if _, e := parseOpenMPNativeSettings(raw); e != nil {
			return settingsPathAuthority{}, e
		}
		var c struct {
			Network struct {
				Port int
				Bind string
			}
			Artwork struct {
				Enable bool
				Port   int
			}
		}
		if json.Unmarshal(raw, &c) != nil || c.Network.Port != port || c.Network.Bind != "0.0.0.0" || c.Artwork.Enable && !ports[c.Artwork.Port] {
			return settingsPathAuthority{}, refuse
		}
	} else {
		if _, e := parseMTANativeSettings(raw); e != nil {
			return settingsPathAuthority{}, e
		}
		var c struct {
			Port int    `xml:"serverport"`
			HTTP int    `xml:"httpport"`
			IP   string `xml:"serverip"`
			ASE  int    `xml:"ase"`
		}
		if xml.Unmarshal(raw, &c) != nil || c.Port != port || c.IP != "auto" || c.HTTP == port || !ports[c.HTTP] || c.ASE < 0 || c.ASE > 1 || c.ASE == 1 && (!ports[port+123] || c.HTTP == port+123) {
			return settingsPathAuthority{}, refuse
		}
		if v := in.Env["SERVER_WEBPORT"]; v != "" && v != "0" && v != strconv.Itoa(c.HTTP) {
			return settingsPathAuthority{}, refuse
		}
		if v := in.Env["ASE_ENABLED"]; v != "" && v != strconv.Itoa(c.ASE) {
			return settingsPathAuthority{}, refuse
		}
	}
	return settingsAuthorityResult("/"+path, "gta-reviewed-wave63:"+in.Startup+":"+in.Env["VOLTRA_ALLOCATED_PORTS"]), nil
}

var gtaReviewedCandidatePins = map[string]string{
	".voltra/gta-install.py":          "7e9ffe42ef646827e090e264b247db33349695dca59fb8eca087003b88f0d590",
	".voltra/gta-runtime.py":          "020a910289e4ea3df629f7bd8e7fee0ed26e342d0df050eba90537ef1b53dd24",
	".voltra/native-release.py":       "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
	".voltra/native-config.py":        "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
	".voltra/native-console.py":       "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
	".voltra/bundle-debian-python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
	".voltra/steam_template.py":       "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
}
