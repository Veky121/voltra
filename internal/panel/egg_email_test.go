package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

func TestEggEmailNativeOracle(t *testing.T) {
	raw, e := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "email", "egg-email-oracle.json"))
	if e != nil {
		t.Fatal(e)
	}
	raw = bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})
	var oracle struct {
		Meta struct {
			Intl    bool   `json:"intl"`
			ICU     string `json:"icu"`
			Unicode []int  `json:"unicode"`
		}
		Cases []struct {
			Value      any      `json:"value"`
			Parameters []string `json:"parameters"`
			Valid      bool     `json:"valid"`
			Exception  string   `json:"exception"`
		}
	}
	if e = json.Unmarshal(raw, &oracle); e != nil {
		t.Fatal(e)
	}
	if !oracle.Meta.Intl || oracle.Meta.ICU != "78.2" || len(oracle.Meta.Unicode) == 0 || oracle.Meta.Unicode[0] != 17 {
		t.Fatal("native oracle metadata does not match pinned ICU78.2/Unicode17")
	}
	if len(oracle.Cases) < 500 {
		t.Fatal("native corpus unexpectedly incomplete")
	}
	for i, row := range oracle.Cases {
		valid, e := validateEggEmailWithDNS(context.Background(), row.Value, row.Parameters, func(context.Context, string, string) ([]eggEmailDNSRecord, error) {
			t.Fatal("reserved native DNS case performed a lookup")
			return nil, nil
		})
		if row.Exception != "" {
			if e == nil {
				t.Errorf("case %d params%v value%q nativeexception%s Goerr=nil", i, row.Parameters, row.Value, row.Exception)
			}
			continue
		}
		if e != nil || valid != row.Valid {
			t.Errorf("case %d params%v value%q native=%v Go=%v err=%v", i, row.Parameters, row.Value, row.Valid, valid, e)
		}
	}
}

func TestEggEmailControlledDNS(t *testing.T) {
	cases := []struct {
		name, email string
		records     map[string][]eggEmailDNSRecord
		failed      map[string]bool
		want        bool
		queries     []string
	}{
		{name: "MX", email: "user@example.com", records: map[string][]eggEmailDNSRecord{"example.com/A+MX": {{Type: "MX", Target: "mail.example.com."}}}, want: true},
		{name: "A fallback", email: "user@example.com", records: map[string][]eggEmailDNSRecord{"example.com/A+MX": {{Type: "A"}}}, want: true},
		{name: "AAAA fallback", email: "user@example.com", records: map[string][]eggEmailDNSRecord{"example.com/AAAA": {{Type: "AAAA"}}}, want: true},
		{name: "null MX", email: "user@example.com", records: map[string][]eggEmailDNSRecord{"example.com/A+MX": {{Type: "A"}, {Type: "MX", Target: "."}}}},
		{name: "IDN UTS46", email: "user@bücher.de", records: map[string][]eggEmailDNSRecord{"xn--bcher-kva.de/A+MX": {{Type: "MX", Target: "mx.de."}}}, want: true, queries: []string{"xn--bcher-kva.de/A+MX", "xn--bcher-kva.de/AAAA"}},
		{name: "native ICU78 sharp s", email: "user@faß.de", records: map[string][]eggEmailDNSRecord{"xn--fa-hia.de/A+MX": {{Type: "A"}}}, want: true},
		{name: "parent suffix first", email: "user@sub.example.com", records: map[string][]eggEmailDNSRecord{"example.com/A+MX": {{Type: "A"}}}, want: true, queries: []string{"example.com/A+MX", "example.com/AAAA"}},
		{name: "child after parent failure", email: "user@sub.example.com", records: map[string][]eggEmailDNSRecord{"sub.example.com/A+MX": {{Type: "A"}}}, want: true},
		{name: "A MX error blocks AAAA", email: "user@example.com", records: map[string][]eggEmailDNSRecord{"example.com/AAAA": {{Type: "AAAA"}}}, failed: map[string]bool{"example.com/A+MX": true}},
		{name: "AAAA error allows MX", email: "user@example.com", records: map[string][]eggEmailDNSRecord{"example.com/A+MX": {{Type: "MX", Target: "mx.example.com."}}}, failed: map[string]bool{"example.com/AAAA": true}, want: true},
		{name: "reserved invalid", email: "user@reserved.invalid", want: false, queries: []string{}},
		{name: "no local validation in dns", email: "a..b@example.com", records: map[string][]eggEmailDNSRecord{"example.com/A+MX": {{Type: "A"}}}, want: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			queries := []string{}
			valid, e := validateEggEmailWithDNS(context.Background(), tt.email, []string{"dns"}, func(_ context.Context, host, kind string) ([]eggEmailDNSRecord, error) {
				key := host + "/" + kind
				queries = append(queries, key)
				if tt.failed[key] {
					return nil, errors.New("controlled DNS error")
				}
				return tt.records[key], nil
			})
			if e != nil || valid != tt.want {
				t.Fatalf("got%v want%v err%v queries%v", valid, tt.want, e, queries)
			}
			if tt.queries != nil && strings.Join(queries, ",") != strings.Join(tt.queries, ",") {
				t.Fatalf("queries%v want%v", queries, tt.queries)
			}
		})
	}
}

func TestEggEmailSpoofScriptExtensions(t *testing.T) {
	for _, tt := range []struct {
		value string
		want  bool
	}{{"a@bücher.de", true}, {"а@example.com", false}, {"a@раypal.com", false}, {"用户@example.com", true}, {"a@π.com", false}, {"a@アー.com", true}, {"πー@π.π", false}, {"π\u0342@π.π", true}, {"a\u0342@example.com", false}, {"a..b@example.com", true}, {"a@😄.com", true}} {
		if got := eggEmailSpoof(tt.value); got != tt.want {
			t.Errorf("%q got%v want%v", tt.value, got, tt.want)
		}
	}
}

func TestEggEmailDNSNativeOracle(t *testing.T) {
	raw, e := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "email", "egg-email-oracle.json"))
	if e != nil {
		t.Fatal(e)
	}
	raw = bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})
	var oracle struct {
		Cases []struct {
			Name, Value string
			Records     map[string][]eggEmailDNSRecord
			Failed      []string
			Valid       bool
			Queries     []string
		} `json:"dns_cases"`
	}
	if e = json.Unmarshal(raw, &oracle); e != nil {
		t.Fatal(e)
	}
	if len(oracle.Cases) < 12 {
		t.Fatal("controlled native DNS oracle is missing")
	}
	for _, tt := range oracle.Cases {
		t.Run(tt.Name, func(t *testing.T) {
			queries := []string{}
			valid, e := validateEggEmailWithDNS(context.Background(), tt.Value, []string{"dns"}, func(_ context.Context, host, kind string) ([]eggEmailDNSRecord, error) {
				key := host + "/" + kind
				queries = append(queries, key)
				for _, failure := range tt.Failed {
					if key == failure {
						return nil, errors.New("controlled native DNS failure")
					}
				}
				return tt.Records[key], nil
			})
			if e != nil || valid != tt.Valid || strings.Join(queries, ",") != strings.Join(tt.Queries, ",") {
				t.Fatalf("native valid%v queries%v; Go valid%v queries%v err%v", tt.Valid, tt.Queries, valid, queries, e)
			}
		})
	}
}

// This exercises net.Resolver over actual UDP DNS packets against an isolated
// local server, including MX, address fallback, IDNA and a null-MX rejection.
func TestEggEmailDNSWire(t *testing.T) {
	listener, e := net.ListenPacket("udp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer listener.Close()
	var mu sync.Mutex
	queries := []string{}
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		packet := make([]byte, 2048)
		for {
			count, peer, e := listener.ReadFrom(packet)
			if e != nil {
				return
			}
			var parser dnsmessage.Parser
			header, e := parser.Start(packet[:count])
			if e != nil {
				continue
			}
			question, e := parser.Question()
			if e != nil {
				continue
			}
			name := question.Name.String()
			mu.Lock()
			queries = append(queries, name)
			mu.Unlock()
			builder := dnsmessage.NewBuilder(nil, dnsmessage.Header{ID: header.ID, Response: true, Authoritative: true, RecursionDesired: header.RecursionDesired, RecursionAvailable: true})
			builder.EnableCompression()
			builder.StartQuestions()
			builder.Question(question)
			builder.StartAnswers()
			resource := dnsmessage.ResourceHeader{Name: question.Name, Class: dnsmessage.ClassINET, TTL: 60}
			switch question.Type {
			case dnsmessage.TypeMX:
				resource.Type = dnsmessage.TypeMX
				if name == "null-mail.com." {
					target, _ := dnsmessage.NewName(".")
					builder.MXResource(resource, dnsmessage.MXResource{MX: target})
				} else if name != "address-only.com." {
					target, _ := dnsmessage.NewName("mx.mail-fixture.com.")
					builder.MXResource(resource, dnsmessage.MXResource{Pref: 10, MX: target})
				}
			case dnsmessage.TypeA:
				resource.Type = dnsmessage.TypeA
				builder.AResource(resource, dnsmessage.AResource{A: [4]byte{127, 0, 0, 42}})
			case dnsmessage.TypeAAAA:
				resource.Type = dnsmessage.TypeAAAA
				builder.AAAAResource(resource, dnsmessage.AAAAResource{AAAA: [16]byte{15: 1}})
			}
			response, e := builder.Finish()
			if e == nil {
				listener.WriteTo(response, peer)
			}
		}
	}()
	defer func() { listener.Close(); <-stopped }()
	resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "udp", listener.LocalAddr().String())
	}}
	for _, tt := range []struct {
		email string
		want  bool
	}{{"user@mail-fixture.com", true}, {"user@address-only.com", true}, {"user@bücher.de", true}, {"user@null-mail.com", false}} {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		valid, e := validateEggEmailWithDNS(ctx, tt.email, []string{"dns"}, func(ctx context.Context, host, kind string) ([]eggEmailDNSRecord, error) {
			return eggEmailLookupDNSResolver(ctx, host, kind, resolver)
		})
		cancel()
		if e != nil || valid != tt.want {
			t.Fatalf("%s valid%v want%v err%v", tt.email, valid, tt.want, e)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(queries) == 0 {
		t.Fatal("DNS wire test made no actual queries")
	}
	idnFound := false
	for _, query := range queries {
		if query == "xn--bcher-kva.de." {
			idnFound = true
		}
	}
	if !idnFound {
		t.Fatalf("IDN domain was not queried as punycode: %v", queries)
	}
}
