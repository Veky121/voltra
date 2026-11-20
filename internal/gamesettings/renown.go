package gamesettings

import "strings"

const RenownSettingsDirectory = "/Renown_Combat/Saved/Config/LinuxServer/"

// Root dispatches only the exact recipe and these two native documents here.
// Unknown native scalars retain the shared parser's conservative behavior.
func parseRenownSettings(file string, data []byte) (Parsed, error) {
	if file != RenownSettingsDirectory+"Game.ini" && file != RenownSettingsDirectory+"Engine.ini" {
		return Parsed{}, bad("Unsupported Renown settings path.")
	}
	parsed, err := Parse(file, data)
	if err != nil {
		return parsed, err
	}
	writable := map[string]bool{}
	for i := range parsed.Fields {
		f := &parsed.Fields[i]
		// The launcher supplies RCONPort independently of the native file.
		if strings.EqualFold(f.Key[strings.LastIndex(f.Key, "/")+1:], "RCONPort") {
			f.Kind = "readonly"
		}
		writable[f.Key] = f.Kind != "readonly"
	}
	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		for key := range changes {
			if !writable[key] {
				return nil, bad("This setting is owned by the launcher or is ambiguous.")
			}
		}
		return patch(changes)
	}
	return expandGameSettingsStructs(parsed)
}
