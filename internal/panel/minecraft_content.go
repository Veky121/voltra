package panel

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const mcContentMaxFile = 64 << 20
const mcContentMaxTotal = 128 << 20

var mcContentID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)
var mcContentVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+(?:\.[0-9]+)?$`)
var mcContentLocks [64]sync.Mutex

type mcContentInfo struct {
	Version, Loader, LoaderVersion, Kind, Directory string
	Compatibility                                   string
	IncludeUnverified                               bool
}
type mcContentProvider struct {
	app              *App
	name, credential string
}
type mcContentDependency struct{ Project, Version, Kind string }
type mcContentRelease struct {
	ID           string                `json:"id"`
	Project      string                `json:"project_id"`
	Name         string                `json:"name"`
	Filename     string                `json:"filename"`
	Published    string                `json:"published"`
	Blocked      string                `json:"blocked_reason,omitempty"`
	URL          string                `json:"-"`
	Hash         string                `json:"-"`
	Algorithm    string                `json:"-"`
	Size         int64                 `json:"size"`
	Dependencies []mcContentDependency `json:"-"`
}

func (a *App) registerMinecraftContent(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/servers/{server}/minecraft/content", a.mcContentCatalog)
	mux.HandleFunc("GET /api/client/servers/{server}/minecraft/content/{provider}/{project}/versions", a.mcContentVersions)
	mux.HandleFunc("POST /api/client/servers/{server}/minecraft/content/install", a.mcContentInstall)
	mux.HandleFunc("DELETE /api/client/servers/{server}/minecraft/content/file", a.mcContentRemove)
}

func mcContentEnvironment(env M) (mcContentInfo, string) {
	info := mcContentInfo{Version: str(env["MINECRAFT_VERSION"]), Loader: strings.ToLower(str(env["MINECRAFT_LOADER"])), LoaderVersion: str(env["MINECRAFT_LOADER_VERSION"])}
	if info.Loader == "" {
		info.Loader = strings.ToLower(strings.TrimSpace(str(env["ARCLIGHT_LOADER"])))
	}
	if info.Version == "" {
		info.Version = strings.TrimSpace(str(env["MC_VERSION"]))
		if info.Version == "" {
			info.Version = strings.TrimSpace(str(env["DL_VERSION"]))
		}
		if info.LoaderVersion == "" {
			info.LoaderVersion = strings.TrimSpace(str(env["LOADER_VERSION"]))
		}
		if info.Loader == "forge" && strings.TrimSpace(str(env["FORGE_VERSION"])) != "" {
			full := strings.TrimSpace(str(env["FORGE_VERSION"]))
			parts := strings.SplitN(full, "-", 2)
			info.Version, info.LoaderVersion = "", full
			if len(parts) == 2 && mcContentVersion.MatchString(parts[0]) && minecraftID.MatchString(parts[1]) {
				info.Version = parts[0]
			}
		}
		if info.Loader == "neoforge" && strings.TrimSpace(str(env["NEOFORGE_VERSION"])) != "" {
			info.LoaderVersion = strings.TrimSpace(str(env["NEOFORGE_VERSION"]))
			info.Version = mcContentNeoMinecraft(info.LoaderVersion)
		}
	}
	if !mcContentVersion.MatchString(info.Version) {
		return info, "This server has no resolved Minecraft version. Install a managed Minecraft server to use the catalog."
	}
	switch info.Loader {
	case "fabric", "forge", "neoforge", "quilt":
		info.Kind, info.Directory = "mod", "/mods"
	case "paper", "folia", "spigot":
		info.Kind, info.Directory = "plugin", "/plugins"
	case "vanilla":
		return info, "Vanilla Minecraft does not load mods or plugins. Create a server with a mod loader or Paper."
	default:
		return info, "This egg does not declare a supported Minecraft loader."
	}
	return info, ""
}

// NeoForge used Minecraft-prefixed Forge IDs for 1.20.1, minor.patch.build
// through 1.21, then year.release.patch.build IDs from Minecraft 26 onward.
func mcContentNeoMinecraft(loader string) string {
	if strings.HasPrefix(loader, "1.20.1-") && minecraftID.MatchString(loader) {
		return "1.20.1"
	}
	parts := strings.Split(strings.SplitN(loader, "-", 2)[0], ".")
	if len(parts) < 3 || !minecraftID.MatchString(loader) {
		return ""
	}
	values := make([]int, len(parts))
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return ""
		}
		values[i] = n
	}
	if values[0] >= 26 && len(values) == 4 {
		version := parts[0] + "." + parts[1]
		if values[2] != 0 {
			version += "." + parts[2]
		}
		return version
	}
	if values[0] >= 20 && values[0] <= 25 && len(values) == 3 {
		version := "1." + parts[0]
		if values[1] != 0 {
			version += "." + parts[1]
		}
		return version
	}
	return ""
}

func (a *App) mcContentInfo(ctx context.Context, s M) (mcContentInfo, string, error) {
	rows, err := a.query(ctx, `SELECT ev.env_variable,COALESCE(sv.variable_value,ev.default_value) AS value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 AND ev.env_variable IN ('MINECRAFT_VERSION','MINECRAFT_LOADER','MINECRAFT_LOADER_VERSION','MC_VERSION','DL_VERSION','LOADER_VERSION','FORGE_VERSION','NEOFORGE_VERSION','ARCLIGHT_LOADER') ORDER BY ev.id`, s["id"], s["egg_id"])
	if err != nil {
		return mcContentInfo{}, "", err
	}
	env := M{}
	for _, row := range rows {
		name := str(row["env_variable"])
		if old, ok := env[name]; ok && old != row["value"] {
			return mcContentInfo{}, "This egg has conflicting Minecraft variables.", nil
		}
		env[name] = row["value"]
	}
	info, reason := mcContentEnvironment(env)
	return info, reason, nil
}

func (a *App) mcContentProvider(ctx context.Context, name string) (mcContentProvider, error) {
	p := mcContentProvider{app: a, name: name}
	if name != "modrinth" && name != "curseforge" {
		return p, bad("Choose Modrinth or CurseForge.")
	}
	rows, err := a.query(ctx, "SELECT * FROM integrations WHERE enabled=true AND egg_id IS NULL AND provider=$1 ORDER BY id", name)
	if err != nil {
		return p, err
	}
	field := "api_token"
	if name == "curseforge" {
		field = "api_key"
	}
	for _, row := range rows {
		credentials, e := a.integrationCredentials(row)
		if e != nil {
			return p, APIError{503, "ContentProviderConfiguration", "The global provider credential could not be loaded. Ask an administrator to save it again."}
		}
		value := str(credentials[field])
		if value == "" {
			continue
		}
		if p.credential != "" {
			return p, bad("Multiple global provider credentials are enabled. Ask an administrator to keep one enabled.")
		}
		p.credential = value
	}
	if name == "curseforge" && p.credential == "" {
		return p, APIError{503, "ContentProviderConfiguration", "Ask an administrator to save an enabled global CurseForge API key in Integrations."}
	}
	return p, nil
}

func mcContentAllowedURL(raw string, hosts ...string) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	for _, host := range hosts {
		if u.Host == host {
			return true
		}
	}
	return false
}

func (p mcContentProvider) request(ctx context.Context, endpoint string, target any) error {
	base := "https://api.modrinth.com/v2"
	host := "api.modrinth.com"
	if p.name == "curseforge" {
		base = "https://api.curseforge.com/v1"
		host = "api.curseforge.com"
	}
	address := base + endpoint
	if !strings.HasPrefix(endpoint, "/") || !mcContentAllowedURL(address, host) {
		return bad("Invalid provider metadata address.")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, "GET", address, nil)
	if e != nil {
		return e
	}
	req.Header.Set("User-Agent", "Voltra-MinecraftContent/1.0")
	req.Header.Set("Accept", "application/json")
	if p.credential != "" {
		if p.name == "curseforge" {
			req.Header.Set("x-api-key", p.credential)
		} else {
			req.Header.Set("Authorization", p.credential)
		}
	}
	client := p.client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("metadata redirects are disabled") }
	res, e := client.Do(req)
	if e != nil {
		return APIError{502, "ContentProviderUnavailable", "The content provider could not be reached. Try again shortly."}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return APIError{502, "ContentProviderUnavailable", fmt.Sprintf("The content provider returned HTTP %d. Check its availability and the global credential.", res.StatusCode)}
	}
	data, e := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if e != nil || len(data) > 4<<20 || json.Unmarshal(data, target) != nil {
		return APIError{502, "ContentProviderMetadata", "The content provider returned invalid or oversized metadata."}
	}
	return nil
}
func (p mcContentProvider) client() http.Client {
	if p.app.HTTP != nil {
		return *p.app.HTTP
	}
	return http.Client{}
}
func mcContentContains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func mcContentStrings(value any) []string {
	out := []string{}
	for _, v := range asSlice(value) {
		out = append(out, str(v))
	}
	return out
}
func mcContentServerSide(value string) bool { return value == "required" || value == "optional" }

var mcContentServerEnvironments = []string{"client_and_server", "client_only_server_optional", "server_only", "server_only_client_optional", "dedicated_server_only", "client_or_server", "client_or_server_prefers_both"}

func mcContentIndependentEnvironment(value string) bool {
	return value == "server_only" || value == "server_only_client_optional" || value == "dedicated_server_only" || value == "client_or_server" || value == "client_or_server_prefers_both"
}

// New environment metadata is authoritative. Legacy fields are a fallback only
// when the provider has not supplied a known environment.
func mcContentProjectCompatibility(row M) string {
	known, supported, independent, both, optional := false, false, true, false, false
	for _, environment := range mcContentStrings(row["environment"]) {
		if environment == "unknown" || environment == "" {
			continue
		}
		known = true
		if !mcContentContains(mcContentServerEnvironments, environment) {
			independent = false
			continue
		}
		supported = true
		independent = independent && mcContentIndependentEnvironment(environment)
		both = both || environment == "client_and_server"
		optional = optional || environment == "client_only_server_optional"
	}
	if known {
		if !supported {
			return "unsupported"
		}
		if independent {
			return "server_only"
		}
		if both && !optional {
			return "client_and_server"
		}
		if optional && !both {
			return "server_optional"
		}
		return "server_compatible"
	}
	if !mcContentServerSide(str(row["server_side"])) {
		return "unsupported"
	}
	client := str(row["client_side"])
	if client == "unsupported" || client == "optional" {
		return "server_only"
	}
	if client == "required" {
		if row["server_side"] == "required" {
			return "client_and_server"
		}
		return "server_optional"
	}
	return "server_compatible"
}

func mcContentMatchesCompatibility(row M, filter string) bool {
	compatibility := mcContentProjectCompatibility(row)
	return compatibility != "unsupported" && (filter != "server_only" || compatibility == "server_only")
}

func mcContentFilter(r *http.Request, info *mcContentInfo) error {
	info.Compatibility = r.URL.Query().Get("compatibility")
	if info.Compatibility == "" {
		info.Compatibility = "server"
	}
	if info.Compatibility != "server" && info.Compatibility != "server_only" {
		return bad("Choose server-compatible or server-only content.")
	}
	unknown := r.URL.Query().Get("include_unverified")
	if unknown != "" && unknown != "true" && unknown != "false" {
		return bad("include_unverified must be true or false.")
	}
	info.IncludeUnverified = unknown == "true"
	return nil
}
func mcContentVersionEnvironment(row M) bool {
	value, present := row["environment"]
	if !present {
		return true
	} // Legacy v2 files rely on the project's explicit server_side declaration.
	switch str(value) {
	case "unknown":
		return true // v2 projects such as LuckPerms retain explicit server_side while legacy versions report unknown.
	case "client_and_server", "client_only_server_optional", "server_only", "server_only_client_optional", "dedicated_server_only", "client_or_server", "client_or_server_prefers_both":
		return true
	default:
		return false
	}
}
func mcContentSafeFilename(name string) bool {
	if len(name) < 5 || len(name) > 180 || !strings.HasSuffix(strings.ToLower(name), ".jar") || strings.TrimSpace(name) != name || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\:%\x00\r\n") || path.Base(name) != name {
		return false
	}
	for _, r := range name {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}
func mcContentCFLoader(loader string) string {
	return map[string]string{"forge": "1", "fabric": "4", "quilt": "5", "neoforge": "6"}[loader]
}
func mcContentUnknownPlugin(info mcContentInfo) bool {
	return info.Kind == "plugin" && (info.Loader == "folia" || info.Loader == "spigot")
}
func mcContentProviderWarning(provider string, info mcContentInfo) string {
	if provider == "curseforge" && info.Loader == "folia" {
		return "CurseForge does not report Folia region scheduling compatibility. Check the author's Folia support before installing."
	}
	if provider == "curseforge" && info.Loader == "spigot" {
		return "CurseForge does not establish Spigot API compatibility. Some plugins require Paper. Check the author's explicit Spigot support before installing."
	}
	if provider == "curseforge" && info.Kind == "mod" {
		return "CurseForge does not report whether a mod supports dedicated servers. Check the author's instructions before installing. Server compatibility is unknown."
	}
	return ""
}

func (p mcContentProvider) search(ctx context.Context, info mcContentInfo, query string) ([]M, error) {
	out := []M{}
	if p.name == "curseforge" && (info.Kind == "mod" || mcContentUnknownPlugin(info)) && (!info.IncludeUnverified || info.Compatibility == "server_only") {
		return out, nil
	}
	if p.name == "modrinth" {
		// Paper plugins are categorized as mods in Modrinth API v2. The loader facet identifies plugins.
		environments := []string{}
		for _, environment := range mcContentServerEnvironments {
			if info.Compatibility != "server_only" || mcContentIndependentEnvironment(environment) {
				environments = append(environments, "environment:"+environment)
			}
		}
		// Older projects still report unknown here; require their legacy server
		// declaration in the response filter instead of hiding them outright.
		environments = append(environments, "environment:unknown")
		facets, _ := json.Marshal([][]string{{"project_type:mod"}, {"versions:" + info.Version}, {"categories:" + info.Loader}, environments})
		var response struct {
			Hits []M `json:"hits"`
		}
		e := p.request(ctx, "/search?"+url.Values{"query": {query}, "facets": {string(facets)}, "limit": {"20"}}.Encode(), &response)
		if e != nil {
			return nil, e
		}
		for _, hit := range response.Hits {
			if !mcContentID.MatchString(str(hit["project_id"])) || !mcContentMatchesCompatibility(hit, info.Compatibility) || !mcContentContains(mcContentStrings(hit["versions"]), info.Version) || !mcContentContains(append(mcContentStrings(hit["categories"]), mcContentStrings(hit["display_categories"])...), info.Loader) {
				continue
			}
			out = append(out, M{"id": str(hit["project_id"]), "name": hit["title"], "summary": hit["description"], "icon_url": mcContentIcon(str(hit["icon_url"])), "author": hit["author"], "compatibility": mcContentProjectCompatibility(hit), "project_url": "https://modrinth.com/project/" + str(hit["project_id"])})
		}
	} else {
		class := "6"
		if info.Kind == "plugin" {
			class = "5"
		}
		q := url.Values{"gameId": {"432"}, "classId": {class}, "gameVersion": {info.Version}, "searchFilter": {query}, "pageSize": {"20"}, "sortField": {"2"}, "sortOrder": {"desc"}}
		if info.Kind == "mod" {
			q.Set("modLoaderType", mcContentCFLoader(info.Loader))
		}
		var response struct {
			Data []M `json:"data"`
		}
		if e := p.request(ctx, "/mods/search?"+q.Encode(), &response); e != nil {
			return nil, e
		}
		for _, hit := range response.Data {
			if num(hit["gameId"]) != 432 || str(hit["classId"]) != class || num(hit["id"]) <= 0 {
				continue
			}
			authors := []string{}
			for _, author := range asSlice(hit["authors"]) {
				authors = append(authors, str(asMap(author)["name"]))
			}
			link := str(asMap(hit["links"])["websiteUrl"])
			if !mcContentAllowedURL(link, "www.curseforge.com", "curseforge.com") {
				link = ""
			}
			unknown := info.Kind == "mod" || mcContentUnknownPlugin(info)
			out = append(out, M{"id": str(hit["id"]), "name": hit["name"], "summary": hit["summary"], "icon_url": mcContentIcon(str(asMap(hit["logo"])["thumbnailUrl"])), "author": strings.Join(authors, ", "), "compatibility": map[bool]string{true: "unknown", false: "server_only"}[unknown], "server_compatibility_unknown": unknown, "project_url": link})
		}
	}
	return out, nil
}
func mcContentIcon(raw string) string {
	if mcContentAllowedURL(raw, "cdn.modrinth.com", "media.forgecdn.net", "mediafilez.forgecdn.net") {
		return raw
	}
	return ""
}

func (p mcContentProvider) project(ctx context.Context, info mcContentInfo, id string) (string, error) {
	if p.name == "curseforge" && mcContentUnknownPlugin(info) && (!info.IncludeUnverified || info.Compatibility == "server_only") {
		return "", bad("CurseForge plugin API compatibility is unknown. Enable unverified results and check the author's support for this server.")
	}
	if !mcContentID.MatchString(id) {
		return "", bad("Invalid project ID.")
	}
	if p.name == "modrinth" {
		var project M
		if e := p.request(ctx, "/project/"+id, &project); e != nil {
			return "", e
		}
		if !mcContentMatchesCompatibility(project, info.Compatibility) || str(project["project_type"]) != "mod" {
			return "", bad("This project does not declare server support for this content type.")
		}
		if !mcContentContains(mcContentStrings(project["loaders"]), info.Loader) || !mcContentContains(mcContentStrings(project["game_versions"]), info.Version) {
			return "", bad("This project does not support this Minecraft version and loader.")
		}
		return str(project["id"]), nil
	}
	numeric, e := strconv.ParseInt(id, 10, 64)
	if e != nil || numeric <= 0 {
		return "", bad("Invalid CurseForge project ID.")
	}
	var response struct {
		Data M `json:"data"`
	}
	if e = p.request(ctx, "/mods/"+id, &response); e != nil {
		return "", e
	}
	class := int64(6)
	if info.Kind == "plugin" {
		class = 5
	}
	if num(response.Data["id"]) != numeric || num(response.Data["gameId"]) != 432 || num(response.Data["classId"]) != class || response.Data["allowModDistribution"] == false {
		return "", bad("This project is not available for this server or its author has disabled distribution.")
	}
	return id, nil
}

func (p mcContentProvider) releases(ctx context.Context, info mcContentInfo, project string) ([]mcContentRelease, error) {
	id, e := p.project(ctx, info, project)
	if e != nil {
		return nil, e
	}
	if p.name == "modrinth" {
		loaders, _ := json.Marshal([]string{info.Loader})
		versions, _ := json.Marshal([]string{info.Version})
		var response []M
		if e = p.request(ctx, "/project/"+id+"/version?"+url.Values{"loaders": {string(loaders)}, "game_versions": {string(versions)}}.Encode(), &response); e != nil {
			return nil, e
		}
		return p.parseReleases(info, id, response), nil
	}
	q := url.Values{"gameVersion": {info.Version}, "pageSize": {"50"}}
	if info.Kind == "mod" {
		q.Set("modLoaderType", mcContentCFLoader(info.Loader))
	}
	var response struct {
		Data []M `json:"data"`
	}
	if e = p.request(ctx, "/mods/"+id+"/files?"+q.Encode(), &response); e != nil {
		return nil, e
	}
	return p.parseReleases(info, id, response.Data), nil
}
func (p mcContentProvider) release(ctx context.Context, info mcContentInfo, project, version string) (mcContentRelease, error) {
	if !mcContentID.MatchString(version) {
		return mcContentRelease{}, bad("Invalid version ID.")
	}
	id, e := p.project(ctx, info, project)
	if e != nil {
		return mcContentRelease{}, e
	}
	var row M
	if p.name == "modrinth" {
		e = p.request(ctx, "/version/"+version, &row)
	} else {
		var response struct {
			Data M `json:"data"`
		}
		e = p.request(ctx, "/mods/"+id+"/files/"+version, &response)
		row = response.Data
	}
	if e != nil {
		return mcContentRelease{}, e
	}
	releases := p.parseReleases(info, id, []M{row})
	if len(releases) != 1 || releases[0].ID != version {
		return mcContentRelease{}, bad("This file does not match the selected project, Minecraft version and loader.")
	}
	return releases[0], nil
}
func (p mcContentProvider) parseReleases(info mcContentInfo, project string, rows []M) []mcContentRelease {
	out := []mcContentRelease{}
	if p.name == "curseforge" && mcContentUnknownPlugin(info) && (!info.IncludeUnverified || info.Compatibility == "server_only") {
		return out
	}
	if p.name == "curseforge" && info.Kind == "mod" && info.Compatibility == "server_only" {
		return out
	}
	for _, row := range rows {
		v := mcContentRelease{ID: str(row["id"]), Project: project, Dependencies: []mcContentDependency{}}
		if p.name == "modrinth" {
			if str(row["project_id"]) != project || !mcContentContains(mcContentStrings(row["game_versions"]), info.Version) || !mcContentContains(mcContentStrings(row["loaders"]), info.Loader) || !mcContentVersionEnvironment(row) {
				continue
			}
			if environment := str(row["environment"]); info.Compatibility == "server_only" && environment != "" && environment != "unknown" && !mcContentIndependentEnvironment(environment) {
				continue
			}
			files := asSlice(row["files"])
			var chosen M
			count := 0
			for _, f := range files {
				file := asMap(f)
				if boolean(file["primary"]) {
					chosen = file
					count++
				}
			}
			if count == 0 && len(files) == 1 {
				chosen = asMap(files[0])
				count = 1
			}
			if count != 1 {
				continue
			}
			v.Name = str(row["version_number"])
			v.Published = str(row["date_published"])
			v.Filename = str(chosen["filename"])
			v.URL = str(chosen["url"])
			v.Size = num(chosen["size"])
			hashes := asMap(chosen["hashes"])
			v.Algorithm = "sha512"
			v.Hash = str(hashes["sha512"])
			if v.Hash == "" {
				v.Algorithm = "sha1"
				v.Hash = str(hashes["sha1"])
			}
			for _, dep := range asSlice(row["dependencies"]) {
				d := asMap(dep)
				v.Dependencies = append(v.Dependencies, mcContentDependency{str(d["project_id"]), str(d["version_id"]), str(d["dependency_type"])})
			}
		} else {
			if str(row["modId"]) != project || !boolean(row["isAvailable"]) || !mcContentContains(mcContentStrings(row["gameVersions"]), info.Version) || boolean(row["isServerPack"]) {
				continue
			}
			if info.Kind == "mod" {
				loader := map[string]string{"forge": "Forge", "fabric": "Fabric", "quilt": "Quilt", "neoforge": "NeoForge"}[info.Loader]
				if !mcContentContains(mcContentStrings(row["gameVersions"]), loader) {
					continue
				}
			}
			v.Name = str(row["displayName"])
			v.Published = str(row["fileDate"])
			v.Filename = str(row["fileName"])
			v.URL = str(row["downloadUrl"])
			v.Size = num(row["fileLength"])
			v.Algorithm = "sha1"
			for _, hash := range asSlice(row["hashes"]) {
				h := asMap(hash)
				if num(h["algo"]) == 1 {
					v.Hash = str(h["value"])
				}
			}
			for _, dep := range asSlice(row["dependencies"]) {
				d := asMap(dep)
				kind := "optional"
				switch num(d["relationType"]) {
				case 3:
					kind = "required"
				case 5:
					kind = "incompatible"
				}
				v.Dependencies = append(v.Dependencies, mcContentDependency{Project: str(d["modId"]), Kind: kind})
			}
		}
		if !mcContentID.MatchString(v.ID) {
			continue
		}
		if !mcContentSafeFilename(v.Filename) {
			v.Blocked = "The provider returned an unsafe or non-JAR filename."
		}
		if v.Size <= 0 || v.Size > mcContentMaxFile {
			v.Blocked = "This download exceeds the 64 MiB file limit or has no declared size."
		}
		if !mcContentDownloadURL(p.name, v.URL) {
			v.Blocked = "The author has not supplied a download on a supported provider host."
		}
		if !mcContentHashValid(v.Algorithm, v.Hash) {
			v.Blocked = "The provider has not supplied a supported integrity hash."
		}
		out = append(out, v)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Published > out[j].Published })
	return out
}
func mcContentDownloadURL(provider, raw string) bool {
	if provider == "modrinth" {
		return mcContentAllowedURL(raw, "cdn.modrinth.com")
	}
	if provider == "curseforge" {
		return mcContentAllowedURL(raw, "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net")
	}
	return false
}
func mcContentHashValid(algo, value string) bool {
	n := 128
	if algo == "sha1" {
		n = 40
	} else if algo != "sha512" {
		return false
	}
	b, e := hex.DecodeString(value)
	return e == nil && len(b) == n/2
}

// Resolve all required dependencies before any file writes. No version guessing when pinned dependencies disagree.
func (p mcContentProvider) plan(ctx context.Context, info mcContentInfo, root mcContentRelease) ([]mcContentRelease, error) {
	out := []mcContentRelease{}
	selected := map[string]string{}
	visiting := map[string]bool{}
	names := map[string]bool{}
	var total int64
	var visit func(mcContentRelease) error
	visit = func(v mcContentRelease) error {
		if v.Blocked != "" {
			return bad(v.Blocked)
		}
		if old, ok := selected[v.Project]; ok {
			if old != v.ID {
				return bad("Dependencies require conflicting versions of project " + v.Project + ". Use a compatible modpack or resolve the conflict in Files.")
			}
			if visiting[v.Project] {
				return bad("The provider declares a dependency cycle. Use a compatible modpack instead.")
			}
			return nil
		}
		if len(selected) >= 12 {
			return bad("This install requires more than 12 projects. Use a managed modpack instead.")
		}
		selected[v.Project] = v.ID
		visiting[v.Project] = true
		for _, dep := range v.Dependencies {
			if dep.Kind == "incompatible" {
				return bad("Project " + v.Project + " declares an incompatible dependency " + dep.Project + ". Check and resolve it in Files before installing manually.")
			}
			if dep.Kind != "required" {
				continue
			}
			project := dep.Project
			if project == "" && dep.Version != "" && p.name == "modrinth" {
				var metadata M
				if !mcContentID.MatchString(dep.Version) {
					return bad("Invalid dependency version.")
				}
				if e := p.request(ctx, "/version/"+dep.Version, &metadata); e != nil {
					return e
				}
				project = str(metadata["project_id"])
			}
			if !mcContentID.MatchString(project) {
				return bad("A required dependency has no resolvable project ID. Follow the author's dependency instructions in Files.")
			}
			var next mcContentRelease
			var e error
			if dep.Version != "" {
				next, e = p.release(ctx, info, project, dep.Version)
			} else {
				var versions []mcContentRelease
				versions, e = p.releases(ctx, info, project)
				if e == nil {
					found := false
					for _, version := range versions {
						if version.Blocked == "" {
							next = version
							found = true
							break
						}
					}
					if !found {
						e = bad("No compatible downloadable version of required dependency " + project + " is available. Use another version or a managed modpack.")
					}
				}
			}
			if e != nil {
				return bad("Required dependency " + project + " could not be resolved for this Minecraft version and loader. " + mcContentErrorDetail(e))
			}
			if e = visit(next); e != nil {
				return e
			}
		}
		key := strings.ToLower(v.Filename)
		if names[key] {
			return bad("Two projects use the same filename. Resolve the conflict in Files.")
		}
		names[key] = true
		total += v.Size
		if total > mcContentMaxTotal {
			return bad("The combined download exceeds 128 MiB. Use a managed modpack instead.")
		}
		visiting[v.Project] = false
		out = append(out, v)
		return nil
	}
	e := visit(root)
	return out, e
}
func mcContentErrorDetail(err error) string {
	var api APIError
	if errors.As(err, &api) {
		return api.Detail
	}
	var pointer *APIError
	if errors.As(err, &pointer) {
		return pointer.Detail
	}
	return "The provider could not supply compatible metadata."
}

func (p mcContentProvider) download(ctx context.Context, v mcContentRelease) ([]byte, error) {
	if !mcContentDownloadURL(p.name, v.URL) || !mcContentSafeFilename(v.Filename) || !mcContentHashValid(v.Algorithm, v.Hash) || v.Size <= 0 || v.Size > mcContentMaxFile {
		return nil, bad("The provider returned an invalid download.")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, "GET", v.URL, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("User-Agent", "Voltra-MinecraftContent/1.0")
	client := p.client()
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 || !mcContentDownloadURL(p.name, req.URL.String()) {
			return errors.New("unsupported download redirect")
		}
		req.Header.Del("Authorization")
		req.Header.Del("x-api-key")
		return nil
	}
	res, e := client.Do(req)
	if e != nil {
		return nil, APIError{502, "ContentDownloadFailed", "The provider download failed."}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, APIError{502, "ContentDownloadFailed", "The provider did not return a download."}
	}
	if res.ContentLength > mcContentMaxFile || res.ContentLength > v.Size {
		return nil, bad("The provider download exceeds its declared size.")
	}
	data, e := io.ReadAll(io.LimitReader(res.Body, v.Size+1))
	if e != nil || int64(len(data)) != v.Size {
		return nil, bad("The download size does not match the provider metadata. Nothing was installed.")
	}
	actual := ""
	if v.Algorithm == "sha512" {
		sum := sha512.Sum512(data)
		actual = hex.EncodeToString(sum[:])
	} else {
		sum := sha1.Sum(data)
		actual = hex.EncodeToString(sum[:])
	}
	if !strings.EqualFold(actual, v.Hash) {
		return nil, bad("The download failed its integrity check. Nothing was installed.")
	}
	jar, e := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if e != nil || len(jar.File) == 0 {
		return nil, bad("The provider download is not a valid JAR archive.")
	}
	return data, nil
}

func (a *App) mcContentStopped(ctx context.Context, s M) error {
	res, e := a.daemonServer(ctx, s, "GET", "", nil)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	var m M
	if json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&m) != nil {
		return bad("Wings returned an invalid server state. No files were changed.")
	}
	state := str(m["state"])
	if state != "offline" && state != "stopped" {
		return APIError{409, "MinecraftContentServerRunning", "Stop the server before changing mods or plugins. Changes take effect on the next start."}
	}
	return nil
}
func (a *App) mcContentFiles(ctx context.Context, s M, info mcContentInfo) ([]M, error) {
	res, e := a.daemonServer(ctx, s, "GET", "/files/list-directory?"+url.Values{"directory": {info.Directory}}.Encode(), nil)
	if e != nil {
		var api APIError
		if errors.As(e, &api) && api.Status == 404 {
			return []M{}, nil
		}
		var pointer *APIError
		if errors.As(e, &pointer) && pointer.Status == 404 {
			return []M{}, nil
		}
		return nil, e
	}
	defer res.Body.Close()
	var entries []M
	data, e := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if e != nil || len(data) > 4<<20 || json.Unmarshal(data, &entries) != nil {
		return nil, bad("Wings returned an invalid file listing.")
	}
	for i, entry := range entries {
		if _, normalized := entry["is_file"]; !normalized {
			entries[i] = opFileTransform(entry)
		}
	}
	return entries, nil
}
func mcContentInstalled(entries []M) []M {
	out := []M{}
	for _, f := range entries {
		if boolean(f["is_file"]) && mcContentSafeFilename(str(f["name"])) {
			out = append(out, M{"file": f["name"], "size": f["size"], "modified_at": f["modified_at"]})
		}
	}
	return out
}
func (a *App) mcContentWrite(ctx context.Context, s M, method, suffix string, body any) error {
	res, e := a.daemonServer(ctx, s, method, suffix, body)
	if e != nil {
		return e
	}
	return res.Body.Close()
}
func (a *App) mcContentRequired(r *http.Request, permission string) (M, mcContentInfo, error) {
	s, e := a.server(r, permission)
	if e != nil {
		return nil, mcContentInfo{}, e
	}
	info, reason, e := a.mcContentInfo(r.Context(), s)
	if e != nil {
		return nil, info, e
	}
	if reason != "" {
		return nil, info, bad(reason)
	}
	return s, info, nil
}

func (a *App) mcContentCatalog(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "file.read")
	if e != nil {
		fail(w, e)
		return
	}
	info, reason, e := a.mcContentInfo(r.Context(), s)
	if e != nil {
		fail(w, e)
		return
	}
	if e = mcContentFilter(r, &info); e != nil {
		fail(w, e)
		return
	}
	provider := r.URL.Query().Get("provider")
	if provider == "" {
		provider = "modrinth"
	}
	if provider != "modrinth" && provider != "curseforge" {
		fail(w, bad("Choose Modrinth or CurseForge."))
		return
	}
	user, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	result := M{"supported": reason == "", "reason": reason, "provider": provider, "minecraft_version": info.Version, "loader": info.Loader, "loader_version": info.LoaderVersion, "content_type": info.Kind, "projects": []M{}, "installed": []M{}, "can_install": a.can(r.Context(), user, s, "file.create"), "can_remove": a.can(r.Context(), user, s, "file.delete"), "provider_available": false, "provider_message": mcContentProviderWarning(provider, info)}
	result["compatibility"], result["include_unverified"] = info.Compatibility, info.IncludeUnverified
	result["server_compatibility_unknown"] = provider == "curseforge" && (info.Kind == "mod" || mcContentUnknownPlugin(info))
	if provider == "curseforge" && info.Kind == "mod" && !info.IncludeUnverified {
		result["provider_message"] = "CurseForge does not report server compatibility. Unverified mods are hidden. Enable unverified results to browse them."
	}
	if provider == "curseforge" && mcContentUnknownPlugin(info) && !info.IncludeUnverified {
		result["provider_message"] = mcContentProviderWarning(provider, info) + " Unverified plugins are hidden. Enable unverified results to browse them."
	}
	if reason != "" {
		writeJSON(w, 200, item("minecraft_content", result))
		return
	}
	kind := r.URL.Query().Get("type")
	if kind != "" && kind != info.Kind {
		fail(w, bad("This server supports "+info.Kind+" content only."))
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	if len(query) > 150 {
		fail(w, bad("Keep searches under 150 characters."))
		return
	}
	entries, e := a.mcContentFiles(r.Context(), s, info)
	if e != nil {
		fail(w, e)
		return
	}
	result["installed"] = mcContentInstalled(entries)
	p, e := a.mcContentProvider(r.Context(), provider)
	if e != nil {
		result["provider_message"] = mcContentErrorDetail(e)
		writeJSON(w, 200, item("minecraft_content", result))
		return
	}
	projects, e := p.search(r.Context(), info, query)
	if e != nil {
		result["provider_message"] = mcContentErrorDetail(e)
	} else {
		result["provider_available"] = true
		result["projects"] = projects
	}
	writeJSON(w, 200, item("minecraft_content", result))
}
func (a *App) mcContentVersions(w http.ResponseWriter, r *http.Request) {
	_, info, e := a.mcContentRequired(r, "file.read")
	if e != nil {
		fail(w, e)
		return
	}
	if e = mcContentFilter(r, &info); e != nil {
		fail(w, e)
		return
	}
	p, e := a.mcContentProvider(r.Context(), r.PathValue("provider"))
	if e != nil {
		fail(w, e)
		return
	}
	versions, e := p.releases(r.Context(), info, r.PathValue("project"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("minecraft_content_versions", M{"versions": versions, "provider": p.name, "provider_message": mcContentProviderWarning(p.name, info), "server_compatibility_unknown": p.name == "curseforge" && (info.Kind == "mod" || mcContentUnknownPlugin(info))}))
}
func mcContentAcknowledged(provider string, info mcContentInfo, input M) error {
	if provider == "curseforge" && mcContentUnknownPlugin(info) && (!info.IncludeUnverified || info.Compatibility == "server_only") {
		return bad("Enable unverified results before installing a CurseForge plugin with unknown server API compatibility.")
	}
	if provider == "curseforge" && (info.Kind == "mod" || mcContentUnknownPlugin(info)) && input["confirm_server_compatibility"] != true {
		return bad("CurseForge server compatibility is unknown. Check the author's instructions and acknowledge this before installing.")
	}
	return nil
}

func (a *App) mcContentInstall(w http.ResponseWriter, r *http.Request) {
	s, info, e := a.mcContentRequired(r, "file.create")
	if e != nil {
		fail(w, e)
		return
	}
	if e = mcContentFilter(r, &info); e != nil {
		fail(w, e)
		return
	}
	user, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	if !a.can(r.Context(), user, s, "file.read") {
		fail(w, forbidden())
		return
	}
	input, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	provider := str(input["provider"])
	if e = mcContentAcknowledged(provider, info, input); e != nil {
		fail(w, e)
		return
	}
	p, e := a.mcContentProvider(r.Context(), provider)
	if e != nil {
		fail(w, e)
		return
	}
	lock := &mcContentLocks[uint64(num(s["id"]))%uint64(len(mcContentLocks))]
	lock.Lock()
	defer lock.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	if e = a.mcContentStopped(ctx, s); e != nil {
		fail(w, e)
		return
	}
	release, e := p.release(ctx, info, str(input["project_id"]), str(input["version_id"]))
	if e != nil {
		fail(w, e)
		return
	}
	// A server-only project may need a shared library. Dependencies must support
	// the server, but do not inherit the catalog's optional browsing restriction.
	info.Compatibility = "server"
	plan, e := p.plan(ctx, info, release)
	if e != nil {
		fail(w, e)
		return
	}
	entries, e := a.mcContentFiles(ctx, s, info)
	if e != nil {
		fail(w, e)
		return
	}
	for _, v := range plan {
		for _, file := range entries {
			if strings.EqualFold(str(file["name"]), v.Filename) {
				fail(w, bad("File "+v.Filename+" already exists. Review it in Files before installing this version."))
				return
			}
		}
	}
	downloads := make([][]byte, len(plan))
	for i, v := range plan {
		downloads[i], e = p.download(ctx, v)
		if e != nil {
			fail(w, e)
			return
		}
	}
	// Recheck state after upstream downloads; never start, stop or restart the server here.
	if e = a.mcContentStopped(ctx, s); e != nil {
		fail(w, e)
		return
	}
	staged := []string{}
	committed := []string{}
	success := false
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		files := append([]string{}, staged...)
		if !success {
			files = append(files, committed...)
		}
		if len(files) > 0 {
			_ = a.mcContentWrite(cleanup, s, "POST", "/files/delete", M{"root": info.Directory, "files": files})
		}
	}()
	if e = a.mcContentWrite(ctx, s, "POST", "/files/create-directory", M{"path": "/", "name": strings.TrimPrefix(info.Directory, "/")}); e != nil {
		fail(w, e)
		return
	}
	for i := range plan {
		temp := ".voltra-content-" + newUUID() + ".part"
		staged = append(staged, temp)
		if e = a.mcContentWrite(ctx, s, "POST", "/files/write?"+url.Values{"file": {info.Directory + "/" + temp}}.Encode(), bytes.NewReader(downloads[i])); e != nil {
			fail(w, e)
			return
		}
	}
	for i, v := range plan {
		if e = a.mcContentStopped(ctx, s); e != nil {
			fail(w, e)
			return
		}
		if e = a.mcContentWrite(ctx, s, "PUT", "/files/rename", M{"root": info.Directory, "files": []M{{"from": staged[i], "to": v.Filename}}}); e != nil {
			fail(w, e)
			return
		}
		committed = append(committed, v.Filename)
	}
	// Wings may silently ignore missing rename sources. Verify the resulting files before reporting success.
	entries, e = a.mcContentFiles(ctx, s, info)
	if e != nil {
		fail(w, e)
		return
	}
	for _, v := range plan {
		found := false
		for _, f := range entries {
			if str(f["name"]) == v.Filename && boolean(f["is_file"]) && num(f["size"]) == v.Size {
				found = true
			}
		}
		if !found {
			fail(w, bad("Wings did not confirm the installed file. Check Files before retrying."))
			return
		}
	}
	success = true
	_ = a.audit(ctx, num(user["id"]), num(s["id"]), "server:minecraft.content.install", M{"provider": provider, "project_id": release.Project, "version_id": release.ID, "files": committed, "server_compatibility_acknowledged": input["confirm_server_compatibility"] == true})
	writeJSON(w, 201, item("minecraft_content_install", M{"files": committed, "restart_needed": true, "message": "Installed. Changes take effect on the next server start."}))
}
func (a *App) mcContentRemove(w http.ResponseWriter, r *http.Request) {
	s, info, e := a.mcContentRequired(r, "file.delete")
	if e != nil {
		fail(w, e)
		return
	}
	user, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	if !a.can(r.Context(), user, s, "file.read") {
		fail(w, forbidden())
		return
	}
	input, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	file := str(input["file"])
	if !mcContentSafeFilename(file) {
		fail(w, bad("Choose a JAR filename in the server's content directory."))
		return
	}
	lock := &mcContentLocks[uint64(num(s["id"]))%uint64(len(mcContentLocks))]
	lock.Lock()
	defer lock.Unlock()
	if e = a.mcContentStopped(r.Context(), s); e != nil {
		fail(w, e)
		return
	}
	entries, e := a.mcContentFiles(r.Context(), s, info)
	if e != nil {
		fail(w, e)
		return
	}
	found := false
	for _, f := range entries {
		if str(f["name"]) == file && boolean(f["is_file"]) {
			found = true
		}
	}
	if !found {
		fail(w, notFound())
		return
	}
	if e = a.mcContentWrite(r.Context(), s, "POST", "/files/delete", M{"root": info.Directory, "files": []string{file}}); e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(user["id"]), num(s["id"]), "server:minecraft.content.remove", M{"file": info.Directory + "/" + file})
	w.WriteHeader(204)
}
