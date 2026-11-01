package panel

// Arc7445105cd2 Settings.java, the dependency pinned by Mindustryv160.7.
// Only source-defined server scalars are exposed. Player/admin/mod UBJSON and
// unknown rows stay opaque; edits replace the target value's original span.
import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"io"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const mindustrySettingsPath = "/config/settings.bin"

func mindustrySettingsDocument(egg M, file string) bool {
	return file == mindustrySettingsPath && str(egg["startup"]) == "exec bash .voltra/mindustry-native-start.sh" && nativeSettingsIsRecipe(egg, "mindustry/egg-mindustry.json")
}

func mindustrySettingsManaged(egg M, file, key string) bool {
	return mindustrySettingsDocument(egg, file) && mindustrySettingManaged(key)
}

var mindustryScalarKinds = map[string]byte{
	"servername": 4, "desc": 4, "playerlimit": 1, "port": 1, "autoUpdate": 0,
	"showConnectMessages": 0, "enableVotekick": 0, "startCommands": 4, "logging": 0, "strict": 0, "antiSpam": 0,
	"interactRateWindow": 1, "interactRateLimit": 1, "interactRateKick": 1, "messageRateLimit": 1, "messageSpamKick": 1,
	"packetSpamLimit": 1, "uuidChangeLimit": 1, "uuidChangeTimePeriod": 1, "chatSpamLimit": 1, "socket": 0,
	"socketInputPort": 1, "socketInputAddress": 4, "allow-custom": 0, "whitelist": 0, "motd": 4, "autosave": 0,
	"autosaveAmount": 1, "autosaveSpacing": 1, "debug": 0, "snapshotInterval": 1, "autoPause": 0, "roundExtraTime": 1,
	"maxLogLength": 1, "logCommands": 0,
}

func mindustrySettingManaged(key string) bool {
	switch key {
	case "port", "autoUpdate":
		return true
	}
	return false
}

func mindustrySettingHeld(key string) bool {
	if mindustrySettingManaged(key) {
		return true
	}
	switch key {
	case "socket", "socketInputPort", "socketInputAddress", "startCommands":
		return true
	}
	return false
}

type mindustrySpan struct {
	kind       byte
	start, end int
}

func mindustryUTF(data []byte, offset *int) (string, error) {
	if *offset+2 > len(data) {
		return "", bad("Truncated Mindustry string.")
	}
	length := int(binary.BigEndian.Uint16(data[*offset:]))
	*offset += 2
	if length > len(data)-*offset {
		return "", bad("Truncated Mindustry string.")
	}
	raw := data[*offset : *offset+length]
	*offset += length
	units := []uint16{}
	for i := 0; i < len(raw); {
		b := raw[i]
		var unit uint16
		switch {
		case b > 0 && b < 0x80:
			unit = uint16(b)
			i++
		case b&0xe0 == 0xc0:
			if i+1 >= len(raw) || raw[i+1]&0xc0 != 0x80 {
				return "", bad("Invalid modified UTF-8.")
			}
			unit = uint16(b&31)<<6 | uint16(raw[i+1]&63)
			if unit < 128 && unit != 0 {
				return "", bad("Overlong modified UTF-8.")
			}
			if unit == 0 && (b != 0xc0 || raw[i+1] != 0x80) {
				return "", bad("Invalid modified UTF-8.")
			}
			i += 2
		case b&0xf0 == 0xe0:
			if i+2 >= len(raw) || raw[i+1]&0xc0 != 0x80 || raw[i+2]&0xc0 != 0x80 {
				return "", bad("Invalid modified UTF-8.")
			}
			unit = uint16(b&15)<<12 | uint16(raw[i+1]&63)<<6 | uint16(raw[i+2]&63)
			if unit < 2048 {
				return "", bad("Overlong modified UTF-8.")
			}
			i += 3
		default:
			return "", bad("Invalid modified UTF-8.")
		}
		units = append(units, unit)
	}
	for i := 0; i < len(units); i++ {
		if units[i] >= 0xd800 && units[i] <= 0xdbff {
			if i+1 >= len(units) || units[i+1] < 0xdc00 || units[i+1] > 0xdfff {
				return "", bad("Unpaired Mindustry UTF-16 surrogate.")
			}
			i++
		} else if units[i] >= 0xdc00 && units[i] <= 0xdfff {
			return "", bad("Unpaired Mindustry UTF-16 surrogate.")
		}
	}
	return string(utf16.Decode(units)), nil
}

func mindustryEncodeUTF(value string) ([]byte, error) {
	if !utf8.ValidString(value) {
		return nil, bad("Enter valid Unicode text.")
	}
	raw := []byte{}
	for _, u := range utf16.Encode([]rune(value)) {
		switch {
		case u > 0 && u < 128:
			raw = append(raw, byte(u))
		case u < 2048:
			raw = append(raw, 0xc0|byte(u>>6), 0x80|byte(u&63))
		default:
			raw = append(raw, 0xe0|byte(u>>12), 0x80|byte((u>>6)&63), 0x80|byte(u&63))
		}
	}
	if len(raw) > 65535 {
		return nil, bad("The native Mindustry string is too long.")
	}
	out := make([]byte, 2, len(raw)+2)
	binary.BigEndian.PutUint16(out, uint16(len(raw)))
	return append(out, raw...), nil
}

func parseMindustrySettings(data []byte) (gameSettingsParsed, error) {
	out := gameSettingsParsed{}
	original := append([]byte(nil), data...)
	raw := data
	compressed := false
	if len(data) > 8<<20 {
		return out, bad("Mindustry settings exceed the safe editor size.")
	}
	if len(data) >= 2 && data[0] == 0x78 && (data[1] == 1 || data[1] == 0x5e || data[1] == 0x9c || data[1] == 0xda) {
		compressed = true
		input := bytes.NewReader(data)
		reader, err := zlib.NewReader(input)
		if err != nil {
			return out, bad("Invalid compressed Mindustry settings.")
		}
		raw, err = io.ReadAll(io.LimitReader(reader, (8<<20)+1))
		closeErr := reader.Close()
		if err != nil || closeErr != nil || len(raw) > 8<<20 || input.Len() != 0 {
			return out, bad("Invalid or oversized compressed Mindustry settings.")
		}
	}
	if len(raw) < 4 {
		return out, bad("Truncated Mindustry settings.")
	}
	count := int32(binary.BigEndian.Uint32(raw))
	if count < 1 || count > 65536 {
		return out, bad("Invalid Mindustry row count.")
	}
	offset := 4
	rows := map[string]mindustrySpan{}
	seen := map[string]bool{}
	fields := map[string]gameSetting{}
	for i := int32(0); i < count; i++ {
		key, err := mindustryUTF(raw, &offset)
		if err != nil {
			return out, err
		}
		folded := strings.ToLower(key)
		if seen[folded] {
			return out, bad("Duplicate or case-ambiguous Mindustry keys cannot be edited.")
		}
		seen[folded] = true
		if offset >= len(raw) {
			return out, bad("Truncated Mindustry value.")
		}
		kind := raw[offset]
		offset++
		start := offset
		value := ""
		take := func(n int) bool {
			if n < 0 || n > len(raw)-offset {
				return false
			}
			offset += n
			return true
		}
		switch kind {
		case 0:
			if !take(1) || raw[start] > 1 {
				return out, bad("Invalid native boolean.")
			}
			value = strconv.FormatBool(raw[start] == 1)
		case 1:
			if !take(4) {
				return out, bad("Truncated native integer.")
			}
			value = strconv.FormatInt(int64(int32(binary.BigEndian.Uint32(raw[start:]))), 10)
		case 2:
			if !take(8) {
				return out, bad("Truncated native integer.")
			}
		case 3:
			if !take(4) {
				return out, bad("Truncated native float.")
			}
		case 4:
			value, err = mindustryUTF(raw, &offset)
			if err != nil {
				return out, err
			}
		case 5:
			if !take(4) {
				return out, bad("Truncated native binary row.")
			}
			length := int64(int32(binary.BigEndian.Uint32(raw[start:])))
			if length < 0 || length > int64(len(raw)-offset) || !take(int(length)) {
				return out, bad("Invalid native binary length.")
			}
		default:
			return out, bad("Unknown native Mindustry value type.")
		}
		rows[key] = mindustrySpan{kind, start, offset}
		expected, known := mindustryScalarKinds[key]
		if !known {
			continue
		}
		if kind != expected {
			return out, bad("A known Mindustry setting has the wrong native type.")
		}
		field := gameSetting{key: key, value: value, kind: "text"}
		if kind == 0 {
			field.kind, field.on, field.off = "boolean", "true", "false"
		} else if kind == 1 {
			field.kind = "number"
		}
		// Root's scoped managed predicate supplies readonly metadata while keeping
		// the native type, so existing UI labels these fields as Managed.
		if mindustrySettingHeld(key) && !mindustrySettingManaged(key) {
			field.kind = "readonly"
		}
		// Startup commands can contain plugin credentials; do not display them.
		if key == "startCommands" {
			field.secret = true
		}
		fields[key] = field
		out.fields = append(out.fields, field)
	}
	if offset != len(raw) {
		return out, bad("Trailing Mindustry settings data.")
	}
	sort.Slice(out.fields, func(i, j int) bool { return out.fields[i].key < out.fields[j].key })
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			span mindustrySpan
			data []byte
		}
		edits := []edit{}
		for key, value := range changes {
			_, known := fields[key]
			if !known || mindustrySettingHeld(key) {
				return nil, bad("This Mindustry setting cannot be changed here.")
			}
			span := rows[key]
			var replacement []byte
			switch span.kind {
			case 0:
				if value != "true" && value != "false" {
					return nil, bad("Choose a boolean value.")
				}
				replacement = []byte{0}
				if value == "true" {
					replacement[0] = 1
				}
			case 1:
				n, err := strconv.ParseInt(value, 10, 32)
				if err != nil {
					return nil, bad("Enter a native 32-bit whole number.")
				}
				if key == "playerlimit" && n < 0 || key == "autosaveSpacing" && n < 1 {
					return nil, bad("Use a nonnegative player limit or a positive autosave interval.")
				}
				replacement = make([]byte, 4)
				binary.BigEndian.PutUint32(replacement, uint32(int32(n)))
			case 4:
				if strings.ContainsRune(value, 0) || strings.ContainsAny(value, "\r\x1b") || key != "motd" && strings.Contains(value, "\n") {
					return nil, bad("Enter literal text without control characters.")
				}
				if (key == "servername" || key == "desc") && utf8.RuneCountInString(value) > 100 {
					return nil, bad("Use at most 100 characters.")
				}
				var err error
				replacement, err = mindustryEncodeUTF(value)
				if err != nil {
					return nil, err
				}
			default:
				return nil, bad("This native type is not editable.")
			}
			if !bytes.Equal(raw[span.start:span.end], replacement) {
				edits = append(edits, edit{span, replacement})
			}
		}
		if len(edits) == 0 {
			return append([]byte(nil), original...), nil
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].span.start > edits[j].span.start })
		result := append([]byte(nil), raw...)
		for _, edit := range edits {
			result = append(append(append([]byte(nil), result[:edit.span.start]...), edit.data...), result[edit.span.end:]...)
		}
		if _, err := parseMindustrySettings(result); err != nil {
			return nil, err
		}
		if !compressed {
			return result, nil
		}
		var buffer bytes.Buffer
		writer := zlib.NewWriter(&buffer)
		if _, err := writer.Write(result); err != nil {
			return nil, err
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
		return buffer.Bytes(), nil
	}
	return out, nil
}
