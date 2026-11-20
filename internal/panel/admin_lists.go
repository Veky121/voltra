package panel

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Admin server and node lists filter and page in SQL, then present only the
// rows of the requested page with one query per related table, not per row.

var applicationServerListFilter = listFilterSQL{
	Exact:     map[string]bool{"id": true, "uuid": true, "external_id": true, "owner_id": true, "node_id": true},
	Substring: map[string]bool{"name": true},
	SkipEmpty: true,
}

func (a *App) lifecycleList(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	page := parseListPage(r.URL.Query(), 50, 100)
	// filter[search] is what the admin table's search box sends: a name, the
	// short identifier shown beside it, or the start of the UUID.
	search := strings.TrimSpace(page.Filters["search"])
	delete(page.Filters, "search")
	where, args := applicationServerListFilter.where(page.Filters, nil)
	if search != "" {
		args = append(args, search)
		slot := "$" + strconv.Itoa(len(args))
		where = "(" + where + ") AND (strpos(lower(COALESCE(name,'')),lower(" + slot + "))>0 OR strpos(lower(COALESCE(identifier,'')),lower(" + slot + "))>0 OR starts_with(lower(uuid::text),lower(" + slot + ")))"
	}
	count, err := a.one(ctx, "SELECT COUNT(*)::bigint AS total FROM servers WHERE "+where, args...)
	if err != nil {
		fail(w, err)
		return
	}
	args = append(args, page.PerPage, page.Offset())
	servers, err := a.query(ctx, "SELECT * FROM servers WHERE "+where+" ORDER BY id LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		fail(w, err)
		return
	}
	out, err := a.applicationServers(ctx, servers)
	if err != nil {
		fail(w, err)
		return
	}
	if err = a.applicationServerIncludesBatch(r, servers, out); err != nil {
		fail(w, err)
		return
	}
	response := collection("server", out)
	response["meta"] = page.Meta(int(num(count["total"])), len(out))
	writeJSON(w, 200, response)
}

func int64IDs(rows []M, key string) []int64 {
	seen := map[int64]bool{}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		if id := num(row[key]); id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func (a *App) rowsByID(ctx context.Context, sql string, ids []int64, key string) (map[int64]M, error) {
	out := map[int64]M{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := a.query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[num(row[key])] = row
	}
	return out, nil
}

func (a *App) rowsGrouped(ctx context.Context, sql string, ids []int64, key string) (map[int64][]M, error) {
	out := map[int64][]M{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := a.query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[num(row[key])] = append(out[num(row[key])], row)
	}
	return out, nil
}

// applicationServers presents servers as applicationServer does, reading the
// environment of every server in two queries.
func (a *App) applicationServers(ctx context.Context, servers []M) ([]M, error) {
	out := make([]M, 0, len(servers))
	if len(servers) == 0 {
		return out, nil
	}
	serverIDs, eggIDs := make([]int64, len(servers)), make([]int64, len(servers))
	for i, s := range servers {
		serverIDs[i], eggIDs[i] = num(s["id"]), num(s["egg_id"])
	}
	variables, err := a.query(ctx, `SELECT s.id AS server_id,ev.env_variable,COALESCE(sv.variable_value,ev.default_value) AS value
FROM unnest($1::bigint[],$2::bigint[]) AS s(id,egg_id)
JOIN egg_variables ev ON ev.egg_id=s.egg_id
LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=s.id
ORDER BY s.id,ev.id`, serverIDs, eggIDs)
	if err != nil {
		return nil, err
	}
	environments := map[int64]M{}
	for _, v := range variables {
		id := num(v["server_id"])
		if environments[id] == nil {
			environments[id] = M{}
		}
		environments[id][str(v["env_variable"])] = v["value"]
	}
	locations, err := a.rowsByID(ctx, "SELECT n.id,l.short FROM nodes n JOIN locations l ON l.id=n.location_id WHERE n.id=ANY($1::bigint[])", int64IDs(servers, "node_id"), "id")
	if err != nil {
		return nil, err
	}
	for _, s := range servers {
		location, ok := locations[num(s["node_id"])]
		if !ok {
			return nil, pgx.ErrNoRows
		}
		env := environments[num(s["id"])]
		if env == nil {
			env = M{}
		}
		env["STARTUP"] = s["startup"]
		env["P_SERVER_UUID"] = s["uuid"]
		env["P_SERVER_LOCATION"] = location["short"]
		out = append(out, applicationServerAttributes(s, env))
	}
	return out, nil
}

// Scopes an application API key needs to read each server include.
var applicationServerIncludeScopes = map[string]string{"allocations": "allocations", "user": "users", "subusers": "users", "nest": "nests", "egg": "eggs", "variables": "servers", "location": "locations", "node": "nodes", "databases": "server_databases", "transfer": "servers"}

func (a *App) applicationServerIncludes(r *http.Request, s, out M) error {
	return a.applicationServerIncludesBatch(r, []M{s}, []M{out})
}

// applicationServerIncludesBatch adds the requested relationships to each
// presented server in outs, reading each related table once for all servers.
func (a *App) applicationServerIncludesBatch(r *http.Request, servers, outs []M) error {
	ctx := r.Context()
	includes, seen := []string{}, map[string]bool{}
	for _, include := range strings.Split(r.URL.Query().Get("include"), ",") {
		if applicationServerIncludeScopes[include] != "" && !seen[include] {
			seen[include] = true
			includes = append(includes, include)
		}
	}
	if len(includes) == 0 || len(servers) == 0 {
		return nil
	}
	serverIDs := int64IDs(servers, "id")
	relationships := make([]M, len(servers))
	for i := range relationships {
		relationships[i] = M{}
	}
	single := func(include, object string, related map[int64]M, key string) error {
		for i, s := range servers {
			row, ok := related[num(s[key])]
			if !ok {
				return pgx.ErrNoRows
			}
			relationships[i][include] = item(object, row)
		}
		return nil
	}
	list := func(include, object string, grouped map[int64][]M) {
		for i, s := range servers {
			relationships[i][include] = collection(object, grouped[num(s["id"])])
		}
	}
	for _, include := range includes {
		if key, ok := ctx.Value(apiKeyContextKey{}).(M); ok && !applicationScopeAllowed(asMap(key["permissions"]), http.MethodGet, "/api/application/"+applicationServerIncludeScopes[include]) {
			for i := range servers {
				relationships[i][include] = M{"object": "null", "attributes": nil}
			}
			continue
		}
		var err error
		switch include {
		case "allocations":
			var grouped map[int64][]M
			if grouped, err = a.rowsGrouped(ctx, "SELECT * FROM allocations WHERE server_id=ANY($1::bigint[]) ORDER BY id", serverIDs, "server_id"); err == nil {
				for id, rows := range grouped {
					for i, v := range rows {
						rows[i] = M{"id": v["id"], "ip": v["ip"], "alias": v["ip_alias"], "port": v["port"], "notes": v["notes"], "assigned": v["server_id"] != nil}
					}
					grouped[id] = rows
				}
				list(include, "allocation", grouped)
			}
		case "user":
			var users map[int64]M
			if users, err = a.rowsByID(ctx, "SELECT id,uuid,external_id,username,nickname,name_first,name_last,root_admin,language,created_at,updated_at FROM users WHERE id=ANY($1::bigint[])", int64IDs(servers, "owner_id"), "id"); err == nil {
				for id, u := range users {
					users[id] = userAttributes(u)
				}
				err = single(include, "user", users, "owner_id")
			}
		case "subusers":
			var grouped map[int64][]M
			if grouped, err = a.rowsGrouped(ctx, "SELECT * FROM subusers WHERE server_id=ANY($1::bigint[]) ORDER BY id", serverIDs, "server_id"); err == nil {
				list(include, "subuser", grouped)
			}
		case "nest":
			var nests map[int64]M
			if nests, err = a.rowsByID(ctx, "SELECT * FROM nests WHERE id=ANY($1::bigint[])", int64IDs(servers, "nest_id"), "id"); err == nil {
				err = single(include, "nest", nests, "nest_id")
			}
		case "egg":
			// Eggs resolve inheritance; servers commonly share a few eggs.
			eggs := map[int64]M{}
			for _, id := range int64IDs(servers, "egg_id") {
				row, e := a.effectiveEgg(ctx, id)
				if e == nil {
					row, e = a.eggAttributes(r, row)
				}
				if e != nil {
					return e
				}
				eggs[id] = row
			}
			err = single(include, "egg", eggs, "egg_id")
		case "variables":
			var grouped map[int64][]M
			if grouped, err = a.rowsGrouped(ctx, "SELECT * FROM server_variables WHERE server_id=ANY($1::bigint[]) ORDER BY id", serverIDs, "server_id"); err == nil {
				list(include, "server_variable", grouped)
			}
		case "location":
			var nodes, locations map[int64]M
			if nodes, err = a.rowsByID(ctx, "SELECT id,location_id FROM nodes WHERE id=ANY($1::bigint[])", int64IDs(servers, "node_id"), "id"); err == nil {
				nodeRows := make([]M, 0, len(nodes))
				for _, n := range nodes {
					nodeRows = append(nodeRows, n)
				}
				if locations, err = a.rowsByID(ctx, "SELECT * FROM locations WHERE id=ANY($1::bigint[])", int64IDs(nodeRows, "location_id"), "id"); err == nil {
					byNode := map[int64]M{}
					for id, n := range nodes {
						if location, ok := locations[num(n["location_id"])]; ok {
							byNode[id] = location
						}
					}
					err = single(include, "location", byNode, "node_id")
				}
			}
		case "node":
			var nodes map[int64]M
			if nodes, err = a.rowsByID(ctx, "SELECT id,uuid,name,description,location_id,fqdn,scheme,behind_proxy,public,memory,memory_overallocate,disk,disk_overallocate,upload_size,daemon_listen,daemon_sftp,daemon_base,maintenance_mode,created_at,updated_at FROM nodes WHERE id=ANY($1::bigint[])", int64IDs(servers, "node_id"), "id"); err == nil {
				err = single(include, "node", nodes, "node_id")
			}
		case "databases":
			var grouped map[int64][]M
			if grouped, err = a.rowsGrouped(ctx, "SELECT id,server_id,database_host_id,database,username,remote,max_connections,created_at,updated_at FROM databases WHERE server_id=ANY($1::bigint[]) ORDER BY id", serverIDs, "server_id"); err == nil {
				list(include, "server_database", grouped)
			}
		case "transfer":
			var transfers map[int64]M
			if transfers, err = a.rowsByID(ctx, "SELECT DISTINCT ON (server_id) * FROM server_transfers WHERE server_id=ANY($1::bigint[]) AND successful IS NULL ORDER BY server_id,id DESC", serverIDs, "server_id"); err == nil {
				for i, s := range servers {
					if row, ok := transfers[num(s["id"])]; ok {
						relationships[i][include] = item("transfer", row)
					} else {
						relationships[i][include] = M{"object": "null", "attributes": nil}
					}
				}
			}
		}
		if err != nil {
			return err
		}
	}
	for i := range outs {
		if len(relationships[i]) > 0 {
			outs[i]["relationships"] = relationships[i]
		}
	}
	return nil
}

// Filterable fields of the admin infrastructure lists and the columns each
// table actually has, so filters can be applied in SQL.
var infraListFilter = listFilterSQL{
	Exact:     map[string]bool{"id": true, "port": true, "server_id": true, "uuid": true, "ip": true},
	Substring: map[string]bool{"name": true, "short": true, "fqdn": true, "ip_alias": true},
}

var infraListColumns = map[string]map[string]bool{
	"locations":      {"id": true, "short": true},
	"nodes":          {"id": true, "uuid": true, "name": true, "fqdn": true},
	"database_hosts": {"id": true, "name": true, "port": true},
	"mounts":         {"id": true, "uuid": true, "name": true},
}

func (a *App) infraList(w http.ResponseWriter, r *http.Request, resource string) {
	ctx := r.Context()
	table, object := infraTable(resource), infraObject(resource)
	page := parseListPage(r.URL.Query(), 50, 1000)
	filters := map[string]string{}
	for field, value := range page.Filters {
		// None of these tables has server_id. An "unassigned" filter keeps
		// every row, any other value matches nothing.
		if field == "server_id" && (value == "" || value == "0" || value == "false") {
			continue
		}
		filters[field] = value
	}
	filter := infraListFilter
	filter.Columns = infraListColumns[table]
	where, args := filter.where(filters, nil)
	count, err := a.one(ctx, "SELECT COUNT(*)::bigint AS total FROM "+table+" WHERE "+where, args...)
	if err != nil {
		fail(w, err)
		return
	}
	args = append(args, page.PerPage, page.Offset())
	records, err := a.query(ctx, "SELECT * FROM "+table+" WHERE "+where+" ORDER BY id LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		fail(w, err)
		return
	}
	var presented []M
	if resource == "nodes" {
		presented, err = a.infraPresentNodes(r, records)
	} else {
		presented = make([]M, 0, len(records))
		for _, row := range records {
			result, e := a.infraPresent(r, resource, row)
			if e != nil {
				err = e
				break
			}
			presented = append(presented, result)
		}
	}
	if err != nil {
		fail(w, err)
		return
	}
	response := collection(object, presented)
	response["meta"] = page.Meta(int(num(count["total"])), len(presented))
	writeJSON(w, 200, response)
}

// infraPresentNodes is infraPresent for many nodes, with one query per
// related table instead of one per node.
func (a *App) infraPresentNodes(r *http.Request, nodes []M) ([]M, error) {
	ctx := r.Context()
	out := make([]M, len(nodes))
	if len(nodes) == 0 {
		return out, nil
	}
	ids := int64IDs(nodes, "id")
	sums, err := a.rowsByID(ctx, "SELECT node_id,COALESCE(SUM(memory),0)::bigint AS memory,COALESCE(SUM(disk),0)::bigint AS disk,COUNT(*)::bigint AS servers FROM servers WHERE node_id=ANY($1::bigint[]) GROUP BY node_id", ids, "node_id")
	if err != nil {
		return nil, err
	}
	relations := make([]M, len(nodes))
	for i, row := range nodes {
		result := M{}
		for k, v := range row {
			if k != "daemon_token" && k != "daemon_token_id" && k != "password" {
				result[k] = v
			}
		}
		sum := sums[num(row["id"])]
		memory, disk, servers := any(int64(0)), any(int64(0)), any(int64(0))
		if sum != nil {
			memory, disk, servers = sum["memory"], sum["disk"], sum["servers"]
		}
		result["allocated_resources"] = M{"memory": memory, "disk": disk}
		result["servers_count"] = servers
		out[i], relations[i] = result, M{}
	}
	done := map[string]bool{}
	for _, include := range strings.Split(r.URL.Query().Get("include"), ",") {
		if done[include] || !infraIncludeAllowed(r, include) {
			continue
		}
		done[include] = true
		switch include {
		case "location":
			locations, e := a.rowsByID(ctx, "SELECT * FROM locations WHERE id=ANY($1::bigint[])", int64IDs(nodes, "location_id"), "id")
			if e != nil {
				return nil, e
			}
			for i, row := range nodes {
				location, ok := locations[num(row["location_id"])]
				if !ok {
					return nil, pgx.ErrNoRows
				}
				relations[i][include] = item("location", location)
			}
		case "allocations":
			grouped, e := a.rowsGrouped(ctx, "SELECT * FROM allocations WHERE node_id=ANY($1::bigint[]) ORDER BY id", ids, "node_id")
			if e != nil {
				return nil, e
			}
			for i, row := range nodes {
				allocations := grouped[num(row["id"])]
				for _, allocation := range allocations {
					allocation["assigned"] = allocation["server_id"] != nil
					allocation["alias"] = allocation["ip_alias"]
				}
				relations[i][include] = collection("allocation", allocations)
			}
		case "servers":
			grouped, e := a.rowsGrouped(ctx, "SELECT * FROM servers WHERE node_id=ANY($1::bigint[]) ORDER BY id", ids, "node_id")
			if e != nil {
				return nil, e
			}
			for i, row := range nodes {
				relations[i][include] = collection("server", grouped[num(row["id"])])
			}
		}
	}
	for i := range out {
		if len(relations[i]) > 0 {
			out[i]["relationships"] = relations[i]
		}
	}
	return out, nil
}
