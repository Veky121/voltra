package nodeagent

import (
	"net/http/httptest"
	"strings"
	"testing"
	"voltra/internal/steamexec"
)

type fakeRuntime struct {
	calls int
	err   error
}

func (f *fakeRuntime) ClientStatus() steamexec.ClientStatus {
	return steamexec.ClientStatus{Scope: "metadata", Supported: true}
}
func (f *fakeRuntime) RequestClientCheck() error    { f.calls++; return f.err }
func (f *fakeRuntime) SetClientSchedule(bool) error { f.calls++; return f.err }
func TestRuntimeMaintenanceRequestValidation(t *testing.T) {
	for _, tc := range []struct {
		method, path, body string
		code, calls        int
	}{
		{"GET", "/steamcmd", "", 200, 0}, {"POST", "/steamcmd/check", "{}", 202, 1}, {"POST", "/steamcmd/check", "", 202, 1},
		{"POST", "/steamcmd/check", `{"path":"/etc"}`, 400, 0}, {"POST", "/steamcmd/check", "{} {}", 400, 0},
		{"GET", "/steamcmd?path=/etc", "", 400, 0}, {"POST", "/steamcmd/other", "", 404, 0},
		{"POST", "/steamcmd/schedule", `{"enabled":false}`, 200, 1},
		{"POST", "/steamcmd/schedule", `{}`, 400, 0},
		{"POST", "/steamcmd/schedule", `{"enabled":null}`, 400, 0},
		{"POST", "/steamcmd/schedule", `{"enabled":true,"path":"/etc"}`, 400, 0},
	} {
		f := &fakeRuntime{}
		w := httptest.NewRecorder()
		runtimeHandler(f).ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
		if w.Code != tc.code || f.calls != tc.calls {
			t.Fatalf("%#v: %d calls %d", tc, w.Code, f.calls)
		}
	}
	f := &fakeRuntime{err: steamexec.ErrClientBusy}
	w := httptest.NewRecorder()
	runtimeHandler(f).ServeHTTP(w, httptest.NewRequest("POST", "/steamcmd/check", strings.NewReader("{}")))
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
}
