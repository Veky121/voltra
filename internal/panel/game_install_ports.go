package panel

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

type gamePlannedPort struct {
	Port          int64  `json:"port"`
	PreferredPort int64  `json:"preferred_port"`
	Role          string `json:"role"`
	Reason        string `json:"reason,omitempty"`
}
type gamePortPlan struct {
	IP         string            `json:"ip"`
	Ports      []gamePlannedPort `json:"ports"`
	Detail     string            `json:"detail"`
	Forwarding M                 `json:"forwarding"`
}

func gamePortBindIP(allocations []M) string {
	for _, allocation := range allocations {
		ip := net.ParseIP(str(allocation["ip"]))
		if ip != nil && !ip.IsLoopback() && !ip.IsUnspecified() && !ip.IsMulticast() && !ip.IsLinkLocalUnicast() {
			return ip.String()
		}
	}
	// Preserve an explicitly configured local-only bind when no reachable
	// address was configured. Inventing a wildcard would overlap these rows.
	for _, allocation := range allocations {
		ip := net.ParseIP(str(allocation["ip"]))
		if ip != nil && ip.IsLoopback() {
			return ip.String()
		}
	}
	return "0.0.0.0"
}
func gamePortIPsOverlap(a, b string) bool {
	x, y := net.ParseIP(a), net.ParseIP(b)
	return x == nil || y == nil || x.IsUnspecified() || y.IsUnspecified() || x.Equal(y)
}
func gamePortReserved(node M, port int64) bool {
	if port < 1024 || port > 65535 {
		return true
	}
	for _, p := range []int64{num(node["daemon_listen"]), num(node["daemon_sftp"]), 2022, 2375, 2376, 3306, 5432, 6379, 8080, 8088, 8443, 9090} {
		if p > 0 && p == port {
			return true
		}
	}
	return false
}
func gamePreferredPort(entry gameTemplate) int64 {
	if p := num(entry.Defaults["port"]); p >= 1024 && p <= 65535 {
		return p
	}
	for _, key := range []string{"SERVER_PORT", "GAME_PORT", "PORT", "SRV_PORT", "srv_port", "port"} {
		for _, v := range asSlice(entry.Egg["variables"]) {
			m := asMap(v)
			if str(m["env_variable"]) == key {
				if p, e := strconv.ParseInt(str(m["default_value"]), 10, 64); e == nil && p >= 1024 && p <= 65535 {
					return p
				}
			}
		}
	}
	// Common audited recipes do not expose their allocation-backed port as an egg variable.
	path := strings.ToLower(entry.Path + " " + entry.ID)
	for _, v := range []struct {
		key  string
		port int64
	}{{"bedrock", 19132}, {"minecraft", 25565}, {"openttd", 3979}, {"terraria", 7777}, {"valheim", 2456}, {"7days", 26900}, {"7-days", 26900}, {"satisfactory", 7777}, {"palworld", 8211}, {"factorio", 34197}, {"zomboid", 16261}, {"rust", 28015}, {"vrising", 9876}, {"v-rising", 9876}, {"starbound", 21025}, {"unturned", 27015}, {"teeworlds", 8303}, {"xonotic", 26000}} {
		if strings.Contains(path, v.key) {
			return v.port
		}
	}
	return 27015
}

// planGamePortLayout is pure: all candidates pass the same metadata validators as explicit installs.
func planGamePortLayout(node M, allocations []M, entry gameTemplate, environment M) (gamePortPlan, M, error) {
	ip := gamePortBindIP(allocations)
	plan := gamePortPlan{IP: ip, Ports: []gamePlannedPort{}, Detail: "Database allocation conflicts checked. Host socket availability has not been checked.", Forwarding: M{"status": "unknown", "detail": "Internet reachability and forwarding have not been verified."}}
	for _, rule := range entry.PortRules {
		if err := validateTemplatePortRuleMetadata(rule); err != nil {
			return plan, nil, err
		}
	}
	preferred := gamePreferredPort(entry)
	blockedReason := func(p int64) string {
		for _, rule := range entry.PortRules {
			if templatePortRuleActive(rule, environment) {
				for _, excluded := range rule.ExcludePorts {
					if p == int64(excluded) {
						return "Port is reserved by this recipe for a native role."
					}
				}
			}
		}
		if gamePortReserved(node, p) {
			return "Preferred port is reserved for node management or outside the allowed port range."
		}
		for _, allocation := range allocations {
			if num(allocation["port"]) == p && gamePortIPsOverlap(ip, str(allocation["ip"])) {
				if num(allocation["server_id"]) == -1 {
					return "Node bind check reports the preferred port unavailable: " + str(allocation["notes"])
				}
				if allocation["server_id"] != nil {
					return "Preferred port is allocated to another server."
				}
				if str(allocation["ip"]) != ip {
					return "Preferred port overlaps an existing allocation on a wildcard or another bind address."
				}
			}
		}
		return ""
	}
	available := func(p int64) bool { return blockedReason(p) == "" }
	fallbackReason := blockedReason(preferred)
	if !gamePortHasDeclaredPreference(entry) {
		plan.Detail += " This recipe has no declared preferred port; the search starts at 27015."
	}
	searchStart := preferred
	for _, rule := range entry.PortRules {
		if templatePortRuleActive(rule, environment) && preferred > int64(rule.Maximum) {
			searchStart = int64(rule.Minimum)
			fallbackReason = "Recipe port range requires a different starting port."
		}
	}
	for primary := searchStart; primary <= 65535; primary++ {
		if !available(primary) {
			continue
		}
		env := M{}
		for k, v := range environment {
			env[k] = v
		}
		ports := []gamePlannedPort{}
		selected := map[int64]bool{}
		add := func(port, pref int64, role string) bool {
			if selected[port] {
				return true
			}
			if !available(port) {
				return false
			}
			selected[port] = true
			reason := ""
			if port != pref {
				reason = blockedReason(pref)
				if reason == "" {
					reason = fallbackReason
				}
				if reason == "" {
					reason = "A companion port or recipe port rule requires this port layout."
				}
			}
			ports = append(ports, gamePlannedPort{port, pref, role, reason})
			return true
		}
		if !add(primary, preferred, "game") {
			continue
		}
		valid := true
		if entry.ConsecutivePorts {
			count := entry.ConsecutivePortsCount
			if count == 0 {
				count = max(1, entry.RequiredPorts)
			}
			for offset := 0; offset < count; offset++ {
				delta := int64(offset - entry.ConsecutivePrimaryOffset)
				if !add(primary+delta, preferred+delta, fmt.Sprintf("game%+d", delta)) {
					if fallbackReason == "" {
						fallbackReason = fmt.Sprintf("Game port moved because companion port %d is unavailable: %s", primary+delta, blockedReason(primary+delta))
					}
					valid = false
					break
				}
			}
		}
		if !valid {
			continue
		}
		minimum, maximum, count := int64(1024), int64(65535), max(1, entry.RequiredPorts)
		active := []templatePortRule{}
		for _, rule := range entry.PortRules {
			if !templatePortRuleActive(rule, env) {
				continue
			}
			active = append(active, rule)
			minimum = max(minimum, int64(rule.Minimum))
			maximum = min(maximum, int64(rule.Maximum))
			count = max(count, rule.Count)
			for _, offset := range rule.Offsets {
				if !add(primary+int64(offset), preferred+int64(offset), fmt.Sprintf("game%+d", offset)) {
					if fallbackReason == "" {
						fallbackReason = fmt.Sprintf("Game port moved because required relative port %d is unavailable: %s", primary+int64(offset), blockedReason(primary+int64(offset)))
					}
					valid = false
				}
			}
		}
		if !valid || primary < minimum || primary > maximum {
			continue
		}
		// Reserve explicitly selected service roles before choosing automatic roles.
		sort.SliceStable(active, func(i, j int) bool {
			return str(env[active[i].Environment]) != "" && str(env[active[j].Environment]) == ""
		})
		for _, rule := range active {
			if !rule.AllocatedValue {
				continue
			}
			raw := str(env[rule.Environment])
			service, e := templateExplicitPort(raw)
			explicit := raw != ""
			if explicit && e != nil {
				return plan, nil, e
			}
			if explicit {
				for _, delta := range append([]int{0}, rule.AllocatedOffsets...) {
					for _, excluded := range rule.ExcludePorts {
						if service+int64(delta) == int64(excluded) {
							return plan, nil, bad("The configured service port or companion uses an excluded native port.")
						}
					}
				}
			}
			servicePreferred := service
			if !explicit {
				service = primary + 1
				servicePreferred = preferred + 1
			}
			found := false
			for ; service <= maximum; service++ {
				eligible := true
				for _, delta := range append([]int{0}, rule.AllocatedOffsets...) {
					p := service + int64(delta)
					if p < minimum || p > maximum || selected[p] || !available(p) {
						eligible = false
					}
					for _, excluded := range rule.ExcludePorts {
						if p == int64(excluded) {
							eligible = false
						}
					}
					for _, excluded := range rule.ExcludeOffsets {
						if p == primary+int64(excluded) {
							eligible = false
						}
					}
				}
				if eligible {
					found = true
					break
				}
			}
			if !found {
				valid = false
				break
			}
			for _, offset := range append([]int{0}, rule.AllocatedOffsets...) {
				add(service+int64(offset), servicePreferred+int64(offset), rule.Environment)
			}
			env[rule.Environment] = strconv.FormatInt(service, 10)
		}
		if !valid {
			continue
		}
		if entry.ID == "satisfactory" && len(ports) == 1 {
			start := int64(8888)
			if p := num(env["RELIABLE_PORT"]); p > 0 {
				start = p
			}
			for p := start; p <= maximum; p++ {
				if !selected[p] && add(p, start, "reliable") {
					break
				}
			}
		}
		for p := max(primary+1, minimum); len(ports) < count && p <= maximum; p++ {
			add(p, preferred+int64(len(ports)), "auxiliary")
		}
		if len(ports) < count {
			continue
		}
		rows := []M{}
		for i, p := range ports {
			rows = append(rows, M{"id": int64(i + 1), "ip": ip, "port": p.Port})
		}
		resolved, e := normalizeTemplatePortEnvironment(entry, env, rows[0], rows[1:])
		if e != nil {
			continue
		}
		if validateTemplatePortLayout(entry, rows[0], rows[1:]) != nil || validateTemplatePortRules(entry, resolved, rows[0], rows[1:]) != nil {
			continue
		}
		plan.Ports = ports
		return plan, resolved, nil
	}
	return plan, nil, bad("No available game port layout satisfies this recipe on the selected node.")
}

func (a *App) planGamePorts(ctx context.Context, node M, entry gameTemplate, env M) (gamePortPlan, M, error) {
	allocations, err := a.query(ctx, "SELECT id,ip,port,server_id FROM allocations WHERE node_id=$1 ORDER BY id", node["id"])
	if err != nil {
		return gamePortPlan{}, nil, err
	}
	for attempt := 0; attempt < 128; attempt++ {
		plan, resolved, e := planGamePortLayout(node, allocations, entry, env)
		if e != nil {
			return plan, nil, e
		}
		ports := []int64{}
		for _, p := range plan.Ports {
			ports = append(ports, p.Port)
		}
		probe, e := a.probeGamePortAvailability(ctx, node, plan.IP, ports)
		if e != nil {
			return plan, nil, e
		}
		if str(probe["status"]) != "verified" {
			plan.Detail += " " + str(probe["detail"])
			return plan, resolved, nil
		}
		blocked := false
		for _, raw := range asSlice(probe["ports"]) {
			p := asMap(raw)
			if !boolean(p["tcp_available"]) || !boolean(p["udp_available"]) {
				reason := str(p["reason"])
				if strings.Contains(reason, "bind_address_unavailable") || strings.Contains(reason, "permission_denied") {
					return plan, nil, bad("Node cannot bind game ports on " + plan.IP + ": " + reason + ". Check the node bind address and permissions.")
				}
				blocked = true
				allocations = append(allocations, M{"ip": plan.IP, "port": p["port"], "server_id": int64(-1), "notes": str(p["reason"])})
			}
		}
		if !blocked {
			plan.Detail = "Database allocation conflicts checked. The node verified a TCP/UDP bind snapshot; availability can change before startup."
			return plan, resolved, nil
		}
	}
	return gamePortPlan{}, nil, bad("Could not find a free game port after checking the node. Retry after reviewing the node's listeners.")
}

// The caller owns the node session lock until createServer atomically assigns these rows.
func (a *App) provisionGamePorts(ctx context.Context, node M, plan gamePortPlan) ([]M, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows := []M{}
	for _, port := range plan.Ports {
		var id int64
		err = tx.QueryRow(ctx, `INSERT INTO allocations(node_id,ip,port) VALUES($1,$2,$3) ON CONFLICT(node_id,ip,port) DO UPDATE SET ip=EXCLUDED.ip WHERE allocations.server_id IS NULL RETURNING id`, node["id"], plan.IP, port.Port).Scan(&id)
		if err != nil {
			return nil, err
		}
		rows = append(rows, M{"id": id, "ip": plan.IP, "port": port.Port})
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return rows, nil
}

func steamPortTemplate(spec steamGameSpec) gameTemplate {
	return gameTemplate{ID: spec.ID, RequiredPorts: spec.Ports, ConsecutivePorts: spec.ConsecutivePorts}
}
func (a *App) gameInstallPortResponse(ctx context.Context, server M, entry gameTemplate) gamePortPlan {
	if saved, err := a.one(ctx, "SELECT properties FROM activity_logs WHERE server_id=$1 AND event='server:game-library.ports' ORDER BY id DESC LIMIT 1", server["id"]); err == nil {
		var plan gamePortPlan
		raw, _ := json.Marshal(saved["properties"])
		if json.Unmarshal(raw, &plan) == nil && len(plan.Ports) > 0 {
			return plan
		}
	}
	rows, err := a.query(ctx, "SELECT ip,port FROM allocations WHERE server_id=$1 ORDER BY (id=$2) DESC,id", server["id"], server["allocation_id"])
	plan := gamePortPlan{Ports: []gamePlannedPort{}, Detail: "Assigned server allocations. Host socket availability has not been checked.", Forwarding: M{"status": "unknown", "detail": "Internet reachability and forwarding have not been verified."}}
	if err != nil {
		return plan
	}
	for i, row := range rows {
		role := "auxiliary"
		if i == 0 {
			role = "game"
			plan.IP = str(row["ip"])
		}
		plan.Ports = append(plan.Ports, gamePlannedPort{Port: num(row["port"]), PreferredPort: gamePreferredPort(entry) + int64(i), Role: role})
	}
	return plan
}

func (a *App) gameTemplatePorts(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	entry, ok := gameTemplateFor(r.PathValue("template"))
	if !ok {
		fail(w, notFound())
		return
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		fail(w, err)
		return
	}
	in, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	raw := in["environment"]
	if raw == nil {
		raw = M{}
	}
	env, err := templateEnvironment(variables, raw)
	if err != nil {
		fail(w, err)
		return
	}
	a.writeGamePortPreview(w, r, in, entry, env)
}
func (a *App) steamGamePorts(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	spec, ok := steamGameSpecFor(r.PathValue("game"))
	if !ok {
		fail(w, notFound())
		return
	}
	in, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	entry := steamPortTemplate(spec)
	portEnvironment := M{}
	if in["environment"] != nil {
		environment, ok := in["environment"].(map[string]any)
		if !ok {
			fail(w, bad("Environment controls must be an object."))
			return
		}
		// Only Satisfactory has a configurable allocation role. Keep credentials
		// and unrelated advanced controls out of the port plan entirely.
		if spec.ID == "satisfactory" {
			input := M{}
			if value, present := environment["RELIABLE_PORT"]; present {
				input["RELIABLE_PORT"] = value
			}
			configuration, err := steamCatalogParse(spec.ID, input, spec.Players)
			if err != nil {
				fail(w, err)
				return
			}
			portEnvironment["RELIABLE_PORT"] = configuration.Values["RELIABLE_PORT"]
		}
	}
	a.writeGamePortPreview(w, r, in, entry, portEnvironment)
}
func (a *App) minecraftGamePorts(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	in, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	a.writeGamePortPreview(w, r, in, gameTemplate{ID: "minecraft"}, M{})
}
func (a *App) writeGamePortPreview(w http.ResponseWriter, r *http.Request, in M, entry gameTemplate, env M) {
	nodeID, ok := applicationInteger(in["node_id"])
	if !ok || nodeID < 1 {
		fail(w, bad("Choose a node to preview game ports."))
		return
	}
	node, err := a.node(r.Context(), nodeID)
	if err != nil {
		fail(w, err)
		return
	}
	if !boolean(node["public"]) || boolean(node["maintenance_mode"]) {
		fail(w, bad("Choose an available node."))
		return
	}
	plan, _, err := a.planGamePorts(r.Context(), node, entry, env)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("game_port_plan", M{"ip": plan.IP, "ports": plan.Ports, "detail": plan.Detail, "forwarding": plan.Forwarding}))
}

func (a *App) finishGamePortPlan(ctx context.Context, user, node, server M, entry gameTemplate, plan gamePortPlan) gamePortPlan {
	if len(plan.Ports) == 0 {
		plan = a.gameInstallPortResponse(ctx, server, entry)
	}
	plan.Forwarding = a.forwardGamePorts(ctx, node, server, entry, plan)
	raw, _ := json.Marshal(plan)
	properties := M{}
	_ = json.Unmarshal(raw, &properties)
	_ = a.audit(ctx, num(user["id"]), num(server["id"]), "server:game-library.ports", properties)
	return plan
}

func gamePortHasDeclaredPreference(entry gameTemplate) bool {
	if num(entry.Defaults["port"]) > 0 {
		return true
	}
	for _, v := range asSlice(entry.Egg["variables"]) {
		m := asMap(v)
		switch str(m["env_variable"]) {
		case "SERVER_PORT", "GAME_PORT", "PORT", "SRV_PORT", "srv_port", "port":
			if p, e := strconv.ParseInt(str(m["default_value"]), 10, 64); e == nil && p >= 1024 && p <= 65535 {
				return true
			}
		}
	}
	return gamePreferredPort(entry) != 27015 || strings.Contains(strings.ToLower(entry.Path+entry.ID), "unturned")
}
