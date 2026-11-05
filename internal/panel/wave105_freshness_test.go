package panel

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestWave105FinalFreshness(t *testing.T) {
	for _, family := range []string{"folia", "purpur", "neoforge", "vanillacord"} {
		for _, mode := range []string{"custom", "startup", "permission", "native", "egg"} {
			t.Run(family+"/"+mode, func(t *testing.T) {
				a, mux, admin, server, f := quickSetupMinecraftFixture(t)
				ctx := context.Background()
				var recipe string
				for _, entry := range gameTemplates().Entries {
					if strings.Contains(strings.ToLower(entry.Path), family) {
						recipe = entry.Path
						break
					}
				}
				if recipe == "" {
					t.Fatal("missing recipe", family)
				}
				if _, e := a.update(ctx, "eggs", num(server["egg_id"]), batchSettingsRecipeFixture(t, recipe)); e != nil {
					t.Fatal(e)
				}
				if _, e := a.update(ctx, "servers", num(server["id"]), M{"startup": "java -jar custom.jar"}); e != nil {
					t.Fatal(e)
				}
				f.State = "offline"
				route := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=/server.properties"
				view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
				transport := a.HTTP.Transport
				if transport == nil {
					transport = http.DefaultTransport
				}
				states := 0
				original := string(f.Files["/server.properties"])
				a.HTTP = &http.Client{Transport: gameLibraryTransport(func(req *http.Request) (*http.Response, error) {
					res, e := transport.RoundTrip(req)
					if e == nil && req.Method == "GET" && req.URL.Path == "/api/servers/"+str(server["uuid"]) {
						states++
						if states == 2 {
							switch mode {
							case "startup":
								e = a.exec(ctx, "UPDATE servers SET startup='late changed' WHERE id=$1", server["id"])
							case "egg":
								e = a.exec(ctx, "UPDATE eggs SET startup='late changed' WHERE id=$1", server["egg_id"])
							case "permission":
								e = a.exec(ctx, "UPDATE users SET disabled=true WHERE id=$1", admin)
							case "native":
								f.mu.Lock()
								f.Files["/server.properties"] = []byte(original + "external=keep\n")
								f.mu.Unlock()
							}
							if e != nil {
								t.Error(e)
							}
						}
					}
					return res, e
				})}
				want := 409
				if mode == "custom" {
					want = 200
				}
				if mode == "permission" {
					want = 403
				}
				before := f.Writes
				infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{"motd": "Updated"}}, want)
				if states != 2 {
					t.Fatal("late mutation hook missed", states)
				}
				if want != 200 && f.Writes != before {
					t.Fatal("refusal wrote native bytes")
				}
				if mode == "custom" && f.Writes != before+1 {
					t.Fatal("custom startup edit failed")
				}
			})
		}
	}
}
