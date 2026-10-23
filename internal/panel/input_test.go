package panel

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeInputNormalizationAndRawDocuments(t *testing.T) {
	const body = `{"name":"  example\n","environment":{"PORT":"  25565 ","EMPTY":"  ","UNICODE":"\u200bvalue\ufeff"},"password":" spaced ","nested":{"password":" trim "},"values":[" a ","",false,0]}`
	request := httptest.NewRequest("POST", "/api/application/servers?name=%20example%20&password=%20spaced%20", strings.NewReader(body))
	data, err := decode(request)
	if err != nil {
		t.Fatal(err)
	}
	if data["name"] != "example" || data["password"] != " spaced " || asMap(data["nested"])["password"] != "trim" {
		t.Fatalf("field normalization mismatch: %#v", data)
	}
	env := asMap(data["environment"])
	if env["PORT"] != "25565" || env["EMPTY"] != nil || env["UNICODE"] != "value" {
		t.Fatalf("environment normalization mismatch: %#v", env)
	}
	values := asSlice(data["values"])
	if values[0] != "a" || values[1] != nil || values[2] != false || num(values[3]) != 0 {
		t.Fatalf("typed values changed: %#v", values)
	}
	normalizeQuery(request)
	if request.URL.Query().Get("name") != "example" || request.URL.Query().Get("password") != " spaced " {
		t.Fatal("query normalization mismatch")
	}
	raw, err := decodeRaw(httptest.NewRequest("POST", "/api/admin/eggs/import", strings.NewReader(body)))
	if err != nil || raw["name"] != "  example\n" || asMap(raw["environment"])["EMPTY"] != "  " {
		t.Fatal("raw document bytes were normalized")
	}
}
