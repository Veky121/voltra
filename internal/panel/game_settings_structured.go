package panel

import (
	"sort"
	"strconv"
	"strings"
)

// Expand Unreal-style named structs independently of the game or filename.
// Each child patches its original value span, preserving unknown members.
func expandGameSettingsStructs(parsed gameSettingsParsed) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	type member struct {
		start, end int
		quoted     bool
	}
	type record struct {
		raw     string
		members map[string]member
	}
	records := map[string]record{}
	for _, field := range parsed.fields {
		raw := field.value
		if !field.structured {
			out.fields = append(out.fields, field)
			continue
		}
		segments, err := quickSplitTuple(raw[1 : len(raw)-1])
		if err != nil {
			return out, err
		}
		r := record{raw: raw, members: map[string]member{}}
		offset := 1
		fields := []gameSetting{}
		for _, segment := range segments {
			name, value, ok := strings.Cut(segment, "=")
			name = strings.TrimSpace(name)
			if !ok || name == "" || strings.ContainsAny(name, "/(),\" \t") {
				fields = nil
				break
			}
			key := field.key + "/" + name
			if _, duplicate := r.members[key]; duplicate {
				return out, bad("Duplicate structured settings cannot be edited here.")
			}
			start := offset + strings.IndexByte(segment, '=') + 1
			start += len(value) - len(strings.TrimLeft(value, " \t"))
			value = strings.TrimSpace(value)
			f := gameSettingType(key, value)
			quoted := strings.HasPrefix(value, "\"")
			if quoted {
				decoded, err := strconv.Unquote(value)
				if err != nil {
					return out, bad("Invalid quoted structured setting.")
				}
				f.value, f.kind = decoded, "text"
			} else if strings.HasPrefix(value, "(") {
				f.kind = "readonly"
			}
			fields = append(fields, f)
			r.members[key] = member{start, start + len(value), quoted}
			offset += len(segment) + 1
		}
		if len(fields) == 0 {
			field.kind = "readonly"
			out.fields = append(out.fields, field)
			continue
		}
		out.fields = append(out.fields, fields...)
		records[field.key] = r
	}
	if len(out.fields) > 4000 {
		return out, bad("This configuration has too many settings to edit here.")
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		patch := map[string]string{}
		for key, value := range changes {
			patch[key] = value
		}
		for parent, r := range records {
			type edit struct {
				start, end int
				value      string
			}
			edits := []edit{}
			for key, span := range r.members {
				value, ok := changes[key]
				if !ok {
					continue
				}
				if span.quoted {
					value = quickUnrealQuote(value)
				} else if strings.TrimSpace(value) == "" || strings.ContainsAny(value, ",()\r\n\";#") {
					return nil, bad("Enter a scalar value for this setting.")
				}
				edits = append(edits, edit{span.start, span.end, value})
				delete(patch, key)
			}
			if len(edits) == 0 {
				continue
			}
			sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
			value := r.raw
			for _, e := range edits {
				value = value[:e.start] + e.value + value[e.end:]
			}
			patch[parent] = value
		}
		return parsed.patch(patch)
	}
	return out, nil
}
