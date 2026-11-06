package panel

import "testing"

func TestNavigationArtworkUsesVerifiedPackAndHidesProviderURL(t *testing.T) {
	server := M{"uuid": "pack-server", "minecraft_pack": M{"provider": "modrinth", "project_id": "pack", "name": "ATM10", "icon_url": "https://cdn.modrinth.com/data/pack/icon.png"}}
	art := navigationArtwork(server)
	if str(art["game"]) != "minecraft" || str(art["pack_icon"]) != "/api/client/servers/pack-server/artwork/pack" || str(art["pack_name"]) != "ATM10" {
		t.Fatalf("missing pack identity: %v", art)
	}
	if len(art) != 3 {
		t.Fatalf("unexpected metadata: %v", art)
	}
	asMap(server["minecraft_pack"])["icon_url"] = "http://127.0.0.1/private"
	if navigationArtwork(server)["pack_icon"] != nil {
		t.Fatal("unsafe provider image exposed")
	}
	delete(server, "minecraft_pack")
	if len(navigationArtwork(server)) != 0 {
		t.Fatal("unknown workload marked Minecraft")
	}
	server["artwork_egg_features"] = []any{"minecraft"}
	if str(navigationArtwork(server)["game"]) != "minecraft" {
		t.Fatal("missing vanilla fallback")
	}
}
