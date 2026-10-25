package panel

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func (a *App) gameLibraryModpacks(w http.ResponseWriter, r *http.Request) {
	if _, err := a.user(r); err != nil {
		fail(w, err)
		return
	}
	q := r.URL.Query()
	provider := q.Get("provider")
	if provider == "" {
		provider = "curseforge"
	}
	offset := 0
	var err error
	if q.Get("offset") != "" {
		offset, err = strconv.Atoi(q.Get("offset"))
	}
	if err != nil || offset < 0 || offset > 10000 || len(q.Get("query")) > 200 {
		fail(w, bad("Use a search of at most 200 characters and a valid catalog offset."))
		return
	}
	loader, version := q.Get("loader"), q.Get("version")
	if loader != "" && !minecraftLoaderKnown(loader) || version != "" && !minecraftID.MatchString(version) {
		fail(w, bad("Select a supported loader and game version."))
		return
	}
	out := M{"projects": []M{}, "total": 0, "offset": offset, "limit": 20, "provider": provider}
	switch provider {
	case "modrinth":
		facets := [][]string{{"project_type:modpack"}, {"server_side:required", "server_side:optional"}}
		if version != "" {
			facets = append(facets, []string{"versions:" + version})
		}
		if loader != "" {
			facets = append(facets, []string{"categories:" + loader})
		}
		encoded, _ := json.Marshal(facets)
		query := url.Values{"query": {q.Get("query")}, "offset": {strconv.Itoa(offset)}, "limit": {"20"}, "facets": {string(encoded)}}
		var data struct {
			Hits  []M `json:"hits"`
			Total int `json:"total_hits"`
		}
		if err = a.minecraftProviderJSON(r.Context(), minecraftQuery("https://api.modrinth.com/v2/search", query), "", &data); err != nil {
			fail(w, err)
			return
		}
		rows := []M{}
		for _, p := range data.Hits {
			rows = append(rows, M{"id": p["project_id"], "name": p["title"], "summary": p["description"], "icon_url": p["icon_url"], "downloads": p["downloads"], "author": p["author"]})
		}
		out["projects"], out["total"] = rows, data.Total
	case "curseforge":
		key, e := a.minecraftCurseKey(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		query := url.Values{"gameId": {"432"}, "classId": {"4471"}, "searchFilter": {q.Get("query")}, "index": {strconv.Itoa(offset)}, "pageSize": {"20"}, "sortField": {"2"}, "sortOrder": {"desc"}}
		if version != "" {
			query.Set("gameVersion", version)
		}
		if loader != "" {
			if id := minecraftCFLoader(loader); id > 0 {
				query.Set("modLoaderType", strconv.Itoa(id))
			}
		}
		var data struct {
			Data       []M `json:"data"`
			Pagination struct {
				Total int `json:"totalCount"`
			} `json:"pagination"`
		}
		if err = a.minecraftProviderJSON(r.Context(), minecraftQuery("https://api.curseforge.com/v1/mods/search", query), key, &data); err != nil {
			fail(w, err)
			return
		}
		rows := []M{}
		for _, p := range data.Data {
			author := ""
			authors := asSlice(p["authors"])
			if len(authors) > 0 {
				author = str(asMap(authors[0])["name"])
			}
			rows = append(rows, M{"id": fmt.Sprint(num(p["id"])), "name": p["name"], "summary": p["summary"], "icon_url": asMap(p["logo"])["url"], "downloads": p["downloadCount"], "author": author})
		}
		out["projects"], out["total"] = rows, data.Pagination.Total
	default:
		fail(w, bad("Choose CurseForge or Modrinth."))
		return
	}
	writeJSON(w, 200, item("minecraft_modpacks", out))
}

func minecraftCFLoader(loader string) int {
	return map[string]int{"forge": 1, "fabric": 4, "quilt": 5, "neoforge": 6}[loader]
}

type minecraftPackProject struct {
	ID          string
	Public      M
	Versions    []M
	RawVersions map[string]M
	Key         string
}

func (a *App) minecraftPackProject(ctx context.Context, provider, project string) (minecraftPackProject, error) {
	out := minecraftPackProject{ID: project, Versions: []M{}, RawVersions: map[string]M{}}
	if !minecraftID.MatchString(project) {
		return out, bad("Select a valid modpack project.")
	}
	switch provider {
	case "modrinth":
		var data M
		if err := a.minecraftProviderJSON(ctx, "https://api.modrinth.com/v2/project/"+url.PathEscape(project), "", &data); err != nil {
			return out, err
		}
		if str(data["project_type"]) != "modpack" {
			return out, bad("Select a modpack project.")
		}
		out.ID = str(data["id"])
		out.Public = M{"id": out.ID, "name": data["title"], "summary": data["description"], "icon_url": data["icon_url"]}
		var versions []M
		if err := a.minecraftProviderJSON(ctx, "https://api.modrinth.com/v2/project/"+url.PathEscape(out.ID)+"/version", "", &versions); err != nil {
			return out, err
		}
		supported := str(data["server_side"]) == "required" || str(data["server_side"]) == "optional"
		for _, v := range versions {
			id := str(v["id"])
			if str(v["project_id"]) != out.ID {
				continue
			}
			available := supported && len(asSlice(v["files"])) > 0
			out.RawVersions[id] = v
			out.Versions = append(out.Versions, M{"id": id, "name": v["name"], "game_versions": v["game_versions"], "loaders": v["loaders"], "server_supported": available})
		}
	case "curseforge":
		if _, e := strconv.ParseInt(project, 10, 64); e != nil {
			return out, bad("Select a valid CurseForge project.")
		}
		key, err := a.minecraftCurseKey(ctx)
		if err != nil {
			return out, err
		}
		out.Key = key
		var data struct {
			Data M `json:"data"`
		}
		if err = a.minecraftProviderJSON(ctx, "https://api.curseforge.com/v1/mods/"+project, key, &data); err != nil {
			return out, err
		}
		p := data.Data
		if num(p["gameId"]) != 432 || num(p["classId"]) != 4471 {
			return out, bad("Select a Minecraft modpack project.")
		}
		out.Public = M{"id": project, "name": p["name"], "summary": p["summary"], "icon_url": asMap(p["logo"])["url"]}
		// CurseForge paginates file history. Expose all accessible files up to its
		// documented 10,000-result window rather than silently returning one page.
		for offset := 0; offset < 10000; offset += 50 {
			var files struct {
				Data       []M `json:"data"`
				Pagination struct {
					Total int `json:"totalCount"`
				} `json:"pagination"`
			}
			address := fmt.Sprintf("https://api.curseforge.com/v1/mods/%s/files?index=%d&pageSize=50", project, offset)
			if err = a.minecraftProviderJSON(ctx, address, key, &files); err != nil {
				return out, err
			}
			for _, v := range files.Data {
				if boolean(v["isServerPack"]) || num(v["modId"]) != num(p["id"]) {
					continue
				}
				id := fmt.Sprint(num(v["id"]))
				games, loaders := minecraftCFVersions(asSlice(v["gameVersions"]))
				out.RawVersions[id] = v
				out.Versions = append(out.Versions, M{"id": id, "name": v["displayName"], "game_versions": games, "loaders": loaders, "server_supported": num(v["serverPackFileId"]) > 0 && str(v["downloadUrl"]) != ""})
			}
			if len(files.Data) < 50 || offset+50 >= files.Pagination.Total {
				break
			}
		}
	default:
		return out, bad("Choose CurseForge or Modrinth.")
	}
	return out, nil
}

func minecraftCFVersions(values []any) ([]string, []string) {
	games, loaders := []string{}, []string{}
	for _, v := range values {
		s := str(v)
		l := strings.ToLower(s)
		if minecraftLoaderKnown(l) {
			loaders = append(loaders, l)
		} else if minecraftSupportedRelease(s) {
			games = append(games, s)
		}
	}
	return games, loaders
}

func (a *App) gameLibraryModpackVersions(w http.ResponseWriter, r *http.Request) {
	if _, err := a.user(r); err != nil {
		fail(w, err)
		return
	}
	provider := r.PathValue("provider")
	project, err := a.minecraftPackProject(r.Context(), provider, r.PathValue("project"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("minecraft_modpack_versions", M{"provider": provider, "project": project.Public, "versions": project.Versions}))
}

func minecraftCFDownload(file M) (minecraftDownload, error) {
	out := minecraftDownload{URL: str(file["downloadUrl"]), Algorithm: "sha1"}
	if out.URL == "" {
		return out, APIError{422, "CurseForgeDownloadingDisabled", "The author has disabled API downloads for this file. Choose another pack version or ask the author to allow server-pack downloads."}
	}
	if !boolean(file["isAvailable"]) {
		return out, bad("This CurseForge file is no longer available.")
	}
	for _, h := range asSlice(file["hashes"]) {
		hash := asMap(h)
		if num(hash["algo"]) == 1 {
			out.Hash = str(hash["value"])
			break
		}
	}
	if !minecraftOfficialURL(out.URL, "edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net") || !minecraftHashValid(out.Algorithm, out.Hash) {
		return out, bad("CurseForge did not supply a verified download for this file.")
	}
	return out, nil
}

func minecraftSafePackPath(name string) bool {
	if name == "" || len(name) > 512 || strings.ContainsAny(name, "\\\x00\r\n:") || strings.HasPrefix(name, "/") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == ".." || part == "." || strings.HasPrefix(strings.ToLower(part), ".voltra") {
			return false
		}
	}
	return true
}

func minecraftReadZip(data []byte) (*zip.Reader, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, bad("The provider did not return a valid modpack ZIP archive.")
	}
	if len(reader.File) > 30000 {
		return nil, bad("This pack contains too many archive entries.")
	}
	var total uint64
	for _, f := range reader.File {
		kind := f.Mode() & os.ModeType
		if !minecraftSafePackPath(strings.TrimSuffix(f.Name, "/")) || (kind != 0 && kind != os.ModeDir) {
			return nil, bad("The pack archive contains an unsafe path or special file.")
		}
		total += f.UncompressedSize64
		if f.UncompressedSize64 > 512<<20 || total > 2<<30 {
			return nil, bad("This pack exceeds the supported archive size.")
		}
	}
	return reader, nil
}

func minecraftZipJSON(reader *zip.Reader, name string, target any) error {
	for _, f := range reader.File {
		if f.Name == name {
			if f.UncompressedSize64 > 8<<20 {
				return bad("The pack manifest is too large.")
			}
			r, err := f.Open()
			if err != nil {
				return err
			}
			defer r.Close()
			if json.NewDecoder(io.LimitReader(r, 8<<20)).Decode(target) != nil {
				return bad("The pack manifest is invalid.")
			}
			return nil
		}
	}
	return bad("The pack archive is missing its manifest.")
}

type minecraftMRManifest struct {
	Format       int               `json:"formatVersion"`
	Game         string            `json:"game"`
	Dependencies map[string]string `json:"dependencies"`
	Files        []struct {
		Path      string            `json:"path"`
		Hashes    map[string]string `json:"hashes"`
		Downloads []string          `json:"downloads"`
		Env       map[string]string `json:"env"`
	} `json:"files"`
}

func minecraftParseMRPack(data []byte) (string, string, string, []minecraftDownload, error) {
	reader, err := minecraftReadZip(data)
	if err != nil {
		return "", "", "", nil, err
	}
	var manifest minecraftMRManifest
	if err = minecraftZipJSON(reader, "modrinth.index.json", &manifest); err != nil {
		return "", "", "", nil, err
	}
	if manifest.Format != 1 || manifest.Game != "minecraft" {
		return "", "", "", nil, bad("This Modrinth pack format is not supported.")
	}
	game := manifest.Dependencies["minecraft"]
	loader, loaderVersion := "vanilla", ""
	for name, v := range manifest.Dependencies {
		if name == "minecraft" {
			continue
		}
		id := map[string]string{"fabric-loader": "fabric", "quilt-loader": "quilt", "forge": "forge", "neoforge": "neoforge"}[name]
		if id == "" || loader != "vanilla" {
			return "", "", "", nil, bad("This pack has unsupported or conflicting loader dependencies.")
		}
		loader, loaderVersion = id, v
	}
	files := []minecraftDownload{}
	seen := map[string]bool{}
	for _, f := range manifest.Files {
		if !minecraftSafePackPath(f.Path) || strings.HasSuffix(f.Path, "/") {
			return "", "", "", nil, bad("The pack manifest contains an unsafe file path.")
		}
		if f.Env["server"] == "unsupported" || f.Env["server"] == "optional" {
			continue
		}
		if f.Env["server"] != "" && f.Env["server"] != "required" {
			return "", "", "", nil, bad("The pack declares an unknown server environment.")
		}
		if seen[f.Path] {
			return "", "", "", nil, bad("The pack declares duplicate file paths.")
		}
		seen[f.Path] = true
		address := ""
		for _, u := range f.Downloads {
			if minecraftOfficialURL(u, "cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com") {
				address = u
				break
			}
		}
		file := minecraftDownload{URL: address, Path: f.Path, Algorithm: "sha512", Hash: f.Hashes["sha512"]}
		if address == "" || !minecraftHashValid(file.Algorithm, file.Hash) {
			return "", "", "", nil, bad("A required server file has no approved download or checksum.")
		}
		files = append(files, file)
	}
	return game, loader, loaderVersion, files, nil
}

func (a *App) minecraftModpackPlan(ctx context.Context, selection M) (minecraftPlan, error) {
	provider, projectID, versionID := str(selection["provider"]), str(selection["project_id"]), str(selection["version_id"])
	if !minecraftID.MatchString(versionID) {
		return minecraftPlan{}, bad("Choose an available modpack version.")
	}
	project, err := a.minecraftPackProject(ctx, provider, projectID)
	if err != nil {
		return minecraftPlan{}, err
	}
	version, exists := project.RawVersions[versionID]
	if !exists {
		return minecraftPlan{}, bad("This version does not belong to the selected pack.")
	}
	game, loader, loaderVersion := "", "", ""
	files := []minecraftDownload{}
	archives := []minecraftPackArchive{}
	if provider == "modrinth" {
		allowed := false
		for _, v := range project.Versions {
			if v["id"] == versionID {
				allowed = boolean(v["server_supported"])
			}
		}
		if !allowed {
			return minecraftPlan{}, APIError{422, "ClientOnlyModpack", "This pack does not declare dedicated-server support. Choose a server-compatible pack."}
		}
		var archive minecraftDownload
		for _, v := range asSlice(version["files"]) {
			f := asMap(v)
			if strings.HasSuffix(str(f["filename"]), ".mrpack") && (archive.URL == "" || boolean(f["primary"])) {
				archive = minecraftDownload{URL: str(f["url"]), Hash: str(asMap(f["hashes"])["sha512"]), Algorithm: "sha512"}
			}
		}
		if !minecraftOfficialURL(archive.URL, "cdn.modrinth.com") {
			return minecraftPlan{}, bad("The pack has no approved Modrinth archive.")
		}
		data, e := a.minecraftFetchArchive(ctx, archive)
		if e != nil {
			return minecraftPlan{}, e
		}
		game, loader, loaderVersion, files, err = minecraftParseMRPack(data)
		if err != nil {
			return minecraftPlan{}, err
		}
		if !minecraftStringIn(asSlice(version["game_versions"]), game) || !minecraftStringIn(asSlice(version["loaders"]), loader) {
			return minecraftPlan{}, bad("The pack manifest does not match its published game or loader versions.")
		}
		archives = append(archives, minecraftPackArchive{File: archive, Prefixes: []string{"overrides/", "server-overrides/"}})
	} else {
		if num(version["serverPackFileId"]) <= 0 {
			return minecraftPlan{}, APIError{422, "ClientOnlyModpack", "This CurseForge version has no author-published server pack. Choose a version with a server download."}
		}
		clientArchive, e := minecraftCFDownload(version)
		if e != nil {
			return minecraftPlan{}, e
		}
		data, e := a.minecraftFetchArchive(ctx, clientArchive)
		if e != nil {
			return minecraftPlan{}, e
		}
		reader, e := minecraftReadZip(data)
		if e != nil {
			return minecraftPlan{}, e
		}
		var manifest struct {
			Minecraft struct {
				Version string `json:"version"`
				Loaders []struct {
					ID      string `json:"id"`
					Primary bool   `json:"primary"`
				} `json:"modLoaders"`
			} `json:"minecraft"`
		}
		if err = minecraftZipJSON(reader, "manifest.json", &manifest); err != nil {
			return minecraftPlan{}, err
		}
		game = manifest.Minecraft.Version
		if !minecraftStringIn(asSlice(version["gameVersions"]), game) {
			return minecraftPlan{}, bad("The pack manifest does not match its published Minecraft version.")
		}
		loader = "vanilla"
		for _, l := range manifest.Minecraft.Loaders {
			if l.Primary {
				parts := strings.SplitN(l.ID, "-", 2)
				if len(parts) != 2 || !minecraftLoaderKnown(parts[0]) {
					return minecraftPlan{}, bad("This pack uses an unsupported loader.")
				}
				loader, loaderVersion = parts[0], parts[1]
			}
		}
		if len(manifest.Minecraft.Loaders) > 0 && loader == "vanilla" {
			return minecraftPlan{}, bad("This pack has no primary server loader.")
		}
		var response struct {
			Data M `json:"data"`
		}
		address := fmt.Sprintf("https://api.curseforge.com/v1/mods/%s/files/%d", projectID, num(version["serverPackFileId"]))
		if err = a.minecraftProviderJSON(ctx, address, project.Key, &response); err != nil {
			return minecraftPlan{}, err
		}
		serverFile := response.Data
		if !boolean(serverFile["isServerPack"]) || num(serverFile["modId"]) != num(version["modId"]) || num(serverFile["id"]) != num(version["serverPackFileId"]) {
			return minecraftPlan{}, bad("CurseForge returned a server pack that does not belong to this project.")
		}
		if parent := num(serverFile["parentProjectFileId"]); parent != 0 && parent != num(version["id"]) {
			return minecraftPlan{}, bad("CurseForge returned a server archive for a different pack release.")
		}
		archive, e := minecraftCFDownload(serverFile)
		if e != nil {
			return minecraftPlan{}, e
		}
		data, e = a.minecraftFetchArchive(ctx, archive)
		if e != nil {
			return minecraftPlan{}, e
		}
		reader, e = minecraftReadZip(data)
		if e != nil {
			return minecraftPlan{}, e
		}
		prefix, e := minecraftServerPackPrefix(reader)
		if e != nil {
			return minecraftPlan{}, e
		}
		archives = append(archives, minecraftPackArchive{File: archive, Prefixes: []string{prefix}})
	}
	plan, err := a.minecraftBuildPlan(ctx, game, loader, loaderVersion)
	if err != nil {
		return plan, err
	}
	plan.Files = append(plan.Files, files...)
	plan.Archives = archives
	plan.Provider, plan.ProjectID, plan.PackVersionID = provider, project.ID, versionID
	plan.PackArtwork = &minecraftPackArtwork{Provider: provider, ProjectID: project.ID, Name: str(project.Public["name"]), IconURL: mcContentIcon(str(project.Public["icon_url"]))}
	return plan, nil
}

func minecraftStringIn(values []any, value string) bool {
	for _, v := range values {
		if str(v) == value {
			return true
		}
	}
	return false
}

// Only conventional server content is installed from author server archives.
// Pack-provided shell/batch scripts and prebuilt JVM libraries are not executed.
func minecraftServerPackPrefix(reader *zip.Reader) (string, error) {
	prefix := ""
	candidates := map[string]bool{}
	for _, f := range reader.File {
		parts := strings.Split(f.Name, "/")
		for i, p := range parts {
			if p == "mods" || p == "config" || p == "defaultconfigs" {
				candidate := strings.Join(parts[:i], "/")
				if candidate != "" {
					candidate += "/"
				}
				candidates[candidate] = true
				if len(candidates) == 1 || len(candidate) < len(prefix) {
					prefix = candidate
				}
				break
			}
		}
	}
	if len(candidates) == 0 {
		return "", bad("This server pack needs a custom setup script and has no supported server content folders. Choose another version.")
	}
	// Content can itself contain sample config/mods folders (RLCraft's loading
	// screen resources do). Only disregard those below a supported content
	// folder of the selected instance; independent sibling instances remain
	// ambiguous regardless of ZIP entry order.
	content := map[string]bool{"mods": true, "config": true, "defaultconfigs": true, "kubejs": true, "scripts": true, "datapacks": true, "resources": true, "global_packs": true, "resourcepacks": true}
	for candidate := range candidates {
		if candidate == prefix {
			continue
		}
		relative, inside := strings.CutPrefix(candidate, prefix)
		if !inside || !content[strings.Split(relative, "/")[0]] {
			return "", bad("The server pack has ambiguous instance folders.")
		}
	}
	return prefix, nil
}

func minecraftCompressPlan(data []byte) (string, error) {
	var out bytes.Buffer
	writer := zlib.NewWriter(&out)
	if _, err := writer.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(out.Bytes())
	if len(encoded) > 96000 {
		return "", bad("The pack install plan exceeds the supported size.")
	}
	return encoded, nil
}
