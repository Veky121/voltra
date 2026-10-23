package panel

import (
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Keep missing roots compatible with the established Go API default of /.
// Explicit non-string roots must not be coerced into filesystem paths.
func validateOriginalFileRequest(op string, d M) error {
	for _, key := range []string{"root", "directory", "filename"} {
		if value, exists := d[key]; exists && value != nil {
			if _, ok := value.(string); !ok {
				return bad(key + " must be a string or null")
			}
		}
	}
	requiredString := func(m M, key string) error {
		value, ok := m[key].(string)
		if !ok || strings.TrimSpace(value) == "" {
			return bad(key + " must be a non-empty string")
		}
		return nil
	}
	switch op {
	case "copy":
		return requiredString(d, "location")
	case "create-folder":
		return requiredString(d, "name")
	case "decompress":
		return requiredString(d, "file")
	case "pull":
		if err := requiredString(d, "url"); err != nil {
			return err
		}
		u, err := url.Parse(d["url"].(string))
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return bad("url must be an HTTP or HTTPS URL")
		}
		for _, key := range []string{"use_header", "foreground"} {
			if value, exists := d[key]; exists {
				switch value {
				case true, false:
				case 0, int64(0), float64(0), "0":
					d[key] = false
				case 1, int64(1), float64(1), "1":
					d[key] = true
				default:
					return bad(key + " must be a boolean")
				}
			}
		}
	case "rename", "chmod", "compress", "delete":
		files, ok := d["files"].([]any)
		if !ok || len(files) == 0 {
			return bad("files must be a non-empty array")
		}
		for _, value := range files {
			switch op {
			case "rename":
				entry := asMap(value)
				if err := requiredString(entry, "from"); err != nil {
					return err
				}
				if err := requiredString(entry, "to"); err != nil {
					return err
				}
			case "chmod":
				entry := asMap(value)
				if err := requiredString(entry, "file"); err != nil {
					return err
				}
				mode, ok := entry["mode"].(string)
				if !ok {
					// Laravel's numeric rule also accepts JSON numbers. Wings
					// expects an octal string, so normalize integral values.
					switch value := entry["mode"].(type) {
					case float64:
						if value != math.Trunc(value) {
							return bad("mode must be octal")
						}
						mode = strconv.FormatFloat(value, 'f', 0, 64)
					case int:
						mode = strconv.Itoa(value)
					case int64:
						mode = strconv.FormatInt(value, 10)
					default:
						return bad("mode must be octal")
					}
				}
				if _, err := strconv.ParseUint(mode, 8, 12); err != nil {
					return bad("mode must be an octal string")
				}
				entry["mode"] = mode
			default:
				if _, ok := value.(string); !ok {
					return bad("files must contain strings")
				}
			}
		}
	}
	return nil
}

// Original ResourceLimit::FilePull is shared by all users of a server. Store
// its fixed window atomically in PostgreSQL so workers and restarts share it.
func (a *App) allowFilePull(w http.ResponseWriter, r *http.Request, s M) bool {
	var count int64
	var remaining float64
	err := a.DB.QueryRow(r.Context(), `INSERT INTO settings(key,value)
		VALUES($1,jsonb_build_object('count',1,'expires',extract(epoch FROM clock_timestamp())+600))
		ON CONFLICT(key) DO UPDATE SET value=CASE
		WHEN (settings.value->>'expires')::numeric<=extract(epoch FROM clock_timestamp())
		THEN jsonb_build_object('count',1,'expires',extract(epoch FROM clock_timestamp())+600)
		ELSE jsonb_set(settings.value,'{count}',to_jsonb((settings.value->>'count')::bigint+1)) END
		RETURNING (value->>'count')::bigint,GREATEST(0,(value->>'expires')::numeric-extract(epoch FROM clock_timestamp()))`, "rate:file-pull:"+str(s["uuid"])).Scan(&count, &remaining)
	if err != nil {
		fail(w, err)
		return false
	}
	w.Header().Set("X-RateLimit-Limit", "5")
	w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(max(0, 5-count), 10))
	if count > 5 {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(remaining)))))
		fail(w, &APIError{Status: 429, Code: "TooManyRequestsHttpException", Detail: "Only five file pulls may be requested per server within ten minutes"})
		return false
	}
	return true
}
