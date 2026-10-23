package panel

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// The catalog is pinned and shipped with its upstream MIT license. Requests
// cannot replace a recipe's installer, image, or startup with remote content.
//
//go:embed game_library/upstream/catalog.json
var gameTemplateCatalogJSON []byte

// Reviewed game exceptions remain data, using the same form and lifecycle.
//
//go:embed game_library/overrides.json
var gameTemplateOverridesJSON []byte

type templatePortRule struct {
	Environment      string `json:"environment"`
	Value            string `json:"value"`
	Minimum          int    `json:"minimum"`
	Maximum          int    `json:"maximum"`
	Count            int    `json:"count"`
	Offsets          []int  `json:"offsets,omitempty"`
	Condition        string `json:"condition,omitempty"`
	AllocatedValue   bool   `json:"allocated_value,omitempty"`
	AllocatedOffsets []int  `json:"allocated_offsets,omitempty"`
	ExcludePrimary   bool   `json:"exclude_primary,omitempty"`
	ExcludeOffsets   []int  `json:"exclude_offsets,omitempty"`
	AutoAllocate     bool   `json:"auto_allocate,omitempty"`
	WhenEnvironment  string `json:"when_environment,omitempty"`
	WhenValue        string `json:"when_value,omitempty"`
}

type gameTemplateOverride struct {
	UpstreamSHA256           string             `json:"upstream_sha256"`
	Revision                 string             `json:"revision"`
	Defaults                 M                  `json:"defaults"`
	Egg                      M                  `json:"egg"`
	Verification             string             `json:"verification,omitempty"`
	Detail                   string             `json:"detail,omitempty"`
	SetupSteps               []string           `json:"setup_steps,omitempty"`
	Platforms                []string           `json:"platforms,omitempty"`
	RequiredPorts            int                `json:"required_ports,omitempty"`
	ConsecutivePorts         bool               `json:"consecutive_ports,omitempty"`
	ConsecutivePortsCount    int                `json:"consecutive_ports_count,omitempty"`
	ConsecutivePrimaryOffset int                `json:"consecutive_primary_offset,omitempty"`
	PortRules                []templatePortRule `json:"port_rules,omitempty"`
}

type gameTemplate struct {
	Path                     string             `json:"path"`
	SHA256                   string             `json:"sha256"`
	Egg                      M                  `json:"egg"`
	ID                       string             `json:"id"`
	Profile                  string             `json:"profile,omitempty"`
	Defaults                 M                  `json:"defaults,omitempty"`
	Verification             string             `json:"verification,omitempty"`
	Detail                   string             `json:"detail,omitempty"`
	SetupSteps               []string           `json:"setup_steps,omitempty"`
	Platforms                []string           `json:"platforms,omitempty"`
	RequiredPorts            int                `json:"required_ports,omitempty"`
	ConsecutivePorts         bool               `json:"consecutive_ports,omitempty"`
	ConsecutivePortsCount    int                `json:"consecutive_ports_count,omitempty"`
	ConsecutivePrimaryOffset int                `json:"consecutive_primary_offset,omitempty"`
	PortRules                []templatePortRule `json:"port_rules,omitempty"`
}
type templateCatalog struct {
	Repository string         `json:"repository"`
	Revision   string         `json:"revision"`
	Entries    []gameTemplate `json:"entries"`
}

var templatesOnce sync.Once
var templates templateCatalog

func gameTemplates() templateCatalog {
	templatesOnce.Do(func() {
		if err := json.Unmarshal(gameTemplateCatalogJSON, &templates); err != nil {
			panic("invalid embedded game catalog")
		}
		valid := []gameTemplate{}
		overrides := map[string]gameTemplateOverride{}
		if err := json.Unmarshal(gameTemplateOverridesJSON, &overrides); err != nil {
			panic("invalid game profile overrides")
		}
		for _, entry := range templates.Entries {
			if entry.Egg == nil {
				continue
			}
			sum := sha256.Sum256([]byte(entry.Path))
			entry.ID = hex.EncodeToString(sum[:8])
			if override, ok := overrides[entry.Path]; ok {
				if override.UpstreamSHA256 != entry.SHA256 {
					panic("game recipe changed; review its local profile before shipping")
				}
				entry.Egg = override.Egg
				entry.Profile = override.Revision
				entry.Defaults = override.Defaults
				entry.Verification = override.Verification
				entry.Detail = override.Detail
				entry.SetupSteps = override.SetupSteps
				entry.Platforms = override.Platforms
				entry.RequiredPorts = override.RequiredPorts
				entry.ConsecutivePorts = override.ConsecutivePorts
				entry.ConsecutivePortsCount = override.ConsecutivePortsCount
				entry.ConsecutivePrimaryOffset = override.ConsecutivePrimaryOffset
				entry.PortRules = override.PortRules
				entry.SHA256 = gameTemplateOverrideDigest(override)
			}
			valid = append(valid, entry)
		}
		templates.Entries = valid
	})
	return templates
}

// Review notes and instructions do not change an installed egg's behavior.
// Keep its identity stable when only that presentation metadata changes.
func gameTemplateOverrideDigest(override gameTemplateOverride) string {
	override.Verification = ""
	override.Detail = ""
	override.SetupSteps = nil
	body, _ := json.Marshal(override)
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func gameTemplateFor(id string) (gameTemplate, bool) {
	for _, entry := range gameTemplates().Entries {
		if entry.ID == id {
			return entry, true
		}
	}
	return gameTemplate{}, false
}

func templateSummary(entry gameTemplate) M {
	_, _, err := parseEggDocument(entry.Egg)
	available := err == nil
	detail := entry.Detail
	if err != nil {
		detail = "This upstream recipe needs a compatibility fix before setup."
	}
	verification := entry.Verification
	if verification == "" {
		verification = "not_verified"
	}
	out := M{"id": entry.ID, "name": entry.Egg["name"], "description": entry.Egg["description"], "category": strings.Split(entry.Path, "/")[0], "source": gameTemplates().Repository + "/blob/" + gameTemplates().Revision + "/" + entry.Path, "available": available, "detail": detail, "verification": verification, "profile": entry.Profile, "setup_steps": entry.SetupSteps, "platforms": entry.Platforms, "required_ports": max(1, entry.RequiredPorts), "consecutive_ports": entry.ConsecutivePorts, "consecutive_ports_count": entry.ConsecutivePortsCount, "consecutive_primary_offset": entry.ConsecutivePrimaryOffset, "port_rules": entry.PortRules}
	if managed := steamCatalogBridgeID(entry.Path); managed != "" {
		out["managed_game"] = managed
		out["managed_options_url"] = "/api/client/game-library/steam/" + managed
		out["managed_install_url"] = "/api/client/game-library/steam/" + managed + "/install"
	}
	return out
}

func gameTemplateNodePlatform(system M) string {
	details := asMap(system["system"])
	arch := strings.ToLower(str(details["architecture"]))
	if arch == "" {
		arch = strings.ToLower(str(system["architecture"]))
	}
	switch arch {
	case "x86_64", "x64":
		arch = "amd64"
	case "aarch64":
		arch = "arm64"
	}
	os := strings.ToLower(str(details["os_type"]))
	if os == "" {
		os = strings.ToLower(str(system["os"]))
	}
	if os == "" || arch == "" {
		return "unknown"
	}
	return os + "/" + arch
}

func gameTemplateSupportsPlatform(entry gameTemplate, platform string) bool {
	if len(entry.Platforms) == 0 {
		return true
	}
	for _, allowed := range entry.Platforms {
		if allowed == platform {
			return true
		}
	}
	return false
}

func (a *App) gameTemplateProbePlatform(ctx context.Context, node M) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	response, err := a.daemon(ctx, node, "GET", "/api/system?v=2", nil)
	if err != nil {
		return "unknown", err
	}
	defer response.Body.Close()
	var system M
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&system); err != nil {
		return "unknown", err
	}
	return gameTemplateNodePlatform(system), nil
}

func (a *App) registerGameTemplates(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/game-library/templates", a.gameTemplateList)
	mux.HandleFunc("GET /api/client/game-library/templates/{template}", a.gameTemplateOptions)
	mux.HandleFunc("POST /api/client/game-library/templates/{template}/install", a.gameTemplateInstall)
}

func (a *App) gameTemplateList(w http.ResponseWriter, r *http.Request) {
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	out := []M{}
	for _, entry := range gameTemplates().Entries {
		out = append(out, templateSummary(entry))
	}
	writeJSON(w, 200, item("game_templates", M{"games": out, "revision": gameTemplates().Revision, "can_install": boolean(user["root_admin"])}))
}

func (a *App) gameTemplateOptions(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	entry, ok := gameTemplateFor(r.PathValue("template"))
	if !ok {
		fail(w, notFound())
		return
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		fail(w, err)
		return
	}
	nodes, err := a.query(r.Context(), "SELECT id,name,memory,disk FROM nodes WHERE public AND NOT maintenance_mode ORDER BY name,id")
	if err != nil {
		fail(w, err)
		return
	}
	if len(entry.Platforms) > 0 {
		compatible := make([]bool, len(nodes))
		var group sync.WaitGroup
		limit := make(chan struct{}, 4)
		for i, node := range nodes {
			group.Add(1)
			go func(i int, node M) {
				defer group.Done()
				select {
				case limit <- struct{}{}:
				case <-r.Context().Done():
					return
				}
				defer func() { <-limit }()
				full, err := a.node(r.Context(), num(node["id"]))
				if err != nil {
					return
				}
				platform, err := a.gameTemplateProbePlatform(r.Context(), full)
				compatible[i] = err == nil && gameTemplateSupportsPlatform(entry, platform)
			}(i, node)
		}
		group.Wait()
		filtered := []M{}
		for i, node := range nodes {
			if compatible[i] {
				filtered = append(filtered, node)
			}
		}
		nodes = filtered
	}
	for _, node := range nodes {
		allocations, e := a.query(r.Context(), "SELECT id,ip,port FROM allocations WHERE node_id=$1 AND server_id IS NULL ORDER BY ip,port", node["id"])
		if e != nil {
			fail(w, e)
			return
		}
		node["allocations"] = allocations
	}
	images := []M{}
	for label, image := range asMap(egg["docker_images"]) {
		images = append(images, M{"label": label, "value": image})
	}
	sort.Slice(images, func(i, j int) bool { return str(images[i]["label"]) < str(images[j]["label"]) })
	out := templateSummary(entry)
	out["nodes"] = nodes
	out["images"] = images
	out["variables"] = variables
	out["startup"] = egg["startup"]
	out["defaults"] = M{"memory": 2048, "disk": 10240}
	if len(entry.Defaults) > 0 {
		out["defaults"] = entry.Defaults
	}
	writeJSON(w, 200, item("game_template_options", out))
}

func templateEnvironment(variables []M, input any) (M, error) {
	provided, ok := input.(map[string]any)
	if !ok {
		return nil, bad("Game settings must be an object.")
	}
	allowed := map[string]bool{}
	out := M{}
	for _, v := range variables {
		key := str(v["env_variable"])
		allowed[key] = true
		value := v["default_value"]
		if raw, exists := provided[key]; exists {
			value = raw
		}
		text, ok := value.(string)
		if !ok || len(text) > 16384 || strings.ContainsRune(text, 0) {
			return nil, bad("Enter a valid value for " + str(v["name"]) + ".")
		}
		out[key] = text
	}
	for key := range provided {
		if !allowed[key] {
			return nil, bad("Unknown game setting: " + key)
		}
	}
	return out, nil
}

func (a *App) gameTemplateInstall(w http.ResponseWriter, r *http.Request) {
	user, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	entry, ok := gameTemplateFor(r.PathValue("template"))
	if !ok {
		fail(w, notFound())
		return
	}
	egg, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		fail(w, err)
		return
	}
	input, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	name, ok := input["name"].(string)
	if !ok || strings.TrimSpace(name) == "" || len([]rune(name)) > 100 || !quickSingleLine(name) {
		fail(w, bad("Enter a server name of at most 100 characters."))
		return
	}
	requestID := str(input["request_id"])
	if !steamRequestID.MatchString(requestID) {
		fail(w, bad("A valid installation request ID is required."))
		return
	}
	memory, validMemory := applicationInteger(input["memory"])
	disk, validDisk := applicationInteger(input["disk"])
	if !validMemory || memory < 128 || memory > 1048576 || !validDisk || disk < 128 || disk > 16777216 {
		fail(w, bad("Choose valid memory and storage limits."))
		return
	}
	image := str(input["image"])
	validImage := false
	for _, value := range asMap(egg["docker_images"]) {
		if image == str(value) {
			validImage = true
		}
	}
	if !validImage {
		fail(w, bad("Choose a listed runtime image."))
		return
	}
	env, err := templateEnvironment(variables, input["environment"])
	if err != nil {
		fail(w, err)
		return
	}
	primary, validPrimary := applicationInteger(input["allocation_id"])
	if !validPrimary || primary < 1 {
		fail(w, bad("Choose an available game port."))
		return
	}
	additional := []any{}
	seen := map[int64]bool{primary: true}
	if input["allocation_additional"] != nil {
		raw, ok := input["allocation_additional"].([]any)
		if !ok || len(raw) > 32 {
			fail(w, bad("Choose up to 32 additional ports."))
			return
		}
		for _, value := range raw {
			id, ok := applicationInteger(value)
			if !ok || id < 1 || seen[id] {
				fail(w, bad("Additional ports must be distinct allocations."))
				return
			}
			seen[id] = true
			additional = append(additional, id)
		}
	}
	ctx := r.Context()
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	defer steamUnlock(conn)
	prefix := fmt.Sprintf("catalog:%d:%s:", num(user["id"]), requestID)
	if err = steamSessionLock(ctx, conn, prefix); err != nil {
		fail(w, err)
		return
	}
	encoded, _ := json.Marshal(M{"template": entry.ID, "name": name, "memory": memory, "disk": disk, "image": image, "environment": env, "primary": primary, "additional": additional})
	sum := sha256.Sum256(encoded)
	externalID := prefix + hex.EncodeToString(sum[:])
	existing, err := a.one(ctx, "SELECT * FROM servers WHERE external_id LIKE $1", prefix+"%")
	if err == nil {
		if str(existing["external_id"]) != externalID {
			fail(w, APIError{409, "InstallationRequestConflict", "This request was already used for different settings."})
			return
		}
		writeJSON(w, 200, item("game_installation", M{"identifier": existing["uuid_short"], "name": existing["name"], "status": existing["status"]}))
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		fail(w, err)
		return
	}
	allocation, err := a.one(ctx, "SELECT a.*,n.public,n.maintenance_mode FROM allocations a JOIN nodes n ON n.id=a.node_id WHERE a.id=$1 AND a.server_id IS NULL", primary)
	if err != nil {
		fail(w, bad("The game port is no longer available."))
		return
	}
	if !boolean(allocation["public"]) || boolean(allocation["maintenance_mode"]) {
		fail(w, bad("Choose an available node."))
		return
	}
	nodeID := num(allocation["node_id"])
	additionalAllocations := []M{}
	for _, id := range additional {
		extra, allocationErr := a.one(ctx, "SELECT id,ip,port FROM allocations WHERE id=$1 AND node_id=$2 AND server_id IS NULL", id, nodeID)
		if allocationErr != nil {
			fail(w, bad("All ports must be available on the same node."))
			return
		}
		additionalAllocations = append(additionalAllocations, extra)
	}
	// The idempotency digest above intentionally uses the operator's raw values.
	// Resolve automatic ports only after reading the exact selected allocations,
	// and persist a copy so retrying the same blank request still matches.
	env, err = normalizeTemplatePortEnvironment(entry, env, allocation, additionalAllocations)
	if err != nil {
		fail(w, err)
		return
	}
	if err = validateTemplatePortLayout(entry, allocation, additionalAllocations); err != nil {
		fail(w, err)
		return
	}
	if err = validateTemplatePortRules(entry, env, allocation, additionalAllocations); err != nil {
		fail(w, err)
		return
	}
	node, err := a.node(ctx, nodeID)
	if err != nil {
		fail(w, err)
		return
	}
	if err = steamSessionLock(ctx, conn, fmt.Sprintf("voltra:steam-node-provision:%d", nodeID)); err != nil {
		fail(w, err)
		return
	}
	if _, err = a.steamGameAllocations(ctx, node, steamGameSpec{Ports: 1, Disk: disk}, memory); err != nil {
		fail(w, err)
		return
	}
	// Authenticate Wings before importing anything or creating the server record.
	probe, err := a.daemon(ctx, node, "GET", "/api/system?v=2", nil)
	if err != nil {
		fail(w, err)
		return
	}
	if len(entry.Platforms) > 0 {
		var system M
		err = json.NewDecoder(io.LimitReader(probe.Body, 64<<10)).Decode(&system)
		probe.Body.Close()
		if err != nil {
			fail(w, bad("Could not verify the node platform. Retry after checking Wings."))
			return
		}
		platform := gameTemplateNodePlatform(system)
		if !gameTemplateSupportsPlatform(entry, platform) {
			fail(w, bad("This recipe requires "+strings.Join(entry.Platforms, ", ")+". This node reports "+platform+"."))
			return
		}
	} else {
		probe.Body.Close()
	}
	imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
	if err != nil {
		fail(w, err)
		return
	}
	server, err := a.createServer(ctx, M{"name": name, "description": str(entry.Egg["description"]), "owner_id": user["id"], "egg_id": imported["id"], "external_id": externalID, "image": image, "startup": egg["startup"], "node_id": nodeID, "allocation_id": primary, "allocation_additional": additional, "allocation_limit": len(additional), "memory": memory, "swap": 0, "disk": disk, "io": 500, "cpu": 0, "backup_limit": 1, "start_on_completion": false, "environment": env})
	if err != nil {
		fail(w, err)
		return
	}
	_ = a.audit(ctx, num(user["id"]), num(server["id"]), "server:game-library.template-install", M{"template": entry.ID, "revision": gameTemplates().Revision})
	writeJSON(w, 201, item("game_installation", M{"identifier": server["uuid_short"], "name": server["name"], "status": server["status"]}))
}

func (a *App) ensureGameTemplateEgg(ctx context.Context, entry gameTemplate, egg M, variables []M) (M, error) {
	// Pin identity to recipe content so a later catalog update cannot silently
	// replace an installed egg or change an existing server's behavior.
	sum := sha256.Sum256([]byte(entry.Path + ":" + entry.SHA256))
	h := hex.EncodeToString(sum[:16])
	uuid := h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer steamUnlock(conn)
	if err = steamSessionLock(ctx, conn, "catalog-egg:"+uuid); err != nil {
		return nil, err
	}
	existing, err := a.one(ctx, "SELECT * FROM eggs WHERE uuid=$1", uuid)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var nestID int64
	err = conn.QueryRow(ctx, `INSERT INTO nests(uuid,author,name,description) VALUES('6bc33bb9-5268-4aa7-b8e8-f31c10b13239','library@voltra.local','Community game templates','Pinned upstream recipes. Game runtime acceptance is tracked separately.') ON CONFLICT(uuid) DO UPDATE SET uuid=EXCLUDED.uuid RETURNING id`).Scan(&nestID)
	if err != nil {
		return nil, err
	}
	egg["uuid"] = uuid
	egg["nest_id"] = nestID
	return a.importEggRecord(ctx, 0, egg, variables)
}
