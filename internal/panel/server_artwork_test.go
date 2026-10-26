package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func artworkFixturePNG(t *testing.T, size int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.NRGBA{R: 65, G: 130, B: 230, A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestServerArtworkRasterValidation(t *testing.T) {
	good := artworkFixturePNG(t, 64)
	withSecret := append(append([]byte{}, good...), []byte("private metadata must not escape")...)
	clean := serverArtworkPNG(withSecret, true)
	if len(clean) == 0 || bytes.Contains(clean, []byte("private metadata")) {
		t.Fatal("Icon was not re-encoded as pixels only")
	}
	for _, data := range [][]byte{nil, []byte(`<svg onload="alert(1)"/>`), []byte("not an image"), good[:40], make([]byte, (4<<20)+1), artworkFixturePNG(t, 32), artworkFixturePNG(t, 1025)} {
		if serverArtworkPNG(data, true) != nil {
			t.Fatal("Invalid server icon accepted")
		}
	}
	if serverArtworkPNG(artworkFixturePNG(t, 128), false) == nil {
		t.Fatal("Provider artwork should retain its larger size")
	}
}

func TestServerArtworkRecognizesMinecraftTemplatesWithoutDisplayNames(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if !strings.HasPrefix(entry.Path, "minecraft/") {
			continue
		}
		sum := sha256.Sum256([]byte(entry.Path + ":" + entry.SHA256))
		h := fmt.Sprintf("%x", sum[:16])
		egg := M{"uuid": h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], "name": "Renamed recipe"}
		want := !strings.HasPrefix(entry.Path, "minecraft/bedrock/") && !strings.HasPrefix(entry.Path, "minecraft/proxy/bedrock/")
		if serverArtworkMinecraftEgg(egg) != want {
			t.Errorf("Wrong icon support for %s", entry.Path)
		}
	}
	if serverArtworkMinecraftEgg(M{"uuid": "unrelated", "name": "Minecraft friends"}) {
		t.Fatal("A display name alone enabled file access")
	}
}

func TestImportedModpackArtworkDoesNotChangeRuntimeClassification(t *testing.T) {
	egg := M{"uuid": "legacy", "name": "CurseForge Generic", "features": []string{"eula", "java_version", "pid_limit"}}
	server := M{"minecraft_pack": M{"provider": "curseforge", "project_id": "925200", "name": "All the Mods 10"}}
	if !serverArtworkMinecraftWorkload(server, egg) {
		t.Fatal("verified imported modpack lost its artwork")
	}
	if javaMinecraftEgg(egg) {
		t.Fatal("artwork enabled managed Minecraft runtime behavior")
	}
	for _, pack := range []M{{"name": "Minecraft"}, {"provider": "untrusted", "project_id": "123", "name": "Pack"}, {"provider": "curseforge", "name": "Pack"}} {
		if serverArtworkMinecraftWorkload(M{"minecraft_pack": pack}, egg) {
			t.Fatal("unverified metadata enabled artwork")
		}
	}
}

func TestServerArtworkCacheCoalescesAndRefreshes(t *testing.T) {
	var cache serverArtworkCache
	var calls atomic.Int32
	start := make(chan struct{})
	var group sync.WaitGroup
	for range 12 {
		group.Go(func() {
			data := cache.get(context.Background(), "server", time.Minute, func() []byte { calls.Add(1); <-start; return []byte("image") })
			if string(data) != "image" {
				t.Error("cache returned the wrong image")
			}
		})
	}
	close(start)
	group.Wait()
	if calls.Load() != 1 {
		t.Fatalf("Concurrent requests loaded %d times", calls.Load())
	}
	cache.mu.Lock()
	cache.entries["server"] = serverArtworkEntry{data: []byte("old"), expires: time.Now().Add(-time.Second)}
	cache.mu.Unlock()
	if string(cache.get(context.Background(), "server", time.Minute, func() []byte { return []byte("new") })) != "new" {
		t.Fatal("Expired icon did not refresh")
	}
	for i := range 140 {
		cache.get(context.Background(), string(rune(i)), time.Minute, func() []byte { return []byte("x") })
	}
	if len(cache.entries) > 128 {
		t.Fatal("Cache grew beyond its entry bound")
	}
}

func artworkResponse(data []byte) *http.Response {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}
}

func artworkMinecraftFixture(t *testing.T) *operationsFixture {
	f := operationsFixtureNew(t)
	_, err := f.a.update(context.Background(), "eggs", num(f.server["egg_id"]), M{"features": []string{"minecraft"}})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestServerArtworkIconAccessAndFixedPath(t *testing.T) {
	f := artworkMinecraftFixture(t)
	icon := append(artworkFixturePNG(t, 64), []byte("secret trailing data")...)
	var reads atomic.Int32
	f.a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/files/list-directory") {
			if r.URL.Query().Get("directory") != "/" {
				t.Error("Icon lookup escaped the server root")
			}
			return artworkResponse([]byte(`[{"name":"server-icon.png","file":true,"size":200}]`)), nil
		}
		if strings.HasSuffix(r.URL.Path, "/files/contents") {
			reads.Add(1)
			if r.URL.Query().Get("file") != "/server-icon.png" || !strings.Contains(r.URL.Path, str(f.server["uuid"])) || r.Header.Get("Authorization") == "" {
				t.Error("Incorrect icon file, server scope, or missing daemon authentication")
			}
			return artworkResponse(icon), nil
		}
		return http.DefaultTransport.RoundTrip(r)
	})
	path := f.serverPath("/artwork/icon?file=/secrets.txt")
	response := f.request("GET", path, nil, f.owner)
	if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" || bytes.Contains(response.Body.Bytes(), []byte("secret trailing")) {
		t.Fatalf("Invalid icon response: status %d", response.Code)
	}
	if _, err := png.Decode(bytes.NewReader(response.Body.Bytes())); err != nil {
		t.Fatal(err)
	}
	f.request("GET", path, nil, f.owner)
	if reads.Load() != 1 {
		t.Fatal("Repeated icon requests bypassed the cache")
	}
	operationsExpect(t, f.request("GET", path, nil, f.sub), 403)
	operationsExpect(t, f.request("GET", path, nil, f.admin), 200)
	ctx := context.Background()
	if err := f.a.exec(ctx, "UPDATE subusers SET permissions=$1 WHERE user_id=$2 AND server_id=$3", []string{"file.read-content"}, f.sub["id"], f.server["id"]); err != nil {
		t.Fatal(err)
	}
	if f.request("GET", path, nil, f.sub).Code != 200 {
		t.Fatal("Authorized subuser could not see the icon")
	}
	if err := f.a.exec(ctx, "DELETE FROM subusers WHERE user_id=$1 AND server_id=$2", f.sub["id"], f.server["id"]); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("GET", path, nil, f.sub), 404)
	operationsExpect(t, f.request("GET", f.serverPath("/artwork/anything"), nil, f.owner), 404)
	r := httptest.NewRequest("GET", path, nil)
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("Anonymous icon request returned %d", w.Code)
	}
	// Conditional requests must still pass authorization before cache access.
	r = WithUser(httptest.NewRequest("GET", path, nil), num(f.owner["id"]))
	r.Header.Set("If-None-Match", response.Header().Get("ETag"))
	w = httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	if w.Code != 304 || w.Body.Len() != 0 {
		t.Fatal("Unchanged icon did not support conditional caching")
	}
}

func TestServerArtworkMissingUnsafeAndNonMinecraft(t *testing.T) {
	f := artworkMinecraftFixture(t)
	for _, tc := range []struct {
		name, listing string
		data          []byte
	}{
		{"missing", `[]`, nil},
		{"symlink", `[{"name":"server-icon.png","file":true,"symlink":true}]`, nil},
		{"directory", `[{"name":"server-icon.png","directory":true}]`, nil},
		{"oversized", `[{"name":"server-icon.png","file":true,"size":999999}]`, nil},
		{"invalid image", `[{"name":"server-icon.png","file":true,"size":30}]`, []byte("not an image")},
		{"wrong dimensions", `[{"name":"server-icon.png","file":true,"size":200}]`, artworkFixturePNG(t, 32)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f.a.artworkCache = serverArtworkCache{}
			f.a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
				if strings.HasSuffix(r.URL.Path, "/files/list-directory") {
					return artworkResponse([]byte(tc.listing)), nil
				}
				if strings.HasSuffix(r.URL.Path, "/files/contents") {
					if tc.data == nil {
						t.Error("Unsafe or missing icon was read")
					}
					return artworkResponse(tc.data), nil
				}
				return http.DefaultTransport.RoundTrip(r)
			})
			if w := f.request("GET", f.serverPath("/artwork/icon"), nil, f.owner); w.Code != 204 || w.Body.Len() != 0 {
				t.Fatalf("Expected silent fallback, got %d", w.Code)
			}
		})
	}
	_, err := f.a.update(context.Background(), "eggs", num(f.server["egg_id"]), M{"features": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	f.a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		t.Error("Read icon from a non-Minecraft server")
		return nil, context.Canceled
	})
	if f.request("GET", f.serverPath("/artwork/icon"), nil, f.owner).Code != 204 {
		t.Fatal("Non-Minecraft fallback failed")
	}
}

func TestServerArtworkPackProxyAndPublicMetadata(t *testing.T) {
	f := artworkMinecraftFixture(t)
	ctx := context.Background()
	pack := M{"provider": "modrinth", "project_id": "pack", "name": "A real modpack", "icon_url": "https://cdn.modrinth.com/data/pack/icon.png"}
	server, err := f.a.update(ctx, "servers", num(f.server["id"]), M{"minecraft_pack": pack})
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	f.a.HTTP.Transport = gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.String() != pack["icon_url"] || r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
			t.Error("Unexpected URL or credentials sent to artwork host")
		}
		return artworkResponse(artworkFixturePNG(t, 128)), nil
	})
	// Pack artwork is provider metadata, available to members without file access.
	if w := f.request("GET", f.serverPath("/artwork/pack"), nil, f.sub); w.Code != 200 {
		t.Fatalf("Pack artwork returned %d", w.Code)
	}
	f.request("GET", f.serverPath("/artwork/pack"), nil, f.owner)
	if calls.Load() != 1 {
		t.Fatal("Pack image was not cached")
	}
	egg, err := f.a.serverEffectiveEgg(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	metadata := f.a.clientArtworkMetadata(ctx, f.sub, server, egg)
	encoded, _ := json.Marshal(metadata)
	if metadata["server_icon"] != nil || metadata["pack_name"] != "A real modpack" || metadata["pack_icon"] == nil || bytes.Contains(encoded, []byte("cdn.modrinth")) {
		t.Fatalf("Invalid public metadata: %s", encoded)
	}
	pack["icon_url"] = "http://127.0.0.1/private"
	if _, err = f.a.update(ctx, "servers", num(server["id"]), M{"minecraft_pack": pack}); err != nil {
		t.Fatal(err)
	}
	if f.request("GET", f.serverPath("/artwork/pack"), nil, f.owner).Code != 204 || calls.Load() != 1 {
		t.Fatal("Untrusted artwork URL was requested")
	}
	// Provider redirects cannot escape the approved image CDN set.
	provider := &App{HTTP: &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		res := artworkResponse(nil)
		res.StatusCode = 302
		res.Header.Set("Location", "http://127.0.0.1/private")
		return res, nil
	})}}
	if _, err := provider.minecraftProviderBytes(ctx, "https://cdn.modrinth.com/icon.png", "", 4<<20, []string{"cdn.modrinth.com"}); err == nil {
		t.Fatal("Artwork redirect to private host accepted")
	}
}
