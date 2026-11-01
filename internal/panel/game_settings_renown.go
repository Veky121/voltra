package panel

import "strings"

const renownSettingsDirectory = "/Renown_Combat/Saved/Config/LinuxServer/"

// Root dispatches only the exact recipe and these two native documents here.
// Unknown native scalars retain the shared parser's conservative behavior.
func parseRenownSettings(file string, data []byte) (gameSettingsParsed, error) {
	if file != renownSettingsDirectory+"Game.ini" && file != renownSettingsDirectory+"Engine.ini" {
		return gameSettingsParsed{}, bad("Unsupported Renown settings path.")
	}
	parsed, err := parseGameSettings(file, data)
	if err != nil {
		return parsed, err
	}
	writable := map[string]bool{}
	for i := range parsed.fields {
		f := &parsed.fields[i]
		// The launcher supplies RCONPort independently of the native file.
		if strings.EqualFold(f.key[strings.LastIndex(f.key, "/")+1:], "RCONPort") {
			f.kind = "readonly"
		}
		writable[f.key] = f.kind != "readonly"
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if !writable[key] {
				return nil, bad("This setting is owned by the launcher or is ambiguous.")
			}
		}
		return patch(changes)
	}
	return expandGameSettingsStructs(parsed)
}
