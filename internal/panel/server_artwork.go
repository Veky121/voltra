package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	_ "golang.org/x/image/webp"
)

// This type is only supplied by the verified provider install plan. Application
// API JSON cannot set it, and installer archives never receive this metadata.
type minecraftPackArtwork struct {
	Provider  string `json:"provider"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	IconURL   string `json:"icon_url"`
}

var serverArtworkMinecraftTemplates = sync.OnceValue(func() map[string]bool {
	out := map[string]bool{}
	for _, entry := range gameTemplates().Entries {
		if strings.HasPrefix(entry.Path, "minecraft/java/") || strings.HasPrefix(entry.Path, "minecraft/crossplay/") || strings.HasPrefix(entry.Path, "minecraft/proxy/java/") {
			// Same immutable recipe identity used by ensureGameTemplateEgg.
			sum := sha256.Sum256([]byte(entry.Path + ":" + entry.SHA256))
			out[fmt.Sprintf("%x", sum[:16])] = true
		}
	}
	return out
})

func serverArtworkMinecraftEgg(egg M) bool {
	return javaMinecraftEgg(egg) || serverArtworkMinecraftTemplates()[strings.ReplaceAll(str(egg["uuid"]), "-", "")]
}

func (a *App) clientArtworkMetadata(ctx context.Context, user, server, egg M) M {
	out := M{}
	if !serverArtworkMinecraftEgg(egg) {
		return out
	}
	out["game"] = "minecraft"
	base := "/api/client/servers/" + url.PathEscape(str(server["uuid"])) + "/artwork/"
	if a.can(ctx, user, server, "file.read-content") {
		out["server_icon"] = base + "icon"
	}
	pack := asMap(server["minecraft_pack"])
	if str(pack["name"]) != "" {
		out["pack_name"] = pack["name"]
	}
	if mcContentIcon(str(pack["icon_url"])) != "" {
		out["pack_icon"] = base + "pack"
	}
	return out
}

type serverArtworkEntry struct {
	data    []byte
	expires time.Time
}

// Bounded per-panel memory cache. Authorization is checked before every lookup,
// including cache hits. Misses are cached briefly and simultaneous reads share
// one load, so dashboards do not repeatedly list the same server directory.
type serverArtworkCache struct {
	mu      sync.Mutex
	entries map[string]serverArtworkEntry
	pending map[string]chan struct{}
}

func (c *serverArtworkCache) get(ctx context.Context, key string, ttl time.Duration, load func() []byte) []byte {
	for {
		c.mu.Lock()
		if entry, ok := c.entries[key]; ok && time.Now().Before(entry.expires) {
			c.mu.Unlock()
			return entry.data
		}
		if waiting := c.pending[key]; waiting != nil {
			c.mu.Unlock()
			select {
			case <-waiting:
				continue
			case <-ctx.Done():
				return nil
			}
		}
		if c.entries == nil {
			c.entries = map[string]serverArtworkEntry{}
			c.pending = map[string]chan struct{}{}
		}
		waiting := make(chan struct{})
		c.pending[key] = waiting
		c.mu.Unlock()
		data := load()
		if len(data) == 0 {
			ttl = 15 * time.Second
		}
		c.mu.Lock()
		c.entries[key] = serverArtworkEntry{data: data, expires: time.Now().Add(ttl)}
		var total int
		for _, entry := range c.entries {
			total += len(entry.data)
		}
		for len(c.entries) > 128 || total > 16<<20 {
			oldest := ""
			var expires time.Time
			for id, entry := range c.entries {
				if oldest == "" || entry.expires.Before(expires) {
					oldest, expires = id, entry.expires
				}
			}
			total -= len(c.entries[oldest].data)
			delete(c.entries, oldest)
		}
		delete(c.pending, key)
		close(waiting)
		c.mu.Unlock()
		return data
	}
}

// Decode bounded raster images and re-encode only their pixels. This rejects
// active formats and strips comments, appended data and other file metadata.
func serverArtworkPNG(data []byte, serverIcon bool) []byte {
	if len(data) == 0 || len(data) > 4<<20 {
		return nil
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 1024 || config.Height > 1024 {
		return nil
	}
	if serverIcon && (format != "png" || config.Width != 64 || config.Height != 64) {
		return nil
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	var out bytes.Buffer
	if png.Encode(&out, decoded) != nil || out.Len() > 4<<20 {
		return nil
	}
	return out.Bytes()
}

func (a *App) minecraftServerIcon(ctx context.Context, server M) []byte {
	entries, err := a.quickSetupListExisting(ctx, server, "/")
	if err != nil {
		return nil
	}
	entry, found, err := quickFindEntry(entries, "server-icon.png")
	if err != nil || !found || !quickFileEntry(entry) || num(entry["size"]) > 256<<10 {
		return nil
	}
	response, err := a.daemonServer(ctx, server, http.MethodGet, "/files/contents?"+url.Values{"file": {"/server-icon.png"}}.Encode(), nil)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (256<<10)+1))
	if err != nil || len(data) > 256<<10 {
		return nil
	}
	return serverArtworkPNG(data, true)
}

func (a *App) clientArtwork(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	asset := r.PathValue("asset")
	permission := ""
	if asset == "icon" {
		permission = "file.read-content"
	} else if asset != "pack" {
		fail(w, notFound())
		return
	}
	server, err := a.server(r, permission)
	if err != nil {
		fail(w, err)
		return
	}
	egg, err := a.serverEffectiveEgg(r.Context(), server)
	if err != nil {
		fail(w, err)
		return
	}
	if !serverArtworkMinecraftEgg(egg) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	key := fmt.Sprintf("%s:%v:%s", server["uuid"], server["node_id"], asset)
	ttl := 30 * time.Second
	var load func() []byte
	if asset == "icon" {
		load = func() []byte { return a.minecraftServerIcon(ctx, server) }
	} else {
		address := mcContentIcon(str(asMap(server["minecraft_pack"])["icon_url"]))
		if address == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		key += ":" + address
		ttl = time.Hour
		load = func() []byte {
			data, err := a.minecraftProviderBytes(ctx, address, "", 4<<20, []string{"cdn.modrinth.com", "media.forgecdn.net", "mediafilez.forgecdn.net"})
			if err != nil {
				return nil
			}
			return serverArtworkPNG(data, false)
		}
	}
	data := a.artworkCache.get(ctx, key, ttl, load)
	if len(data) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(data))
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
