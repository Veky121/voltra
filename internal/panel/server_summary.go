package panel

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// clientServerSummaries is opt-in: the detailed client list remains unchanged.
// Access is evaluated in SQL on every request, never cached.
func (a *App) clientServerSummaries(w http.ResponseWriter, r *http.Request, user M) {
	q := r.URL.Query()
	kind := q.Get("type")
	if kind == "" && boolean(user["root_admin"]) {
		kind = "admin-all"
	}
	args := []any{num(user["id"]), boolean(user["root_admin"]), kind}
	where := ` WHERE (($2 AND $3='admin-all') OR ($2 AND $3='admin' AND s.owner_id<>$1 AND NOT EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=s.id AND su.user_id=$1)) OR ($3='owner' AND s.owner_id=$1) OR ($3 NOT IN ('admin','admin-all','owner') AND (s.owner_id=$1 OR EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=s.id AND su.user_id=$1))))`
	for _, key := range []string{"uuid", "name", "description", "external_id", "*"} {
		if term := q.Get("filter[" + key + "]"); term != "" {
			args = append(args, term)
			column := "COALESCE(s." + key + ",'')"
			if key == "*" {
				column = "(s.name || s.uuid || s.description)"
			}
			where += fmt.Sprintf(" AND strpos(lower(%s),lower($%d))>0", column, len(args))
		}
	}
	if q.Get("states") == "1" {
		states, err := a.query(r.Context(), "SELECT s.uuid,s.status FROM servers s"+where+" ORDER BY s.id", args...)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 200, collection("server_state", states))
		return
	}
	count, err := a.one(r.Context(), "SELECT count(*) AS total FROM servers s"+where, args...)
	if err != nil {
		fail(w, err)
		return
	}
	per, _ := strconv.Atoi(q.Get("per_page"))
	if per < 1 {
		per = 50
	}
	if per > 100 {
		per = 100
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	total := num(count["total"])
	// Clamp before multiplying to avoid overflow for hostile page parameters.
	offset := total
	if int64(page-1) <= total/int64(per) {
		offset = int64(page-1) * int64(per)
	}
	args = append(args, per, offset)
	records, err := a.query(r.Context(), `SELECT s.*,n.name AS summary_node,n.maintenance_mode AS summary_maintenance,to_jsonb(e) AS summary_egg,
 COALESCE((SELECT su.permissions FROM subusers su WHERE su.server_id=s.id AND su.user_id=$1),'[]'::jsonb) AS summary_permissions,
 EXISTS(SELECT 1 FROM server_transfers t WHERE t.server_id=s.id AND t.successful IS NULL) AS summary_transferring
 FROM servers s JOIN nodes n ON n.id=s.node_id JOIN eggs e ON e.id=s.egg_id`+where+fmt.Sprintf(" ORDER BY s.id LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		fail(w, err)
		return
	}
	ids := []int64{}
	for _, s := range records {
		ids = append(ids, num(s["id"]))
	}
	variables := map[int64][]M{}
	if len(ids) > 0 {
		vars, e := a.query(r.Context(), `SELECT s.id AS server_id,ev.env_variable,COALESCE(sv.variable_value,ev.default_value) AS server_value FROM servers s JOIN egg_variables ev ON ev.egg_id=s.egg_id LEFT JOIN server_variables sv ON sv.server_id=s.id AND sv.variable_id=ev.id WHERE s.id=ANY($1::bigint[]) AND ev.user_viewable AND (ev.env_variable IN ('MINECRAFT_LOADER','DISCORD_TOKEN','DISCORD_BOT_TOKEN','DISCORD_CLIENT_ID') OR ev.env_variable ~* 'APP_?ID') ORDER BY ev.id`, ids)
		if e != nil {
			fail(w, e)
			return
		}
		for _, v := range vars {
			id := num(v["server_id"])
			variables[id] = append(variables[id], serverSummaryVariable(v))
		}
	}
	out := []any{}
	for _, s := range records {
		out = append(out, item("server", serverSummary(user, s, variables[num(s["id"])])))
	}
	pages := (total + int64(per) - 1) / int64(per)
	if pages < 1 {
		pages = 1
	}
	writeJSON(w, 200, M{"object": "list", "data": out, "meta": M{"pagination": M{"total": total, "count": len(out), "per_page": per, "current_page": page, "total_pages": pages, "links": M{}}}})
}

// Artwork needs only recognized loader IDs or numeric app IDs. Never forward
// arbitrary startup values, including credentials bound to an unexpected name.
func serverSummaryVariable(variable M) M {
	name := str(variable["env_variable"])
	value := ""
	if name == "MINECRAFT_LOADER" {
		value = strings.ToLower(strings.TrimSpace(str(variable["server_value"])))
		if !minecraftLoaderKnown(value) {
			value = "unknown"
		}
	} else if upper := strings.ToUpper(name); upper == "APP_ID" || upper == "APPID" || upper == "STEAM_APP_ID" || upper == "STEAMAPPID" {
		if id, err := strconv.ParseInt(str(variable["server_value"]), 10, 64); err == nil && id > 0 {
			value = strconv.FormatInt(id, 10)
		}
	}
	return M{"env_variable": name, "server_value": value}
}

func serverSummary(user, s M, variables []M) M {
	egg := asMap(s["summary_egg"])
	privileged := boolean(user["root_admin"]) || num(user["id"]) == num(s["owner_id"])
	grants := asSlice(s["summary_permissions"])
	artwork := M{}
	if serverArtworkMinecraftWorkload(s, egg) {
		artwork["game"] = "minecraft"
		base := "/api/client/servers/" + str(s["uuid"]) + "/artwork/"
		if privileged || hasServerPermission(grants, "file.read-content") {
			artwork["server_icon"] = base + "icon"
		}
		pack := asMap(s["minecraft_pack"])
		if str(pack["name"]) != "" {
			artwork["pack_name"] = pack["name"]
		}
		if mcContentIcon(str(pack["icon_url"])) != "" {
			artwork["pack_icon"] = base + "pack"
		}
	}
	if !privileged && !hasServerPermission(grants, "startup.read") {
		variables = nil
	}
	return M{"identifier": s["uuid_short"], "uuid": s["uuid"], "name": s["name"], "description": s["description"], "node": s["summary_node"], "is_node_under_maintenance": s["summary_maintenance"], "limits": serverLimits(s), "game": clientGameID(egg), "egg_name": egg["name"], "docker_image": s["image"], "status": s["status"], "is_installing": !serverInstalled(s), "is_suspended": str(s["status"]) == "suspended", "is_transferring": s["summary_transferring"], "artwork": artwork, "relationships": M{"variables": collection("egg_variable", variables)}}
}
