package gamesettings

import (
	"regexp"
	"strconv"
	"strings"
)

func ParseForEgg(egg M, file string, data []byte) (Parsed, error) {
	if r := CampaignParserRecipe(egg); r != "" {
		return ParseDiscovered(egg, file, data)
	}
	if p, _ := integratedScalarSettings(egg); p != "" {
		if !integratedScalarDocument(egg, file) {
			return Parsed{}, notFound()
		}
		switch p {
		case TowerSettingsPath:
			return parseTowerSettings(data)
		case WindroseSettingsPath:
			return parseWindroseSettings(data)
		case TerraTechSettingsPath:
			return parseTerraTechSettings(data)
		}
	}

	if p, _ := ReviewedNewSettings(egg); p != "" {
		if !reviewedNewDocument(egg, file) {
			return Parsed{}, notFound()
		}
		if IsRecipe(egg, SonsSettingsRecipe) {
			return parseCompleteSonsSettings(data)
		}
		if IsRecipe(egg, ResoniteSettingsRecipe) {
			return parseCompleteResoniteSettings(data)
		}
		if IsRecipe(egg, RedMSettingsRecipe) {
			return parseRedMSettings(data)
		}
		if IsRecipe(egg, PortalKnightsRecipe) {
			return parsePortalKnightsSettings(data)
		}
		if p == "/data/Config/options.json" {
			return parseFoundryVTTSettings(data)
		}
		return parseFiveMSettings(data)
	}

	if Hl2dmSettingsDocument(egg, file) {
		return ParseHL2DMSettings(data)
	}
	if file == Hl2dmSettingsPath && IsRecipe(egg, Hl2dmSettingsRecipe) {
		return Parsed{}, notFound()
	}
	if IsRecipe(egg, QuakeLiveSettingsRecipe) && (file == QuakeLiveHomeSettingsPath || file == QuakeLiveBaseSettingsPath) {
		if file != str(egg["_quakelive_settings_path"]) {
			return Parsed{}, notFound()
		}
		return parseQuakeLiveSettings(data)
	}
	if etlegacySettingsDocument(egg, file) {
		return parseETLegacySettings(data)
	}
	if file == EtlegacySettingsPath && IsRecipe(egg, EtlegacySettingsRecipe) {
		return Parsed{}, bad("ET: Legacy native settings require the reviewed authority launcher.")
	}
	if openraSettingsDocument(egg, file) {
		return parseOpenRAMiniYAMLSettings(data)
	}
	if file == OpenraSettingsPath && (OpenraSettingsStartup(egg) != "") {
		return Parsed{}, bad("OpenRA native settings require the reviewed dedicated launcher.")
	}
	if file == LuantiSettingsPath && IsRecipe(egg, "minetest/egg-minetest.json") {
		return parseLuantiSettings(data)
	}
	if MindustrySettingsDocument(egg, file) {
		return ParseMindustrySettings(data)
	}
	if openArenaSettingsDocument(egg, file) {
		return parseOpenArenaSettings(data)
	}
	if file == XonoticSettingsPath && IsRecipe(egg, "xonotic/egg-xonotic.json") {
		return parseXonoticSettings(data)
	}
	if file == GoldSrcCS16SettingsPath && IsRecipe(egg, "counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json") {
		return parseGoldSrcCS16Settings(data)
	}
	if file == CssSettingsPath && IsRecipe(egg, "counter_strike/counter_strike_source/egg-counter--strike--source.json") {
		return parseCSSSettings(data)
	}
	if file == teeworldsSettingsPath && IsRecipe(egg, "teeworlds/egg-teeworlds.json") {
		return parseTeeworldsSettings(data)
	}
	if file == tachyonSettingsPath && IsRecipe(egg, "ftl_tachyon/egg-tachyon.json") {
		return parseTachyonSettings(data)
	}
	if file == DdnetSettingsPath && IsRecipe(egg, "ddnet/egg-d-d-net.json") {
		return ParseDDNetOriginalSettings(data)
	}
	if kind := cubeGameSettingsKind(egg, file); kind != "" {
		return parseCubeGameSettings(kind, data)
	}
	if selected := BananaSelectedSettingsDocument(egg); selected != "" && file == selected {
		return parseBananaAliasSettings(data)
	}
	if file == Cs2dSettingsPath && IsRecipe(egg, "cs2d/egg-c-s2-d.json") {
		return parseCS2DSettings(data)
	}
	if file == CarrierSettingsPath && IsRecipe(egg, "carrier_command_2/egg-carrier-command2.json") {
		return ParseCarrierGameSettings(data)
	}
	if file == cryofallSettingsPath && IsRecipe(egg, "cryofall/egg-cryo-fall.json") {
		return parseCryoFallSettings(data)
	}
	if CubicSettingsDocument(egg, file) {
		return ParseCubicSettings(data)
	}
	if file == BarotraumaSettingsPath && IsRecipe(egg, "barotrauma/egg-barotrauma.json") {
		return parseBarotraumaSettings(data)
	}
	if file == AskaSettingsPath && IsRecipe(egg, "Aska/egg-aska.json") {
		return ParseASKASettings(data)
	}
	if nativeSettingsIsSTK(egg) && file != "" && file == str(egg["_stk_settings_path"]) {
		return parseSTKGameSettings(data)
	}
	if IsRecipe(egg, "ddracenetwork/egg-d-d-race-network.json") && (file == DdnetSettingsPath || file == ddnetDataSettingsPath) {
		return parseDDNetSettings(data)
	}
	game := NativeGameID(egg)
	if game == "cs2" && file == SourceSettingsPath {
		return parseSourceSettings(data)
	}
	if game == "arma3" && (file == "/server.cfg" || file == "/basic.cfg" || file == "server.cfg" || file == "basic.cfg") {
		return parseArmaSettings(data)
	}
	if format := NativeDocuments(egg)[file]; format != "" && gameSettingsFormat(file) == "" {
		return Parse("/native."+map[string]string{"json": "json", "yaml": "yaml", "ini": "ini", "properties": "properties", "xml": "xml"}[format], data)
	}
	if soldatSettingsRecipe(egg) && !soldatSettingsDocument(egg, file) {
		return Parsed{}, notFound()
	}
	parsed, err := Parse(file, data)
	if err != nil {
		return parsed, err
	}
	if IsRecipe(egg, SoldatClassicRecipe) {
		parsed = soldatNativeSettingsSafety(file, parsed)
	}
	if IsRecipe(egg, Soldat2Recipe) {
		parsed = soldat2SettingsSafety(parsed)
	}
	parsed = CraftopiaSettingsFields(egg, file, data, parsed)
	if IsRecipe(egg, "terraria/tshock/egg-tshock.json") {
		parsed = tshockNativeSettingsSafety(file, parsed)
	}
	parsed = OpenttdSettingsFields(egg, file, parsed)
	parsed = EmpyrionSettingsFields(egg, file, parsed)
	return Ss14GameSettingsSafety(egg, file, parsed), nil
}

// Imported recipes have content-pinned UUIDs, not managed Steam UUIDs. Match
// their exact adapter argv rather than display names or generic log text.
func NativeGameID(egg M) string {
	if game := steamGameID(egg); game != "" {
		return game
	}
	args := strings.Fields(str(egg["startup"]))
	for i, arg := range args {
		if arg == ".voltra/cs2_runtime.py" {
			return "cs2"
		}
		if (arg == ".voltra/arma3-controls.py" || arg == ".voltra/arma-native.py") && i+2 < len(args) && args[i+1] == "run" && args[i+2] == "arma3" {
			return "arma3"
		}
	}
	return ""
}

var armaAssignment = regexp.MustCompile(`^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*;\s*$`)
var armaString = regexp.MustCompile(`^"(?:[^"\r\n\\]|"")*"$`)
var armaNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
var armaBounds = map[string][2]float64{
	"maxPlayers": {1, 2147483647}, "verifySignatures": {0, 2}, "vonCodecQuality": {1, 30},
	"BattlEye": {0, 1}, "persistent": {0, 1}, "disableVoN": {0, 1},
	"MaxMsgSend": {1, 2147483647}, "MaxSizeGuaranteed": {1, 2147483647},
	"MaxSizeNonguaranteed": {1, 2147483647}, "MinBandwidth": {0, 2147483647}, "MaxBandwidth": {0, 2147483647},
	"MinErrorToSend": {0, 1}, "MinErrorToSendNear": {0, 1},
}

// Tokenize strings and comments before considering braces or statement boundaries.
// Only complete, unambiguous top-level scalar assignments have writable spans.
func parseArmaSettings(data []byte) (Parsed, error) {
	out := Parsed{Fields: []Setting{}}
	text := string(data)
	mask := []byte(text)
	for i := 0; i < len(mask); {
		start := i
		if strings.HasPrefix(text[i:], "//") {
			for i < len(mask) && text[i] != '\n' {
				i++
			}
		} else if strings.HasPrefix(text[i:], "/*") {
			end := strings.Index(text[i+2:], "*/")
			if end < 0 {
				return out, bad("Unterminated Arma CFG comment.")
			}
			i += end + 4
		} else if text[i] == '"' {
			i++
			closed := false
			for i < len(mask) {
				if text[i] == '"' {
					if i+1 < len(mask) && text[i+1] == '"' {
						i += 2
						continue
					}
					i++
					closed = true
					break
				}
				i++
			}
			if !closed {
				return out, bad("Unterminated Arma CFG string.")
			}
			// Keep the string token visible, but hide its punctuation.
			for j := start + 1; j < i-1; j++ {
				mask[j] = 'x'
			}
			continue
		} else {
			i++
			continue
		}
		for j := start; j < i; j++ {
			if mask[j] != '\n' && mask[j] != '\r' {
				mask[j] = ' '
			}
		}
	}
	if strings.Contains(string(mask), "#") {
		return out, bad("Preprocessed Arma CFG requires Files.")
	}
	type span struct {
		start, end int
		quoted     bool
	}
	spans := map[string]span{}
	counts := map[string]int{}
	start, depth := 0, 0
	for i, c := range mask {
		if c == '{' {
			depth++
		}
		if c == '}' {
			depth--
			if depth < 0 {
				return out, bad("Unbalanced Arma CFG.")
			}
		}
		if c != ';' || depth != 0 {
			continue
		}
		segment := string(mask[start : i+1])
		m := armaAssignment.FindStringSubmatchIndex(segment)
		if m != nil {
			key := segment[m[2]:m[3]]
			a, b := start+m[4], start+m[5]
			raw := text[a:b]
			quoted := armaString.MatchString(raw)
			value := raw
			kind := "readonly"
			if quoted && !strings.ContainsAny(raw[1:len(raw)-1], "\r\n\\") {
				value = strings.ReplaceAll(raw[1:len(raw)-1], `""`, `"`)
				kind = "text"
			} else if armaNumber.MatchString(raw) {
				kind = "number"
			}
			if strings.Contains(strings.ToLower(key), "port") || strings.EqualFold(key, "IP") || strings.Contains(strings.ToLower(key), "address") {
				kind = "readonly"
			}
			if key == "BattlEye" || key == "persistent" || key == "disableVoN" {
				if raw == "0" || raw == "1" {
					kind = "boolean"
				}
			}
			out.Fields = append(out.Fields, Setting{Key: key, Value: value, Kind: kind, On: "1", Off: "0"})
			counts[strings.ToLower(key)]++
			spans[key] = span{a, b, quoted}
		}
		start = i + 1
	}
	if depth != 0 || strings.TrimSpace(string(mask[start:])) != "" {
		return out, bad("Incomplete Arma CFG statement.")
	}
	for i := range out.Fields {
		if counts[strings.ToLower(out.Fields[i].Key)] > 1 {
			out.Fields[i].Kind = "readonly"
		}
	}
	out.Patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			a, b int
			v    string
		}
		edits := []edit{}
		for key, value := range changes {
			sp, ok := spans[key]
			if !ok || counts[strings.ToLower(key)] != 1 {
				return nil, bad("Ambiguous Arma CFG setting.")
			}
			writable := false
			for _, f := range out.Fields {
				if f.Key == key && f.Kind != "readonly" {
					writable = true
				}
			}
			if !writable {
				return nil, bad("Unsupported Arma CFG setting.")
			}
			if sp.quoted {
				if len(value) > 4096 || strings.ContainsAny(value, "\r\n\x00\\") {
					return nil, bad("Invalid Arma CFG string.")
				}
				value = `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
			} else {
				if !armaNumber.MatchString(value) {
					return nil, bad("Invalid Arma CFG number.")
				}
				n, e := strconv.ParseFloat(value, 64)
				if e != nil {
					return nil, bad("Invalid Arma CFG number.")
				}
				if bounds, ok := armaBounds[key]; ok {
					if n < bounds[0] || n > bounds[1] || (key != "MinErrorToSend" && key != "MinErrorToSendNear" && n != float64(int64(n))) {
						return nil, bad("Arma CFG value outside supported bounds.")
					}
				}
			}
			edits = append(edits, edit{sp.start, sp.end, value})
		}
		// Reverse source order keeps all untouched bytes, including comments, intact.
		for i := 0; i < len(edits); i++ {
			for j := i + 1; j < len(edits); j++ {
				if edits[j].a > edits[i].a {
					edits[i], edits[j] = edits[j], edits[i]
				}
			}
		}
		result := text
		for _, e := range edits {
			result = result[:e.a] + e.v + result[e.b:]
		}
		return []byte(result), nil
	}
	return out, nil
}

func parseCampaignTruckSettings(data []byte) (Parsed, error) {
	d, err := ParseTruckSII(data)
	if err != nil {
		return Parsed{}, err
	}
	out := Parsed{}
	values := d.Values()
	for _, spec := range TruckSIIFields() {
		v, ok := values[spec.Key]
		if !ok {
			continue
		}
		f := SettingType(spec.Key, str(v))
		if b, ok := v.(bool); ok {
			f.Kind = "boolean"
			f.On = "true"
			f.Off = "false"
			f.Value = strconv.FormatBool(b)
		}
		out.Fields = append(out.Fields, f)
	}
	out.Patch = func(changes map[string]string) ([]byte, error) {
		m := map[string]any{}
		for k, v := range changes {
			switch values[k].(type) {
			case bool:
				b, e := strconv.ParseBool(v)
				if e != nil {
					return nil, e
				}
				m[k] = b
			case string:
				m[k] = v
			default:
				n, e := strconv.Atoi(v)
				if e != nil {
					return nil, e
				}
				m[k] = n
			}
		}
		return d.Patch(m)
	}
	return out, nil
}
