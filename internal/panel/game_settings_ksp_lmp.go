package panel

import (
	"bytes"
	"encoding/xml"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const kspLMPRecipe = "ksp/LMP/egg-k-s-p--l-m-p.json"
const kspLMPStartup = "exec python3 .voltra/ksp_runtime.py lmp"

// Pure snapshot authority. Caller must lock and re-read confined regular files,
// RBAC, stopped state, authority revision and document revision before publishing.
func kspLMPSettingsAuthority(recipe, file string, in settingsAuthorityInput) (settingsPathAuthority, error) {
	root, _ := kspLMPSchema(file)
	if recipe != kspLMPRecipe || root == "" || in.Startup != kspLMPStartup || !settingsAuthoritySources(in, map[string]string{
		".voltra/ksp_runtime.py":    "c873a36483a820c3b2050a6cd6380c41809e56cdb0c1d317ae2f327d5a1853ad",
		".voltra/native_config.py":  "8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",
		".voltra/native_console.py": "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
	}) {
		return settingsPathAuthority{}, bad("Unproved LMP settings authority")
	}
	return settingsAuthorityResult(file, kspLMPStartup+":wave63"), nil
}
func kspLMPKind(t string) string {
	switch t {
	case "bool":
		return "boolean"
	case "int", "float":
		return "number"
	}
	if strings.HasPrefix(t, "enum:") {
		return "text"
	}
	return t
}
func kspLMPValid(t, v string) bool {
	if !utf8.ValidString(v) || len(v) > 8192 || strings.IndexFunc(v, func(r rune) bool { return r < 32 || r == 127 || r == 0xfffe || r == 0xffff }) >= 0 {
		return false
	}
	switch t {
	case "bool":
		return v == "true" || v == "false"
	case "int":
		n, e := strconv.ParseInt(v, 10, 32)
		return e == nil && strconv.FormatInt(n, 10) == v
	case "float":
		n, e := strconv.ParseFloat(v, 32)
		return e == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
	case "text":
		return true
	}
	if strings.HasPrefix(t, "enum:") {
		for _, x := range strings.Split(strings.TrimPrefix(t, "enum:"), ",") {
			if x == v {
				return true
			}
		}
	}
	return false
}

// Definitions are captured local source, not fabricated defaults or UI ranges.
func kspLMPSchema(file string) (string, map[string]string) {
	switch file {
	case "/LMPServer/Config/GeneralSettings.xml":
		return "GeneralSettingsDefinition", map[string]string{
			"ServerName":           "text",
			"Description":          "text",
			"CountryCode":          "text",
			"WebsiteText":          "text",
			"Website":              "text",
			"ServerMotd":           "text",
			"PrintMotdInChat":      "bool",
			"MaxPlayers":           "int",
			"MaxUsernameLength":    "int",
			"AutoDekessler":        "float",
			"AutoNuke":             "float",
			"Cheats":               "bool",
			"AllowSackKerbals":     "bool",
			"ConsoleIdentifier":    "text",
			"GameDifficulty":       "enum:Easy,Normal,Moderate,Hard,Custom",
			"GameMode":             "enum:Sandbox,Career,Science",
			"ModControl":           "bool",
			"NumberOfAsteroids":    "int",
			"NumberOfComets":       "int",
			"TerrainQuality":       "enum:Low,Default,High,Ignore",
			"SafetyBubbleDistance": "float",
			"MaxVesselParts":       "int",
		}
	case "/LMPServer/Config/MasterServerSettings.xml":
		return "MasterServerSettingsDefinition", map[string]string{
			"RegisterWithMasterServer":           "bool",
			"MasterServerRegistrationMsInterval": "int",
		}
	case "/LMPServer/Config/WebsiteSettings.xml":
		return "WebsiteSettingsDefinition", map[string]string{
			"EnableWebsite":     "bool",
			"ListenAddress":     "readonly",
			"Port":              "readonly",
			"RefreshIntervalMs": "int",
		}
	case "/LMPServer/Config/ConnectionSettings.xml":
		return "ConnectionSettingsDefinition", map[string]string{
			"ListenAddress":           "readonly",
			"Port":                    "readonly",
			"HearbeatMsInterval":      "int",
			"ConnectionMsTimeout":     "int",
			"Upnp":                    "readonly",
			"UpnpMsTimeout":           "int",
			"MaximumTransmissionUnit": "int",
			"AutoExpandMtu":           "bool",
		}
	case "/LMPServer/Config/GameplaySettings.xml":
		return "GameplaySettingsDefinition", map[string]string{
			"CanRevert":                        "bool",
			"MissingCrewsRespawn":              "bool",
			"RespawnTime":                      "float",
			"AutoHireCrews":                    "bool",
			"BypassEntryPurchaseAfterResearch": "bool",
			"IndestructibleFacilities":         "bool",
			"AllowStockVessels":                "bool",
			"AllowOtherLaunchSites":            "bool",
			"ReentryHeatScale":                 "float",
			"ResourceAbundance":                "float",
			"CommNetwork":                      "bool",
			"StartingFunds":                    "float",
			"StartingScience":                  "float",
			"StartingReputation":               "float",
			"ScienceGainMultiplier":            "float",
			"FundsGainMultiplier":              "float",
			"RepGainMultiplier":                "float",
			"FundsLossMultiplier":              "float",
			"RepLossMultiplier":                "float",
			"RepLossDeclined":                  "float",
			"KerbalExp":                        "bool",
			"ImmediateLevelUp":                 "bool",
			"AllowNegativeCurrency":            "bool",
			"PressurePartLimits":               "bool",
			"GPartLimits":                      "bool",
			"GKerbalLimits":                    "bool",
			"KerbalGToleranceMult":             "float",
			"ObeyCrossfeedRules":               "bool",
			"ActionGroupsAlways":               "bool",
			"BuildingDamageMultiplier":         "float",
			"PartUpgrades":                     "bool",
			"RequireSignalForControl":          "bool",
			"ReentryBlackout":                  "bool",
			"RangeModifier":                    "float",
			"DsnModifier":                      "float",
			"OcclusionModifierVac":             "float",
			"OcclusionModifierAtm":             "float",
			"ExtraGroundstations":              "bool",
			"EnableFullSASInSandbox":           "bool",
		}
	case "/LMPServer/Config/WarpSettings.xml":
		return "WarpSettingsDefinition", map[string]string{
			"WarpMode": "enum:None,Subspace",
		}
	case "/LMPServer/Config/LogSettings.xml":
		return "LogSettingsDefinition", map[string]string{
			"LogLevel":        "enum:Normal,Debug,NetworkDebug,VerboseNetworkDebug",
			"ExpireLogs":      "int",
			"UseUtcTimeInLog": "bool",
		}
	case "/LMPServer/Config/ScreenshotSettings.xml":
		return "ScreenshotSettingsDefinition", map[string]string{
			"MinScreenshotIntervalMs": "int",
			"MaxScreenshotWidth":      "int",
			"MaxScreenshotHeight":     "int",
			"MaxScreenshotsPerUser":   "int",
			"MaxScreenshotsFolders":   "int",
		}
	case "/LMPServer/Config/IntervalSettings.xml":
		return "IntervalSettingsDefinition", map[string]string{
			"VesselUpdatesMsInterval":          "int",
			"SecondaryVesselUpdatesMsInterval": "int",
			"SendReceiveThreadTickMs":          "int",
			"MainTimeTick":                     "int",
			"BackupIntervalMs":                 "int",
			"GcMinutesInterval":                "int",
			"MemoryDiagnosticsMinutesInterval": "int",
		}
	}
	return "", nil
}
func parseKspLMPSettings(file string, data []byte) (gameSettingsParsed, error) {
	invalid := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("Invalid or ambiguous LMP XML.")
	}
	if len(data) > 1<<20 || !utf8.Valid(data) {
		return invalid()
	}
	root, kinds := kspLMPSchema(file)
	if root == "" {
		return invalid()
	}
	source := append([]byte(nil), data...)
	base := 0
	if bytes.HasPrefix(source, []byte{239, 187, 191}) {
		base = 3
	}
	d := xml.NewDecoder(bytes.NewReader(source[base:]))
	type span struct {
		start, end int
		value      string
		nested     bool
	}
	spans := map[string]span{}
	seen := map[string]bool{}
	depth, roots := 0, 0
	key := ""
	for {
		before := base + int(d.InputOffset())
		tok, err := d.Token()
		after := base + int(d.InputOffset())
		if err == io.EOF {
			break
		}
		if err != nil {
			return invalid()
		}
		switch v := tok.(type) {
		case xml.Directive:
			return invalid()
		case xml.ProcInst:
			if v.Target != "xml" || before != base {
				return invalid()
			}
		case xml.StartElement:
			depth++
			if v.Name.Space != "" || len(v.Attr) != 0 || depth > 2 {
				return invalid()
			}
			if depth == 1 {
				roots++
				if roots != 1 || v.Name.Local != root || v.Name.Space != "" {
					return invalid()
				}
			}
			if depth == 2 {
				key = v.Name.Local
				for known := range kinds {
					if strings.EqualFold(key, known) && key != known {
						return invalid()
					}
				}
				for _, known := range []string{"Password", "AdminPassword"} {
					if strings.EqualFold(key, known) && key != known {
						return invalid()
					}
				}

				fold := strings.ToLower(key)
				if seen[fold] || v.Name.Space != "" || len(v.Attr) != 0 {
					return invalid()
				}
				seen[fold] = true
				spans[key] = span{start: after, end: after}
			}
			if depth > 2 {
				s := spans[key]
				s.nested = true
				spans[key] = s
			}
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(v)) != "" {
				return invalid()
			}
			if depth == 2 {
				s := spans[key]
				s.value += string(v)
				spans[key] = s
			}
		case xml.Comment:
			if depth == 2 {
				s := spans[key]
				s.nested = true
				spans[key] = s
			}
		case xml.EndElement:
			if depth == 2 {
				s := spans[key]
				s.end = before
				spans[key] = s
			}
			depth--
		}
	}
	if depth != 0 || roots != 1 {
		return invalid()
	}
	out := gameSettingsParsed{fields: []gameSetting{}}
	valid := func(k, v string) bool { return kspLMPValid(kinds[k], v) }
	for key := range spans {
		for known := range kinds {
			if strings.EqualFold(key, known) && key != known {
				return invalid()
			}
		}
	}
	keys := []string{}
	for k := range kinds {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		s, ok := spans[k]
		if !ok {
			continue
		}
		if s.nested || s.end < s.start {
			return invalid()
		}
		if kinds[k] != "readonly" && !valid(k, s.value) {
			return invalid()
		}
		out.fields = append(out.fields, gameSetting{key: k, value: s.value, kind: kspLMPKind(kinds[k]), on: "true", off: "false"})
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		keys := []string{}
		for k, v := range changes {
			s, ok := spans[k]
			if !ok || s.nested || kinds[k] == "readonly" || !valid(k, v) {
				return nil, bad("Unsupported LMP edit.")
			}
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return spans[keys[i]].start > spans[keys[j]].start })
		result := append([]byte(nil), source...)
		for _, k := range keys {
			if changes[k] == spans[k].value {
				continue
			}
			var b bytes.Buffer
			if xml.EscapeText(&b, []byte(changes[k])) != nil {
				return nil, bad("Invalid XML text.")
			}
			s := spans[k]
			result = append(append(append([]byte(nil), result[:s.start]...), b.Bytes()...), result[s.end:]...)
		}
		if len(keys) > 0 {
			if _, err := parseKspLMPSettings(file, result); err != nil {
				return nil, err
			}
		}
		return result, nil
	}
	return out, nil
}
