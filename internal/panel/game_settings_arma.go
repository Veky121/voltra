package panel

import (
	"regexp"
	"strconv"
	"strings"
)

func parseGameSettingsForEgg(egg M, file string, data []byte) (gameSettingsParsed, error) {
	if r := campaignParserRecipe(egg); r != "" {
		return parseDiscoveredGameSettings(egg, file, data)
	}
	if p, _ := integratedScalarSettings(egg); p != "" {
		if !integratedScalarDocument(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		switch p {
		case towerSettingsPath:
			return parseTowerSettings(data)
		case windroseSettingsPath:
			return parseWindroseSettings(data)
		case terraTechSettingsPath:
			return parseTerraTechSettings(data)
		}
	}

	if p, _ := reviewedNewSettings(egg); p != "" {
		if !reviewedNewDocument(egg, file) {
			return gameSettingsParsed{}, notFound()
		}
		if nativeSettingsIsRecipe(egg, sonsSettingsRecipe) {
			return parseCompleteSonsSettings(data)
		}
		if nativeSettingsIsRecipe(egg, resoniteSettingsRecipe) {
			return parseCompleteResoniteSettings(data)
		}
		if nativeSettingsIsRecipe(egg, redMSettingsRecipe) {
			return parseRedMSettings(data)
		}
		if nativeSettingsIsRecipe(egg, portalKnightsRecipe) {
			return parsePortalKnightsSettings(data)
		}
		if p == "/data/Config/options.json" {
			return parseFoundryVTTSettings(data)
		}
		return parseFiveMSettings(data)
	}

	if hl2dmSettingsDocument(egg, file) {
		return parseHL2DMSettings(data)
	}
	if file == hl2dmSettingsPath && nativeSettingsIsRecipe(egg, hl2dmSettingsRecipe) {
		return gameSettingsParsed{}, notFound()
	}
	if nativeSettingsIsRecipe(egg, quakeLiveSettingsRecipe) && (file == quakeLiveHomeSettingsPath || file == quakeLiveBaseSettingsPath) {
		if file != str(egg["_quakelive_settings_path"]) {
			return gameSettingsParsed{}, notFound()
		}
		return parseQuakeLiveSettings(data)
	}
	if etlegacySettingsDocument(egg, file) {
		return parseETLegacySettings(data)
	}
	if file == etlegacySettingsPath && nativeSettingsIsRecipe(egg, etlegacySettingsRecipe) {
		return gameSettingsParsed{}, bad("ET: Legacy native settings require the reviewed authority launcher.")
	}
	if openraSettingsDocument(egg, file) {
		return parseOpenRAMiniYAMLSettings(data)
	}
	if file == openraSettingsPath && (openraSettingsStartup(egg) != "") {
		return gameSettingsParsed{}, bad("OpenRA native settings require the reviewed dedicated launcher.")
	}
	if file == luantiSettingsPath && nativeSettingsIsRecipe(egg, "minetest/egg-minetest.json") {
		return parseLuantiSettings(data)
	}
	if mindustrySettingsDocument(egg, file) {
		return parseMindustrySettings(data)
	}
	if openArenaSettingsDocument(egg, file) {
		return parseOpenArenaSettings(data)
	}
	if file == xonoticSettingsPath && nativeSettingsIsRecipe(egg, "xonotic/egg-xonotic.json") {
		return parseXonoticSettings(data)
	}
	if file == goldSrcCS16SettingsPath && nativeSettingsIsRecipe(egg, "counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json") {
		return parseGoldSrcCS16Settings(data)
	}
	if file == cssSettingsPath && nativeSettingsIsRecipe(egg, "counter_strike/counter_strike_source/egg-counter--strike--source.json") {
		return parseCSSSettings(data)
	}
	if file == teeworldsSettingsPath && nativeSettingsIsRecipe(egg, "teeworlds/egg-teeworlds.json") {
		return parseTeeworldsSettings(data)
	}
	if file == tachyonSettingsPath && nativeSettingsIsRecipe(egg, "ftl_tachyon/egg-tachyon.json") {
		return parseTachyonSettings(data)
	}
	if file == ddnetSettingsPath && nativeSettingsIsRecipe(egg, "ddnet/egg-d-d-net.json") {
		return parseDDNetOriginalSettings(data)
	}
	if kind := cubeGameSettingsKind(egg, file); kind != "" {
		return parseCubeGameSettings(kind, data)
	}
	if selected := bananaSelectedSettingsDocument(egg); selected != "" && file == selected {
		return parseBananaAliasSettings(data)
	}
	if file == cs2dSettingsPath && nativeSettingsIsRecipe(egg, "cs2d/egg-c-s2-d.json") {
		return parseCS2DSettings(data)
	}
	if file == carrierSettingsPath && nativeSettingsIsRecipe(egg, "carrier_command_2/egg-carrier-command2.json") {
		return parseCarrierGameSettings(data)
	}
	if file == cryofallSettingsPath && nativeSettingsIsRecipe(egg, "cryofall/egg-cryo-fall.json") {
		return parseCryoFallSettings(data)
	}
	if cubicSettingsDocument(egg, file) {
		return parseCubicSettings(data)
	}
	if file == barotraumaSettingsPath && nativeSettingsIsRecipe(egg, "barotrauma/egg-barotrauma.json") {
		return parseBarotraumaSettings(data)
	}
	if file == askaSettingsPath && nativeSettingsIsRecipe(egg, "Aska/egg-aska.json") {
		return parseASKASettings(data)
	}
	if nativeSettingsIsSTK(egg) && file != "" && file == str(egg["_stk_settings_path"]) {
		return parseSTKGameSettings(data)
	}
	if nativeSettingsIsRecipe(egg, "ddracenetwork/egg-d-d-race-network.json") && (file == ddnetSettingsPath || file == ddnetDataSettingsPath) {
		return parseDDNetSettings(data)
	}
	game := nativeSettingsGameID(egg)
	if game == "cs2" && file == sourceSettingsPath {
		return parseSourceSettings(data)
	}
	if game == "arma3" && (file == "/server.cfg" || file == "/basic.cfg" || file == "server.cfg" || file == "basic.cfg") {
		return parseArmaSettings(data)
	}
	if format := nativeSettingsDocuments(egg)[file]; format != "" && gameSettingsFormat(file) == "" {
		return parseGameSettings("/native."+map[string]string{"json": "json", "yaml": "yaml", "ini": "ini", "properties": "properties", "xml": "xml"}[format], data)
	}
	if soldatSettingsRecipe(egg) && !soldatSettingsDocument(egg, file) {
		return gameSettingsParsed{}, notFound()
	}
	parsed, err := parseGameSettings(file, data)
	if err != nil {
		return parsed, err
	}
	if nativeSettingsIsRecipe(egg, soldatClassicRecipe) {
		parsed = soldatNativeSettingsSafety(file, parsed)
	}
	if nativeSettingsIsRecipe(egg, soldat2Recipe) {
		parsed = soldat2SettingsSafety(parsed)
	}
	parsed = craftopiaSettingsFields(egg, file, data, parsed)
	if nativeSettingsIsRecipe(egg, "terraria/tshock/egg-tshock.json") {
		parsed = tshockNativeSettingsSafety(file, parsed)
	}
	parsed = openttdSettingsFields(egg, file, parsed)
	parsed = empyrionSettingsFields(egg, file, parsed)
	return ss14GameSettingsSafety(egg, file, parsed), nil
}

// Imported recipes have content-pinned UUIDs, not managed Steam UUIDs. Match
// their exact adapter argv rather than display names or generic log text.
func nativeSettingsGameID(egg M) string {
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
func parseArmaSettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{fields: []gameSetting{}}
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
			out.fields = append(out.fields, gameSetting{key: key, value: value, kind: kind, on: "1", off: "0"})
			counts[strings.ToLower(key)]++
			spans[key] = span{a, b, quoted}
		}
		start = i + 1
	}
	if depth != 0 || strings.TrimSpace(string(mask[start:])) != "" {
		return out, bad("Incomplete Arma CFG statement.")
	}
	for i := range out.fields {
		if counts[strings.ToLower(out.fields[i].key)] > 1 {
			out.fields[i].kind = "readonly"
		}
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
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
			for _, f := range out.fields {
				if f.key == key && f.kind != "readonly" {
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

func parseCampaignTruckSettings(data []byte) (gameSettingsParsed, error) {
	d, err := ParseTruckSII(data)
	if err != nil {
		return gameSettingsParsed{}, err
	}
	out := gameSettingsParsed{}
	values := d.Values()
	for _, spec := range TruckSIIFields() {
		v, ok := values[spec.Key]
		if !ok {
			continue
		}
		f := gameSettingType(spec.Key, str(v))
		if b, ok := v.(bool); ok {
			f.kind = "boolean"
			f.on = "true"
			f.off = "false"
			f.value = strconv.FormatBool(b)
		}
		out.fields = append(out.fields, f)
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
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
