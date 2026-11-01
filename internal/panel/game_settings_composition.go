package panel

import "bytes"

// Each parser owns disjoint fields. Validate every partition before staging,
// then reparse after earlier edits so byte spans cannot drift across helpers.
func composeGameSettings(data []byte, parsers ...func([]byte) (gameSettingsParsed, error)) (gameSettingsParsed, error) {
	combined := gameSettingsParsed{}
	owners := map[string]int{}
	initial := make([]gameSettingsParsed, len(parsers))
	for index, parse := range parsers {
		parsed, err := parse(data)
		if err != nil {
			return gameSettingsParsed{}, err
		}
		initial[index] = parsed
		for _, field := range parsed.fields {
			if _, exists := owners[field.key]; exists {
				return gameSettingsParsed{}, bad("Ambiguous configuration field ownership.")
			}
			owners[field.key] = index
			combined.fields = append(combined.fields, field)
		}
	}
	original := append([]byte(nil), data...)
	combined.patch = func(changes map[string]string) ([]byte, error) {
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
			if initial[index].patch == nil {
				return nil, bad("Configuration is read-only.")
			}
			if _, err := initial[index].patch(partition); err != nil {
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
			if fresh.patch == nil {
				return nil, bad("Configuration is read-only.")
			}
			staged, err = fresh.patch(partition)
			if err != nil {
				return nil, err
			}
		}
		return staged, nil
	}
	return combined, nil
}

func parseCompleteSonsSettings(data []byte) (gameSettingsParsed, error) {
	return composeGameSettings(data, parseSonsSettings, parseSonsGameplaySettings)
}

func parseCompleteResoniteSettings(data []byte) (gameSettingsParsed, error) {
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
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		updated, err := patch(changes)
		if err != nil {
			return nil, err
		}
		return append(append([]byte(nil), prefix...), updated...), nil
	}
	return parsed, nil
}
