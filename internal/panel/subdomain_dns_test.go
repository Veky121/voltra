package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type subdomainTransport func(*http.Request) (*http.Response, error)

func (f subdomainTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type subdomainFake struct {
	mu         sync.Mutex
	records    []M
	writes     int
	failDelete bool
	lostCreate bool
	failList   bool
}

func (f *subdomainFake) client() *http.Client {
	return &http.Client{Transport: subdomainTransport(func(r *http.Request) (*http.Response, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.URL.Host != "api.cloudflare.com" || r.Header.Get("Authorization") != "Bearer fake-token" {
			return nil, errors.New("unexpected provider destination or credentials")
		}
		result := any(M{})
		status := 200
		switch r.Method {
		case "GET":
			if f.failList {
				return nil, errors.New("provider unavailable")
			}
			if !strings.Contains(r.URL.Path, "dns_records") {
				result = M{"name": "example.invalid"}
			} else {
				found := []M{}
				for _, record := range f.records {
					if str(record["name"]) == r.URL.Query().Get("name") {
						found = append(found, record)
					}
				}
				result = found
			}
		case "POST":
			f.writes++
			body := M{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			body["id"] = fmt.Sprintf("%032x", f.writes)
			f.records = append(f.records, body)
			result = body
			if f.lostCreate {
				f.lostCreate = false
				return nil, errors.New("response lost after provider commit")
			}
		case "PUT":
			f.writes++
			body := M{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
			body["id"] = id
			for i, record := range f.records {
				if record["id"] == id {
					f.records[i] = body
				}
			}
			result = body
		case "DELETE":
			if f.failDelete {
				status = 503
				break
			}
			id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
			for i, record := range f.records {
				if record["id"] == id {
					f.records = append(f.records[:i], f.records[i+1:]...)
					break
				}
			}
			f.writes++
		}
		raw, _ := json.Marshal(M{"success": status == 200, "result": result, "result_info": M{"total_pages": 1}})
		return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})}
}
func subdomainTestCredentials(t *testing.T, a *App) string {
	t.Helper()
	raw, _ := json.Marshal(M{"api_token": "fake-token", "zone_id": strings.Repeat("a", 32)})
	encrypted, err := a.seal(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	return encrypted
}
func TestSubdomainProviderLifecycle(t *testing.T) {
	fake := &subdomainFake{}
	a := &App{Config: Config{EncryptionKey: "test-key"}, HTTP: fake.client()}
	job := M{"hostname": "play.friends.example.invalid", "owner": "voltra:test-owner", "desired": true, "credentials": subdomainTestCredentials(t, a)}
	ctx := context.Background()
	fake.lostCreate = true
	if err := a.subdomainApply(ctx, job, "8.8.8.8"); err == nil {
		t.Fatal("lost response reported success")
	}
	if len(fake.records) != 1 {
		t.Fatal("provider did not create record")
	}
	if err := a.subdomainApply(ctx, job, "8.8.8.8"); err != nil {
		t.Fatal(err)
	}
	if len(fake.records) != 1 || fake.writes != 1 {
		t.Fatal("retry duplicated record")
	}
	if fake.records[0]["type"] != "A" || boolean(fake.records[0]["proxied"]) {
		t.Fatal("record was not DNS only")
	}
	if err := a.subdomainApply(ctx, job, "gateway.example.invalid"); err != nil {
		t.Fatal(err)
	}
	if fake.records[0]["type"] != "CNAME" {
		t.Fatal("hostname target did not produce CNAME")
	}
	fake.records = append(fake.records, M{"id": strings.Repeat("f", 32), "name": job["hostname"], "comment": "operator", "type": "TXT"})
	if err := a.subdomainApply(ctx, job, "8.8.8.8"); err == nil {
		t.Fatal("unrelated record overwritten")
	}
	job["desired"] = false
	fake.failDelete = true
	if err := a.subdomainApply(ctx, job, ""); err == nil {
		t.Fatal("failed deletion reported success")
	}
	if len(fake.records) != 2 {
		t.Fatal("failed cleanup lost record")
	}
	fake.failDelete = false
	if err := a.subdomainApply(ctx, job, ""); err != nil {
		t.Fatal(err)
	}
	if len(fake.records) != 1 || fake.records[0]["comment"] != "operator" {
		t.Fatal("unrelated record removed")
	}
	if err := a.subdomainApply(ctx, job, ""); err != nil {
		t.Fatal("cleanup retry was not idempotent", err)
	}
}
func TestSubdomainRecordTargets(t *testing.T) {
	if err := subdomainConfirmRecord(M{}, M{"name": "play.test.example.com"}); err == nil {
		t.Fatal("empty provider result accepted")
	}
	for _, tc := range []struct{ target, kind string }{{"8.8.8.8", "A"}, {"2606:4700:4700::1111", "AAAA"}, {"gateway.example.com", "CNAME"}} {
		got, err := subdomainRecord("play.test.example.com", tc.target, "owner")
		if err != nil || got["type"] != tc.kind || boolean(got["proxied"]) {
			t.Fatal(tc, got, err)
		}
	}
	for _, target := range []string{"127.0.0.1", "10.0.0.1", "0.0.0.0", "::1", "https://gateway.example.com", "gateway.example.com:7000", "play.test.example.com"} {
		if _, err := subdomainRecord("play.test.example.com", target, "owner"); err == nil {
			t.Fatal("accepted unsafe target", target)
		}
	}
	if got := subdomainHostname("friends", "njimgang.org"); got != "play.friends.njimgang.org" {
		t.Fatal(got)
	}
}
