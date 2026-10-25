package panel

import (
	"context"
	"testing"
)

func TestSteamGameProtonImageMetadata(t *testing.T) {
	a, mux, admin, node, _ := steamGamesFixture(t)
	mux.HandleFunc("GET /api/client/servers/{server}/startup", a.clientStartup)
	ctx := context.Background()
	input := steamGamesInput("palworld-native", node)
	response := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld-native/install", input, 201)
	server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", asMap(response["attributes"])["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(ctx, "UPDATE servers SET status=NULL WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	for _, game := range []string{"palworld-native", "palworld-proton"} {
		spec, _ := steamGameSpecFor(game)
		egg, err := a.steamGameEgg(ctx, spec)
		if err != nil {
			t.Fatal(err)
		}
		label := "Native Linux"
		if game == "palworld-proton" {
			label = "Windows / Proton"
			if spec.UnavailableReason != "" {
				t.Fatal("Reviewed public Proton setup unexpectedly gated")
			}
		}
		if str(asMap(egg["docker_images"])[label]) != spec.Image {
			t.Fatal("Wrong managed runtime image label")
		}
		if err = a.exec(ctx, "UPDATE servers SET egg_id=$2,nest_id=$3 WHERE id=$1", server["id"], egg["id"], egg["nest_id"]); err != nil {
			t.Fatal(err)
		}
		view := infraExpect(t, mux, admin, "GET", "/api/client/servers/"+str(server["uuid_short"])+"/startup", nil, 200)
		if str(asMap(asMap(view["meta"])["docker_images"])[label]) != spec.Image {
			t.Fatal("Startup API runtime label differs")
		}
		if game == "palworld-proton" {
			if err = a.exec(ctx, "UPDATE eggs SET docker_images=$2 WHERE id=$1", egg["id"], M{"Native Linux": spec.Image}); err != nil {
				t.Fatal(err)
			}
			upgraded, err := a.steamGameEgg(ctx, spec)
			if err != nil || str(asMap(upgraded["docker_images"])[label]) != spec.Image {
				t.Fatal("Previous exact Proton label not corrected")
			}
			custom := M{"Operator image": spec.Image}
			if err = a.exec(ctx, "UPDATE eggs SET docker_images=$2 WHERE id=$1", egg["id"], custom); err != nil {
				t.Fatal(err)
			}
			preserved, err := a.steamGameEgg(ctx, spec)
			if err != nil || str(asMap(preserved["docker_images"])["Operator image"]) != spec.Image {
				t.Fatal("Operator image metadata overwritten")
			}
		}
	}
}
