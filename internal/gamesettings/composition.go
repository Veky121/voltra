package gamesettings

import "bytes"

// Each parser owns disjoint fields. Validate every partition before staging,
// then reparse after earlier edits so byte spans cannot drift across helpers.
func composeGameSettings(data []byte, parsers ...func([]byte) (Parsed, error)) (Parsed, error) {
	combined := Parsed{}
	owners := map[string]int{}
	initial := make([]Parsed, len(parsers))
	for index, parse := range parsers {
		parsed, err := parse(data)
		if err != nil {
			return Parsed{}, err
		}
		initial[index] = parsed
		for _, field := range parsed.Fields {
			if _, exists := owners[field.Key]; exists {
				return Parsed{}, bad("Ambiguous configuration field ownership.")
			}
			owners[field.Key] = index
			combined.Fields = append(combined.Fields, field)
		}
	}
	original := append([]byte(nil), data...)
	combined.Patch = func(changes map[string]string) ([]byte, error) {
		partitions := make([]map[string]string, len(parsers))
		for key, value := range changes {
			index, ok := owners[key]
			if !ok {
				return nil, bad("Unsupported configuration setting.")
			}
			if partitions[index] == nil {
				partitions[index] = map[string]string{}
			}
			partitions[index][key] = value
		}
		for index, partition := range partitions {
			if len(partition) == 0 {
				continue
			}
			if initial[index].Patch == nil {
				return nil, bad("Configuration is read-only.")
			}
			if _, err := initial[index].Patch(partition); err != nil {
				return nil, err
			}
		}
		staged := append([]byte(nil), original...)
		for index, partition := range partitions {
			if len(partition) == 0 {
				continue
			}
			fresh, err := parsers[index](staged)
			if err != nil {
				return nil, err
			}
			if fresh.Patch == nil {
				return nil, bad("Configuration is read-only.")
			}
			staged, err = fresh.Patch(partition)
			if err != nil {
				return nil, err
			}
		}
		return staged, nil
	}
	return combined, nil
}

func parseCompleteSonsSettings(data []byte) (Parsed, error) {
	return composeGameSettings(data, ParseSonsSettings, ParseSonsGameplaySettings)
}

func parseCompleteResoniteSettings(data []byte) (Parsed, error) {
	prefix := []byte(nil)
	body := data
	if bytes.HasPrefix(body, []byte{0xef, 0xbb, 0xbf}) {
		prefix = append(prefix, body[:3]...)
		body = body[3:]
	}
	parsed, err := composeGameSettings(body, parseResoniteSettings, parseResoniteSessionSettings)
	if err != nil {
		return parsed, err
	}
	patch := parsed.Patch
	parsed.Patch = func(changes map[string]string) ([]byte, error) {
		updated, err := patch(changes)
		if err != nil {
			return nil, err
		}
		return append(append([]byte(nil), prefix...), updated...), nil
	}
	return parsed, nil
}
