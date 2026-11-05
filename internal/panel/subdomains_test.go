package panel

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestSubdomainNames(t *testing.T) {
	for _, input := range []string{"games.example.com", " Games.Example.COM. "} {
		got, err := subdomainName(input)
		if err != nil || got != "games.example.com" {
			t.Fatalf("%q: %s %v", input, got, err)
		}
	}
	for _, input := range []string{"", "localhost", "*.example.com", "https://games.example.com", "games.example.com:25565", "127.0.0.1", "a..example.com", "-bad.example.com", strings.Repeat("a", 64) + ".example.com", "a.example.com/path", "a.example.com\x00"} {
		if _, err := subdomainName(input); err == nil {
			t.Fatalf("accepted %q", input)
		}
	}
	for _, label := range []string{"a", "my-server", "a1", strings.Repeat("a", 63)} {
		if !subdomainLabel.MatchString(label) {
			t.Fatal(label)
		}
	}
	for _, label := range []string{"", "a.b", "-a", "a-", "foo/bar", strings.Repeat("a", 64)} {
		if subdomainLabel.MatchString(label) {
			t.Fatal(label)
		}
	}
}
func TestSubdomainDNS(t *testing.T) {
	for _, tc := range []struct {
		name           string
		target, actual []string
		missing        bool
		want           bool
	}{
		{"IPv4", []string{"8.8.8.8"}, []string{"8.8.8.8"}, false, true},
		{"IPv6", []string{"2606:4700:4700::1111"}, []string{"2606:4700:4700::1111"}, false, true},
		{"subset", []string{"8.8.8.8", "1.1.1.1"}, []string{"8.8.8.8"}, false, true},
		{"wrong AAAA", []string{"8.8.8.8"}, []string{"8.8.8.8", "2606:4700:4700::1111"}, false, false},
		{"wrong target", []string{"8.8.8.8"}, []string{"1.1.1.1"}, false, false},
		{"private", []string{"192.168.1.2"}, []string{"192.168.1.2"}, false, false},
		{"wildcard bind", []string{"0.0.0.0"}, []string{"0.0.0.0"}, false, false},
		{"loopback", []string{"127.0.0.1"}, []string{"127.0.0.1"}, false, false},
		{"missing", []string{"8.8.8.8"}, nil, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lookup := func(ctx context.Context, name string) ([]net.IPAddr, error) {
				if _, ok := ctx.Deadline(); !ok {
					t.Fatal("DNS lookup needs a deadline")
				}
				ips := tc.target
				if name == "server.example.com" {
					if tc.missing {
						return nil, errors.New("missing")
					}
					ips = tc.actual
				}
				out := []net.IPAddr{}
				for _, ip := range ips {
					out = append(out, net.IPAddr{IP: net.ParseIP(ip)})
				}
				return out, nil
			}
			got, detail := subdomainDNS(context.Background(), "server.example.com", "gateway.example.com", lookup)
			if got != tc.want || detail == "" {
				t.Fatalf("%v %s", got, detail)
			}
		})
	}
}
func TestSubdomainReservations(t *testing.T) {
	a, _, user := infraTestApp(t)
	fake := &subdomainFake{}
	a.HTTP = fake.client()
	ctx := context.Background()
	mux := http.NewServeMux()
	a.registerProxyGateways(mux)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := a.DB.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO locations(id,short) VALUES(9901,'subdomains')`)
	exec(`INSERT INTO nodes(id,uuid,name,location_id,fqdn,daemon_token_id,daemon_token) VALUES(9901,'subdomain-node','test',9901,'127.0.0.1','test','test')`)
	exec(`INSERT INTO nests(id,uuid,author,name) VALUES(9901,'subdomain-nest','test','test')`)
	exec(`INSERT INTO eggs(id,uuid,nest_id,author,name) VALUES(9901,'subdomain-egg',9901,'test','test')`)
	exec(`INSERT INTO servers(id,uuid,uuid_short,identifier,name,owner_id,node_id,nest_id,egg_id,image,installed_at) VALUES(9901,'subdomain-server-1','sd1','sd1','test',$1,9901,9901,9901,'test',now()),(9902,'subdomain-server-2','sd2','sd2','test',$1,9901,9901,9901,'test',now())`, user)
	exec(`INSERT INTO allocations(id,node_id,server_id,ip,port) VALUES(9901,9901,9901,'127.0.0.1',25565),(9902,9901,9902,'127.0.0.1',25566)`)
	exec(`UPDATE servers SET allocation_id=id WHERE id IN (9901,9902)`)
	exec(`INSERT INTO proxy_gateways(id,name,public_host,public_port_start,public_port_end) VALUES(9901,'test','8.8.8.8',25565,25570)`)
	exec(`INSERT INTO proxy_node_clients(id,gateway_id,node_id,admin_url,credentials_encrypted,local_port_start,local_port_end) VALUES(9901,9901,9901,'http://127.0.0.1','test',25565,25570)`)
	exec(`INSERT INTO proxy_routes(id,gateway_id,client_id,server_id,allocation_id,protocol,public_port,local_ip,local_port,proxy_name) VALUES(9901,9901,9901,9901,9901,'tcp',25565,'127.0.0.1',25565,'sd1'),(9902,9901,9901,9902,9902,'tcp',25566,'127.0.0.1',25566,'sd2')`)
	infraExpect(t, mux, user, "GET", "/api/client/servers/sd1/subdomain", nil, 200)
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": ""}, 200)
	if fake.writes != 0 {
		t.Fatal("empty join name created DNS")
	}
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": "survival", "route_id": 9901}, 422)
	encrypted := subdomainTestCredentials(t, a)
	integration, err := a.insert(ctx, "integrations", M{"name": "DNS test", "provider": "cloudflare", "enabled": true, "credentials": encrypted})
	if err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(M{"domain": "example.invalid", "integration_id": integration["id"]})
	exec(`INSERT INTO settings(key,value) VALUES('network.subdomain_gateway.9901',$1::jsonb)`, string(config))

	enabledChoices := asMap(infraExpect(t, mux, user, "GET", "/api/client/servers/sd1/subdomain", nil, 200)["attributes"])
	if len(asSlice(enabledChoices["choices"])) != 1 {
		t.Fatal("enabled Cloudflare not offered")
	}
	exec("UPDATE integrations SET enabled=false WHERE id=$1", integration["id"])
	disabledChoices := asMap(infraExpect(t, mux, user, "GET", "/api/client/servers/sd1/subdomain", nil, 200)["attributes"])
	if len(asSlice(disabledChoices["choices"])) != 0 {
		t.Fatal("disabled Cloudflare still offered")
	}
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": "hidden", "route_id": 9901}, 422)
	if fake.writes != 0 {
		t.Fatal("disabled integration mutated DNS")
	}
	exec("UPDATE integrations SET enabled=true WHERE id=$1", integration["id"])
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": "bad.label", "route_id": 9901}, 422)
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": "survival", "route_id": 9902}, 422)
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": "survival", "route_id": 9901}, 200)
	exec(`UPDATE servers SET name='A different display name' WHERE id=9901`)
	unchanged := asMap(infraExpect(t, mux, user, "GET", "/api/client/servers/sd1/subdomain", nil, 200)["attributes"])
	if unchanged["hostname"] != "play.survival.example.invalid" {
		t.Fatal("join name depended on display name")
	}
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd2/subdomain", M{"label": "survival", "route_id": 9902}, 409)
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd1/subdomain", M{"label": "renamed", "route_id": 9901}, 200)
	infraExpect(t, mux, user, "PUT", "/api/client/servers/sd2/subdomain", M{"label": "survival", "route_id": 9902}, 200)
	fake.failDelete = true
	if err := a.cleanupServerSubdomains(ctx, 9902); err == nil {
		t.Fatal("provider cleanup failure did not block server deletion")
	}
	if len(fake.records) != 2 {
		t.Fatal("failed cleanup lost provider record")
	}
	fake.failDelete = false
	if err := a.cleanupServerSubdomains(ctx, 9902); err != nil {
		t.Fatal(err)
	}
	if len(fake.records) != 1 {
		t.Fatal("server deletion did not remove DNS")
	}
	exec(`UPDATE proxy_routes SET desired_present=false WHERE id=9901`)
	got := asMap(infraExpect(t, mux, user, "GET", "/api/client/servers/sd1/subdomain", nil, 200)["attributes"])
	if got["route"] != nil || boolean(got["dns_matches"]) {
		t.Fatal("stale route was accepted")
	}
	if err := a.reconcileSubdomains(ctx, 9901); err != nil {
		t.Fatal(err)
	}
	if len(fake.records) != 0 {
		t.Fatal("removed primary route retained DNS")
	}
	infraExpect(t, mux, user, "DELETE", "/api/client/servers/sd1/subdomain", nil, 200)
	if len(fake.records) != 0 {
		t.Fatal("clear did not delete DNS")
	}
}
