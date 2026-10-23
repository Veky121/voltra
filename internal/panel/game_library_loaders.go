package panel

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

var minecraftLoaders = []M{{"id": "vanilla", "name": "Vanilla"}, {"id": "paper", "name": "Paper · plugins"}, {"id": "fabric", "name": "Fabric"}, {"id": "forge", "name": "Forge"}, {"id": "neoforge", "name": "NeoForge"}, {"id": "quilt", "name": "Quilt"}}

type minecraftLoaderVersion struct {
	ID       string            `json:"id"`
	Stable   bool              `json:"stable"`
	Download minecraftDownload `json:"-"`
	Java     int               `json:"-"`
}
type minecraftPlan struct {
	Version       string                 `json:"version"`
	Loader        string                 `json:"loader"`
	LoaderVersion string                 `json:"loader_version"`
	Java          int                    `json:"java"`
	Files         []minecraftDownload    `json:"files"`
	Installer     *minecraftDownload     `json:"installer,omitempty"`
	Archives      []minecraftPackArchive `json:"archives,omitempty"`
	Launch        string                 `json:"launch"`
	Provider      string                 `json:"-"`
	ProjectID     string                 `json:"-"`
	PackVersionID string                 `json:"-"`
	PackArtwork   *minecraftPackArtwork  `json:"-"`
}
type minecraftPackArchive struct {
	File     minecraftDownload `json:"file"`
	Prefixes []string          `json:"prefixes"`
}

func minecraftLoaderKnown(loader string) bool {
	for _, v := range minecraftLoaders {
		if v["id"] == loader {
			return true
		}
	}
	return false
}

func (a *App) gameLibraryLoaderVersions(w http.ResponseWriter, r *http.Request) {
	if _, err := a.user(r); err != nil {
		fail(w, err)
		return
	}
	loader, version := r.URL.Query().Get("loader"), r.URL.Query().Get("version")
	if !minecraftLoaderKnown(loader) || !minecraftID.MatchString(version) {
		fail(w, bad("Select an available loader and Minecraft version."))
		return
	}
	metadata, _, err := a.minecraftRelease(r.Context(), version)
	if err != nil {
		fail(w, err)
		return
	}
	versions, recommended, err := a.minecraftLoaderVersions(r.Context(), loader, metadata.ID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("minecraft_loader_versions", M{"versions": versions, "recommended": recommended}))
}

func (a *App) minecraftLoaderVersions(ctx context.Context, loader, version string) ([]minecraftLoaderVersion, string, error) {
	versions := []minecraftLoaderVersion{}
	if !minecraftLoaderKnown(loader) || !minecraftID.MatchString(version) {
		return versions, "", bad("Select an available loader and Minecraft version.")
	}
	recommended := ""
	switch loader {
	case "vanilla":
		return []minecraftLoaderVersion{{ID: version, Stable: true}}, version, nil
	case "paper":
		var builds []struct {
			ID      int    `json:"id"`
			Channel string `json:"channel"`
			Java    struct {
				Version struct {
					Minimum int `json:"minimum"`
				} `json:"version"`
			} `json:"java"`
			Downloads map[string]struct {
				URL       string            `json:"url"`
				Checksums map[string]string `json:"checksums"`
			} `json:"downloads"`
		}
		err := a.minecraftProviderJSON(ctx, "https://fill.papermc.io/v3/projects/paper/versions/"+url.PathEscape(version)+"/builds", "", &builds)
		if err != nil {
			return versions, "", err
		}
		for _, b := range builds {
			d, ok := b.Downloads["server:default"]
			if !ok {
				continue
			}
			versions = append(versions, minecraftLoaderVersion{ID: strconv.Itoa(b.ID), Stable: b.Channel == "STABLE", Java: b.Java.Version.Minimum, Download: minecraftDownload{URL: d.URL, Hash: d.Checksums["sha256"], Algorithm: "sha256", Path: "server.jar"}})
		}
	case "fabric", "quilt":
		base := "https://meta.fabricmc.net/v2"
		if loader == "quilt" {
			base = "https://meta.quiltmc.org/v3"
		}
		var rows []struct {
			Loader struct {
				Version string `json:"version"`
				Stable  bool   `json:"stable"`
			} `json:"loader"`
		}
		if err := a.minecraftProviderJSON(ctx, base+"/versions/loader/"+url.PathEscape(version), "", &rows); err != nil {
			return versions, "", err
		}
		for _, row := range rows {
			if minecraftID.MatchString(row.Loader.Version) {
				versions = append(versions, minecraftLoaderVersion{ID: row.Loader.Version, Stable: row.Loader.Stable || loader == "quilt" && !strings.Contains(row.Loader.Version, "beta")})
			}
		}
	case "forge", "neoforge":
		address := "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
		if loader == "neoforge" {
			address = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
		}
		data, err := a.minecraftProviderBytes(ctx, address, "", 8<<20, minecraftAPIHosts)
		if err != nil {
			return versions, "", err
		}
		var metadata struct {
			Versions []string `xml:"versioning>versions>version"`
		}
		if xml.Unmarshal(data, &metadata) != nil {
			return versions, "", bad("The loader returned invalid version metadata.")
		}
		for _, v := range metadata.Versions {
			id := v
			if loader == "forge" {
				if !strings.HasPrefix(v, version+"-") {
					continue
				}
				id = strings.TrimPrefix(v, version+"-")
			} else if !minecraftNeoVersion(v, version) {
				continue
			}
			if minecraftID.MatchString(id) {
				versions = append(versions, minecraftLoaderVersion{ID: id, Stable: !strings.Contains(id, "beta") && !strings.Contains(id, "alpha") && !strings.Contains(id, "rc")})
			}
		}
		sort.SliceStable(versions, func(i, j int) bool { return minecraftVersionLess(versions[j].ID, versions[i].ID) })
		if loader == "forge" {
			var promotions struct {
				Promos map[string]string `json:"promos"`
			}
			if err := a.minecraftProviderJSON(ctx, "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json", "", &promotions); err != nil {
				return versions, "", err
			}
			recommended = promotions.Promos[version+"-recommended"]
			if recommended == "" {
				recommended = promotions.Promos[version+"-latest"]
			}
		}
	}
	if recommended != "" {
		found := false
		for _, v := range versions {
			found = found || v.ID == recommended
		}
		if !found {
			recommended = ""
		}
	}
	if recommended == "" {
		for _, v := range versions {
			if v.Stable {
				recommended = v.ID
				break
			}
		}
	}
	if recommended == "" && len(versions) > 0 {
		recommended = versions[0].ID
	}
	return versions, recommended, nil
}

func minecraftVersionLess(a, b string) bool {
	aa, bb := strings.FieldsFunc(a, func(r rune) bool { return r == '.' || r == '-' }), strings.FieldsFunc(b, func(r rune) bool { return r == '.' || r == '-' })
	for i := 0; i < len(aa) && i < len(bb); i++ {
		an, ae := strconv.Atoi(aa[i])
		bn, be := strconv.Atoi(bb[i])
		if ae == nil && be == nil {
			if an != bn {
				return an < bn
			}
		} else if aa[i] != bb[i] {
			return aa[i] < bb[i]
		}
	}
	return len(aa) < len(bb)
}

func minecraftNeoVersion(loader, game string) bool {
	parts := strings.Split(game, ".")
	if len(parts) < 2 {
		return false
	}
	if parts[0] != "1" {
		if len(parts) == 2 {
			parts = append(parts, "0")
		}
		return strings.HasPrefix(loader, strings.Join(parts, ".")+".")
	}
	patch := "0"
	if len(parts) > 2 {
		patch = parts[2]
	}
	// NeoForge's modern version is <Minecraft minor>.<patch>.<build>.
	return strings.HasPrefix(loader, parts[1]+"."+patch+".")
}

func (a *App) minecraftMavenDownload(ctx context.Context, address, path string) (minecraftDownload, error) {
	file := minecraftDownload{URL: address, Path: path, Algorithm: "sha1"}
	if !minecraftOfficialURL(address, minecraftDownloadHosts...) {
		return file, bad("The loader returned an unsupported installer address.")
	}
	raw, err := a.minecraftProviderBytes(ctx, address+".sha1", "", 4096, minecraftAPIHosts)
	if err != nil {
		return file, err
	}
	fields := strings.Fields(string(raw))
	if len(fields) > 0 {
		file.Hash = strings.ToLower(fields[0])
	}
	if !minecraftHashValid(file.Algorithm, file.Hash) {
		return file, bad("The loader did not supply a valid installer checksum.")
	}
	return file, nil
}

func (a *App) minecraftBuildPlan(ctx context.Context, version, loader, selected string) (minecraftPlan, error) {
	metadata, _, err := a.minecraftRelease(ctx, version)
	if err != nil {
		return minecraftPlan{}, err
	}
	if loader == "" {
		loader = "vanilla"
	}
	plan := minecraftPlan{Version: metadata.ID, Loader: loader, Java: metadata.JavaVersion.MajorVersion, Launch: "-jar server.jar", Files: []minecraftDownload{}}
	vanilla := minecraftDownload{URL: metadata.Downloads.Server.URL, Hash: metadata.Downloads.Server.SHA1, Algorithm: "sha1", Path: "server.jar"}
	versions, recommended, err := a.minecraftLoaderVersions(ctx, loader, metadata.ID)
	if err != nil {
		return plan, err
	}
	if selected == "" || selected == "recommended" || selected == "stable" {
		selected = recommended
	}
	if selected == "latest" && len(versions) > 0 {
		selected = versions[0].ID
	}
	var choice *minecraftLoaderVersion
	for i := range versions {
		if versions[i].ID == selected {
			choice = &versions[i]
			break
		}
	}
	if choice == nil {
		return plan, bad("Select an available loader version for this Minecraft release.")
	}
	plan.LoaderVersion = selected
	if choice.Java > plan.Java {
		plan.Java = choice.Java
	}
	switch loader {
	case "vanilla":
		plan.Files = append(plan.Files, vanilla)
	case "paper":
		if !minecraftOfficialURL(choice.Download.URL, "fill-data.papermc.io") || !minecraftHashValid("sha256", choice.Download.Hash) {
			return plan, bad("Paper did not supply a verified server download.")
		}
		plan.Files = append(plan.Files, choice.Download)
	case "fabric", "quilt":
		base := "https://meta.fabricmc.net/v2"
		if loader == "quilt" {
			base = "https://meta.quiltmc.org/v3"
			if plan.Java < 17 {
				plan.Java = 17
			}
		}
		var installers []struct {
			URL     string            `json:"url"`
			Version string            `json:"version"`
			Stable  bool              `json:"stable"`
			Hashes  map[string]string `json:"hashes"`
		}
		if err = a.minecraftProviderJSON(ctx, base+"/versions/installer", "", &installers); err != nil {
			return plan, err
		}
		if len(installers) == 0 {
			return plan, bad("No installer is available for this loader.")
		}
		installer := installers[0]
		if loader == "fabric" {
			for _, v := range installers {
				if v.Stable {
					installer = v
					break
				}
			}
		}
		file, e := a.minecraftMavenDownload(ctx, installer.URL, ".voltra-installer.jar")
		if e != nil {
			return plan, e
		}
		plan.Installer = &file
		plan.Files = append(plan.Files, vanilla)
		plan.Launch = "-jar " + loader + "-server-launch.jar"
	case "forge", "neoforge":
		full := metadata.ID + "-" + selected
		address := "https://maven.minecraftforge.net/net/minecraftforge/forge/" + full + "/forge-" + full + "-installer.jar"
		plan.Launch = "@libraries/net/minecraftforge/forge/" + full + "/unix_args.txt"
		if loader == "neoforge" {
			address = "https://maven.neoforged.net/releases/net/neoforged/neoforge/" + selected + "/neoforge-" + selected + "-installer.jar"
			plan.Launch = "@libraries/net/neoforged/neoforge/" + selected + "/unix_args.txt"
		}
		if plan.Java <= 8 {
			plan.Launch = "-jar .voltra-forge-server.jar"
		}
		file, e := a.minecraftMavenDownload(ctx, address, ".voltra-installer.jar")
		if e != nil {
			return plan, e
		}
		plan.Installer = &file
		plan.Files = append(plan.Files, vanilla)
	}
	return plan, nil
}

// Mojang did not publish javaVersion on older releases. These release boundaries
// are used only when the per-release metadata omits its Java requirement.
func minecraftFallbackJava(version string) int {
	if !minecraftVersionLess(version, "26.1") {
		return 25
	}
	if !minecraftVersionLess(version, "1.20.5") {
		return 21
	}
	if !minecraftVersionLess(version, "1.18") {
		return 17
	}
	if !minecraftVersionLess(version, "1.17") {
		return 16
	}
	return 8
}

func minecraftEncodePlan(plan minecraftPlan) (string, error) {
	data, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	return minecraftCompressPlan(data)
}

func minecraftPlanStartup(plan minecraftPlan) string {
	return fmt.Sprintf("java -Xms128M -XX:MaxRAMPercentage=80.0 -Dterminal.jline=false -Dterminal.ansi=true %s nogui", plan.Launch)
}
