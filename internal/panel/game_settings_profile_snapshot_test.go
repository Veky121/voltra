package panel

import "testing"

func TestGameSettingsSnapshotKeepsNativeReadsFresh(t *testing.T) {
	_, mux, admin, server, node := quickSetupMinecraftFixture(t)
	endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings"
	read := func() M {
		return asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
	}
	first := read()
	node.mu.Lock()
	node.Files["/server.properties"] = []byte("motd=Changed outside the panel\nview-distance=7\nserver-port=25565\nrcon.password=fresh-private-secret\n")
	node.mu.Unlock()
	second := read()
	if str(first["revision"]) == str(second["revision"]) {
		t.Fatal("recipe snapshot reused old native file revision")
	}
	var message, secret, managed bool
	for _, raw := range asSlice(second["fields"]) {
		field := asMap(raw)
		switch str(field["key"]) {
		case "motd":
			message = str(field["value"]) == "Changed outside the panel"
		case "rcon.password":
			secret = field["value"] == nil && boolean(field["configured"])
		case "server-port":
			managed = boolean(field["readonly"])
		}
	}
	if !message || !secret || !managed {
		t.Fatal("snapshot changed native freshness, secret masking or managed port checks")
	}
	infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": first["revision"], "settings": M{"motd": "stale write"}}, 409)
}

func TestGameSettingsProfileSnapshotIdentityAndIsolation(t *testing.T) {
	entries := gameTemplates().Entries
	first, second := entries[0], entries[1]
	egg := M{"uuid": gameTemplateEggUUID(first), "startup": "custom startup"}
	snapshot := withGameSettingsProfileSnapshot(egg)
	if _, exists := egg[gameSettingsProfileSnapshotKey]; exists {
		t.Fatal("snapshot escaped into original egg")
	}
	if got, ok := gameSettingsProfile(snapshot); !ok || got.Path != first.Path {
		t.Fatal("UUID identity was not preserved", got.Path, ok)
	}
	snapshot["uuid"] = gameTemplateEggUUID(second)
	if got, ok := gameSettingsProfile(snapshot); !ok || got.Path != second.Path {
		t.Fatal("changed identity reused stale recipe", got.Path, ok)
	}
	unknown := withGameSettingsProfileSnapshot(M{"uuid": "custom", "startup": "unknown startup"})
	if _, ok := gameSettingsProfile(unknown); ok {
		t.Fatal("unknown recipe gained an identity")
	}
	unknown["uuid"] = gameTemplateEggUUID(first)
	if got, ok := gameSettingsProfile(unknown); !ok || got.Path != first.Path {
		t.Fatal("negative snapshot concealed new identity")
	}
	unknown["uuid"] = "custom"
	unknown["startup"] = first.Egg["startup"]
	want, found := gameSettingsProfileFrom(unknown, entries)
	if got, ok := gameSettingsProfile(unknown); ok != found || got.Path != want.Path {
		t.Fatal("startup fallback semantics changed")
	}
	// JSON metadata cannot forge the private typed snapshot.
	unknown[gameSettingsProfileSnapshotKey] = M{"found": true, "entry": first}
	if got, ok := gameSettingsProfile(unknown); ok != found || got.Path != want.Path {
		t.Fatal("untrusted metadata established recipe identity")
	}
}

func BenchmarkGameSettingsFieldClassification(b *testing.B) {
	egg := M{"uuid": "legacy-minecraft-egg", "startup": "java @user_jvm_args.txt @libraries/net/minecraftforge/forge/unix_args.txt nogui"}
	for _, snapshot := range []bool{false, true} {
		name := "catalog_scan"
		if snapshot {
			name = "request_snapshot"
		}
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				current := egg
				if snapshot {
					current = withGameSettingsProfileSnapshot(egg)
				}
				for field := 0; field < 61; field++ {
					_ = gameSettingManaged(current, "/server.properties", "view-distance")
					// The presentation loop checks six campaign groups per field.
					for group := 0; group < 6; group++ {
						_ = campaignParserRecipe(current)
					}
				}
			}
		})
	}
}
