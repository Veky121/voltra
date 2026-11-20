package apiutil

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestCoercions(t *testing.T) {
	for _, tc := range []struct {
		in      any
		str     string
		num     int64
		boolean bool
	}{
		{nil, "", 0, false},
		{"", "", 0, false},
		{"1", "1", 1, true},
		{"true", "true", 0, true},
		{"x", "x", 0, false},
		{2, "2", 2, true},
		{int32(3), "3", 3, true},
		{int64(4), "4", 4, true},
		{5.9, "5.9", 5, true},
		{json.Number("6"), "6", 6, true},
		{json.Number("7.5"), "7.5", 0, false},
		{true, "true", 0, true},
		{false, "false", 0, false},
	} {
		if got := Str(tc.in); got != tc.str {
			t.Errorf("Str(%#v) = %q", tc.in, got)
		}
		if got := Num(tc.in); got != tc.num {
			t.Errorf("Num(%#v) = %d", tc.in, got)
		}
		if got := Boolean(tc.in); got != tc.boolean {
			t.Errorf("Boolean(%#v) = %v", tc.in, got)
		}
	}
	if !reflect.DeepEqual(AsMap(M{"k": 1}), M{"k": 1}) || !reflect.DeepEqual(AsMap("x"), M{}) {
		t.Error("AsMap")
	}
	if !reflect.DeepEqual(AsSlice([]string{"a"}), []any{"a"}) || !reflect.DeepEqual(AsSlice(1), []any{}) {
		t.Error("AsSlice")
	}
}

func TestErrors(t *testing.T) {
	for _, tc := range []struct {
		err          error
		status       int
		code, detail string
	}{
		{Bad("x"), 422, "ValidationException", "x"},
		{Forbidden(), 403, "ForbiddenException", "You do not have permission to perform this action."},
		{NotFound(), 404, "NotFoundException", "The requested resource was not found."},
	} {
		var api APIError
		if !errors.As(tc.err, &api) || api != (APIError{Status: tc.status, Code: tc.code, Detail: tc.detail}) || tc.err.Error() != tc.detail {
			t.Errorf("%#v", tc.err)
		}
	}
}

func TestDecodeRaw(t *testing.T) {
	for body, want := range map[string]string{
		`{"n":1}`:   "",
		`[]`:        "A valid JSON object is required.",
		`null`:      "A JSON object is required.",
		`{} {}`:     "Only one JSON object is allowed.",
		`{"n":1.5}`: "",
	} {
		m, err := DecodeRaw(httptest.NewRequest("POST", "/", strings.NewReader(body)))
		if want == "" {
			if err != nil || len(m) != 1 {
				t.Errorf("%s: %v %v", body, m, err)
			} else if _, ok := m["n"].(json.Number); !ok {
				t.Errorf("%s: number decoded as %T", body, m["n"])
			}
		} else if err == nil || err.Error() != want {
			t.Errorf("%s: %v", body, err)
		}
	}
}
