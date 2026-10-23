package panel

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const minecraftUserAgent = "Voltra-GameLibrary/1.0 (https://github.com/voltra-panel/voltra)"

var minecraftAPIHosts = []string{"piston-meta.mojang.com", "launchermeta.mojang.com", "meta.fabricmc.net", "meta.quiltmc.org", "maven.fabricmc.net", "maven.quiltmc.org", "maven.minecraftforge.net", "files.minecraftforge.net", "maven.neoforged.net", "fill.papermc.io", "api.modrinth.com", "api.curseforge.com"}
var minecraftDownloadHosts = []string{"piston-data.mojang.com", "launcher.mojang.com", "maven.fabricmc.net", "maven.quiltmc.org", "maven.minecraftforge.net", "maven.neoforged.net", "fill-data.papermc.io", "cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net", "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "gitlab.com"}
var minecraftID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$`)

// Each request starts without credentials. Redirects stay inside the caller's
// host set, and API credentials never follow a redirect to another host.
func (a *App) minecraftProviderBytes(ctx context.Context, address, key string, limit int64, hosts []string) ([]byte, error) {
	if !minecraftOfficialURL(address, hosts...) {
		return nil, bad("The provider returned an unsupported download address.")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", minecraftUserAgent)
	if key != "" && req.URL.Host == "api.curseforge.com" {
		req.Header.Set("x-api-key", key)
	}
	client := http.Client{Timeout: 90 * time.Second}
	if a.HTTP != nil {
		client = *a.HTTP
	}
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !minecraftOfficialURL(next.URL.String(), hosts...) {
			return fmt.Errorf("provider redirect rejected")
		}
		if next.URL.Host != "api.curseforge.com" {
			next.Header.Del("x-api-key")
		}
		return nil
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, APIError{502, "MinecraftProviderUnavailable", "The Minecraft provider could not be reached. Try again shortly."}
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return nil, APIError{422, "MinecraftSelectionUnavailable", "This version is not available from the selected provider. Choose another version."}
	}
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return nil, APIError{422, "ProviderAccessDenied", "The provider denied access. Check the global integration key and the project's download permissions."}
	}
	if res.StatusCode != 200 {
		return nil, APIError{502, "MinecraftProviderUnavailable", "The Minecraft provider returned an error. Try again shortly."}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, APIError{502, "MinecraftProviderInvalid", "The provider response exceeded the supported size or could not be read."}
	}
	return data, nil
}

func (a *App) minecraftProviderJSON(ctx context.Context, address, key string, target any) error {
	data, err := a.minecraftProviderBytes(ctx, address, key, 16<<20, minecraftAPIHosts)
	if err != nil {
		return err
	}
	if json.Unmarshal(data, target) != nil {
		return APIError{502, "MinecraftProviderInvalid", "The Minecraft provider returned invalid metadata."}
	}
	return nil
}

func (a *App) minecraftCurseKey(ctx context.Context) (string, error) {
	records, err := a.query(ctx, "SELECT * FROM integrations WHERE provider='curseforge' AND enabled=true AND egg_id IS NULL ORDER BY id")
	if err != nil {
		return "", err
	}
	key := ""
	for _, row := range records {
		credentials, err := a.integrationCredentials(row)
		if err != nil {
			return "", err
		}
		if value := str(credentials["api_key"]); value != "" {
			if key != "" {
				return "", bad("More than one global CurseForge key is enabled. Disable the extra integration.")
			}
			key = value
		}
	}
	if key == "" {
		return "", APIError{422, "CurseForgeMissingKey", "Add an enabled global CurseForge API key in Integrations to browse or install CurseForge packs."}
	}
	return key, nil
}

type minecraftDownload struct {
	URL       string `json:"url"`
	Path      string `json:"path"`
	Hash      string `json:"hash"`
	Algorithm string `json:"algorithm"`
}

func minecraftHashValid(algorithm, hash string) bool {
	size := map[string]int{"sha1": 40, "sha256": 64, "sha512": 128}[algorithm]
	decoded, err := hex.DecodeString(hash)
	return size > 0 && len(hash) == size && err == nil && len(decoded) == size/2
}

func minecraftVerify(data []byte, file minecraftDownload) error {
	if !minecraftHashValid(file.Algorithm, file.Hash) {
		return bad("The provider did not supply a supported checksum.")
	}
	var actual string
	switch file.Algorithm {
	case "sha1":
		h := sha1.Sum(data)
		actual = hex.EncodeToString(h[:])
	case "sha256":
		h := sha256.Sum256(data)
		actual = hex.EncodeToString(h[:])
	case "sha512":
		h := sha512.Sum512(data)
		actual = hex.EncodeToString(h[:])
	}
	if !strings.EqualFold(actual, file.Hash) {
		return APIError{502, "MinecraftChecksumMismatch", "The provider download did not match its checksum. Try again later."}
	}
	return nil
}

func (a *App) minecraftFetchArchive(ctx context.Context, file minecraftDownload) ([]byte, error) {
	data, err := a.minecraftProviderBytes(ctx, file.URL, "", 512<<20, minecraftDownloadHosts)
	if err != nil {
		return nil, err
	}
	if err = minecraftVerify(data, file); err != nil {
		return nil, err
	}
	return data, nil
}

func minecraftQuery(address string, values url.Values) string { return address + "?" + values.Encode() }
