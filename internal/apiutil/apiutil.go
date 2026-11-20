// Package apiutil holds the JSON API primitives that package panel and the
// subsystem packages it serves (such as gamesettings) must share: one error
// type, so panel's error writer recognises errors from every package, and the
// value coercions the handlers use on decoded rows and request bodies.
//
// panel and gamesettings call these through short lower-case names (bad, str,
// num and so on); this file is the only implementation.
package apiutil

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

type M = map[string]any

// APIError is the structured error every handler writes. panel aliases it as
// panel.APIError.
type APIError struct {
	Status       int
	Code, Detail string
}

func (e APIError) Error() string { return e.Detail }

func Bad(detail string) error { return APIError{422, "ValidationException", detail} }
func Forbidden() error {
	return APIError{403, "ForbiddenException", "You do not have permission to perform this action."}
}
func NotFound() error {
	return APIError{404, "NotFoundException", "The requested resource was not found."}
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func Item(object string, attributes M) M { return M{"object": object, "attributes": attributes} }

// DecodeRaw reads one JSON object of at most 4 MiB, keeping numbers as
// json.Number.
func DecodeRaw(r *http.Request) (M, error) {
	var m M
	dec := json.NewDecoder(io.LimitReader(r.Body, 4<<20+1))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, Bad("A valid JSON object is required.")
	}
	if m == nil {
		return nil, Bad("A JSON object is required.")
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, Bad("Only one JSON object is allowed.")
	}
	return m, nil
}

func Num(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int32:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}

func Str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func Boolean(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return b == "true" || b == "1"
	default:
		return Num(v) != 0
	}
}

func AsMap(v any) M {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return M{}
}

func AsSlice(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	if a, ok := v.([]string); ok {
		r := make([]any, len(a))
		for i, s := range a {
			r[i] = s
		}
		return r
	}
	return []any{}
}
