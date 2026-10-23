package panel

import (
	"net/http"
	"strconv"
	"strings"
	"unicode"
)

// Laravel's Str::trim removes these invisible characters in addition to space.
const inputInvisible = "\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200c\u200d\u200e\u200f\u2060\u2061\u2062\u2063\u2064\u2065\u206a\u206b\u206c\u206d\u206e\u206f\u2800\u3164\ufeff\uffa0\U0001d159\U0001d173\U0001d174\U0001d175\U0001d176\U0001d177\U0001d178\U0001d179\U0001d17a\U000e0020"

func trimInput(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return r == 0 || unicode.IsSpace(r) || strings.ContainsRune(inputInvisible, r) })
}

// Native TrimStrings and ConvertEmptyStringsToNull run before JSON validation.
// Imported PTDL files use decodeRaw, and file content/upload bytes bypass JSON.
func normalizeInput(value any, path string) any {
	switch v := value.(type) {
	case string:
		if path != "password" && path != "password_confirmation" {
			v = trimInput(v)
		}
		if v == "" {
			return nil
		}
		return v
	case map[string]any:
		for k, x := range v {
			key := k
			if path != "" {
				key = path + "." + k
			}
			v[k] = normalizeInput(x, key)
		}
		return v
	case []any:
		for i, x := range v {
			v[i] = normalizeInput(x, path+"."+strconv.Itoa(i))
		}
		return v
	default:
		return value
	}
}

func normalizeQuery(r *http.Request) {
	if r.URL.RawQuery == "" {
		return
	}
	query := r.URL.Query()
	for key, values := range query {
		if key == "password" || key == "password_confirmation" {
			continue
		}
		for i, value := range values {
			values[i] = trimInput(value)
		}
	}
	r.URL.RawQuery = query.Encode()
}
