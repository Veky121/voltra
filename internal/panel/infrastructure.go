package panel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	mysql "github.com/go-sql-driver/mysql"
	"gopkg.in/yaml.v3"
)

// Infrastructure routes deliberately share their application and admin implementations.
func (a *App) registerInfrastructure(mux *http.ServeMux) {
	for _, base := range []string{"/api/application", "/api/admin"} {
		for _, resource := range []string{"locations", "nodes"} {
			for _, method := range []string{"GET", "POST"} {
				mux.HandleFunc(method+" "+base+"/"+resource, a.infraCRUD(resource))
			}
			for _, method := range []string{"GET", "PATCH", "DELETE"} {
				mux.HandleFunc(method+" "+base+"/"+resource+"/{id}", a.infraCRUD(resource))
			}
		}
		mux.HandleFunc("GET "+base+"/nodes/deployable", a.infraDeployable)
		mux.HandleFunc("GET "+base+"/nodes/{node}/configuration", a.infraNodeConfiguration)
		mux.HandleFunc("GET "+base+"/nodes/{node}/allocations", a.infraAllocations)
		mux.HandleFunc("POST "+base+"/nodes/{node}/allocations", a.infraAllocations)
		mux.HandleFunc("DELETE "+base+"/nodes/{node}/allocations/{allocation}", a.infraAllocations)
	}
	for _, resource := range []string{"mounts", "database-hosts"} {
		for _, method := range []string{"GET", "POST"} {
			mux.HandleFunc(method+" /api/admin/"+resource, a.infraCRUD(resource))
		}
		for _, method := range []string{"GET", "PATCH", "DELETE"} {
			mux.HandleFunc(method+" /api/admin/"+resource+"/{id}", a.infraCRUD(resource))
		}
	}
	mux.HandleFunc("PATCH /api/admin/nodes/{node}/allocations/{allocation}", a.infraAllocations)
	mux.HandleFunc("DELETE /api/admin/nodes/{node}/allocations", a.infraAllocations)
	mux.HandleFunc("POST /api/admin/nodes/{node}/reset-token", a.infraResetNodeToken)
	mux.HandleFunc("POST /api/admin/nodes/{node}/deploy-token", a.infraNodeDeployToken)
	mux.HandleFunc("GET /api/admin/nodes/{node}/system-information", a.infraNodeSystem)
	mux.HandleFunc("GET /api/admin/nodes/{node}/servers", a.infraNodeServers)
	mux.HandleFunc("POST /api/admin/database-hosts/{host}/test", a.infraDatabaseHostTest)
	for _, relation := range []string{"nodes", "eggs", "servers"} {
		mux.HandleFunc("GET /api/admin/mounts/{mount}/"+relation, a.infraMountRelation(relation))
		mux.HandleFunc("POST /api/admin/mounts/{mount}/"+relation, a.infraMountRelation(relation))
		mux.HandleFunc("DELETE /api/admin/mounts/{mount}/"+relation+"/{related}", a.infraMountRelation(relation))
	}
	mux.HandleFunc("GET /api/admin/settings", a.infraSettings)
	mux.HandleFunc("PATCH /api/admin/settings", a.infraSettings)
}

func infraTable(resource string) string {
	if resource == "database-hosts" {
		return "database_hosts"
	}
	return resource
}
func infraObject(resource string) string {
	switch resource {
	case "database-hosts":
		return "database_host"
	case "locations":
		return "location"
	case "nodes":
		return "node"
	default:
		return "mount"
	}
}
func infraID(value string) (int64, error) {
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n < 1 {
		return 0, bad("A positive numeric identifier is required.")
	}
	return n, nil
}

func (a *App) infraCRUD(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := a.requireAdmin(r)
		if err != nil {
			fail(w, err)
			return
		}
		table, object := infraTable(resource), infraObject(resource)
		id := int64(0)
		if r.PathValue("id") != "" {
			id, err = infraID(r.PathValue("id"))
			if err != nil {
				fail(w, err)
				return
			}
		}
		var old M
		if id > 0 {
			old, err = a.one(r.Context(), "SELECT * FROM "+table+" WHERE id=$1", id)
			if err != nil {
				fail(w, err)
				return
			}
		}
		switch r.Method {
		case "GET":
			if id > 0 {
				result, e := a.infraPresent(r, resource, old)
				if e != nil {
					fail(w, e)
					return
				}
				writeJSON(w, 200, item(object, result))
				return
			}
			records, e := a.query(r.Context(), "SELECT * FROM "+table+" ORDER BY id")
			if e != nil {
				fail(w, e)
				return
			}
			filtered := make([]M, 0, len(records))
			for _, row := range records {
				if infraFilter(r, row) {
					result, e := a.infraPresent(r, resource, row)
					if e != nil {
						fail(w, e)
						return
					}
					filtered = append(filtered, result)
				}
			}
			infraPage(w, r, object, filtered)
		case "POST", "PATCH":
			data, e := decode(r)
			if e != nil {
				fail(w, e)
				return
			}
			if r.Method == http.MethodPost || resource == "nodes" && r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/api/application/") {
				if e = infraCreateRequest(resource, data); e != nil {
					fail(w, e)
					return
				}
			}
			data, e = a.infraValidate(r.Context(), resource, data, old)
			if e != nil {
				fail(w, e)
				return
			}
			if resource == "nodes" && str(old["connection_mode"]) == "outbound" {
				// Pairing owns this private listener; changing it would strand the connector.
				for _, key := range []string{"fqdn", "scheme", "daemon_listen", "behind_proxy"} {
					if v, ok := data[key]; ok && str(v) != str(old[key]) {
						fail(w, bad("Paired nodes manage their Wings connection automatically."))
						return
					}
				}
			}
			var row M
			if id == 0 {
				row, e = a.insert(r.Context(), table, data)
			} else {
				row, e = a.update(r.Context(), table, id, data)
			}
			if e != nil {
				fail(w, e)
				return
			}
			if resource == "nodes" && id > 0 {
				connection := M{}
				for k, v := range old {
					connection[k] = v
				}
				connection["fqdn"] = row["fqdn"]
				if e = a.infraSyncNode(r.Context(), connection, row); e != nil {
					fail(w, APIError{Status: 502, Code: "NodeConfigurationNotPersisted", Detail: "The node settings were saved, but Wings could not apply them. Update its configuration manually or retry when the node is reachable."})
					return
				}
			}
			if resource == "mounts" && id > 0 {
				if e = a.infraSyncMount(r.Context(), id); e != nil {
					fail(w, APIError{Status: 502, Code: "MountSyncFailed", Detail: "The mount settings were saved, but a node could not apply them. Restore node connectivity and retry the update."})
					return
				}
			}
			_ = a.audit(r.Context(), num(user["id"]), 0, object+":"+strings.ToLower(r.Method), M{"id": row["id"]})
			result, e := a.infraPresent(r, resource, row)
			if e != nil {
				fail(w, e)
				return
			}
			status := 200
			if id == 0 {
				status = 201
			}
			writeJSON(w, status, item(object, result))
		case "DELETE":
			if e := a.infraDelete(r.Context(), resource, id); e != nil {
				fail(w, e)
				return
			}
			if resource == "nodes" {
				a.connectors().disconnect(id)
			}
			_ = a.audit(r.Context(), num(user["id"]), 0, object+":delete", M{"id": id})
			w.WriteHeader(204)
		}
	}
}

// Native creation requests validate required fields before model defaults apply.
// Internal callers of infraValidate retain the model's default configuration.
func infraCreateRequest(resource string, data M) error {
	var required []string
	switch resource {
	case "nodes":
		required = []string{"name", "location_id", "fqdn", "scheme", "memory", "memory_overallocate", "disk", "disk_overallocate", "daemon_listen", "daemon_sftp"}
	case "database-hosts":
		required = []string{"port"}
	}
	for _, key := range required {
		value, present := data[key]
		if !present && resource == "nodes" {
			legacy := map[string]string{"daemon_listen": "daemonListen", "daemon_sftp": "daemonSFTP"}[key]
			if legacy != "" {
				value, present = data[legacy]
			}
		}
		if !present || value == nil || value == "" {
			return bad(key + " is required.")
		}
	}
	return nil
}

func infraFilter(r *http.Request, row M) bool {
	for key, values := range r.URL.Query() {
		if !strings.HasPrefix(key, "filter[") || !strings.HasSuffix(key, "]") {
			continue
		}
		field := strings.TrimSuffix(strings.TrimPrefix(key, "filter["), "]")
		if field != "id" && field != "name" && field != "short" && field != "fqdn" && field != "uuid" && field != "ip" && field != "port" && field != "ip_alias" && field != "server_id" {
			continue
		}
		value := values[0]
		if field == "server_id" && (value == "" || value == "0" || value == "false") {
			if row[field] != nil {
				return false
			}
			continue
		}
		if field == "id" || field == "port" || field == "server_id" || field == "uuid" || field == "ip" {
			if fmt.Sprint(row[field]) != value {
				return false
			}
		} else if !strings.Contains(strings.ToLower(str(row[field])), strings.ToLower(value)) {
			return false
		}
	}
	return true
}

func infraPage(w http.ResponseWriter, r *http.Request, object string, records []M) {
	per := 50
	page := 1
	if n, e := strconv.Atoi(r.URL.Query().Get("per_page")); e == nil && n > 0 {
		per = n
	}
	if per > 1000 {
		per = 1000
	}
	if n, e := strconv.Atoi(r.URL.Query().Get("page")); e == nil && n > 0 {
		page = n
	}
	total := len(records)
	start := (page - 1) * per
	if start > total {
		start = total
	}
	end := start + per
	if end > total {
		end = total
	}
	pages := (total + per - 1) / per
	if pages == 0 {
		pages = 1
	}
	response := collection(object, records[start:end])
	response["meta"] = M{"pagination": M{"total": total, "count": end - start, "per_page": per, "current_page": page, "total_pages": pages, "links": M{}}}
	writeJSON(w, 200, response)
}

func (a *App) infraPresent(r *http.Request, resource string, row M) (M, error) {
	result := M{}
	for k, v := range row {
		if k != "daemon_token" && k != "daemon_token_id" && k != "password" {
			result[k] = v
		}
	}
	ctx := r.Context()
	id := num(row["id"])
	relations := M{}
	switch resource {
	case "nodes":
		sums, e := a.one(ctx, "SELECT COALESCE(SUM(memory),0)::bigint AS memory,COALESCE(SUM(disk),0)::bigint AS disk,COUNT(*)::bigint AS servers FROM servers WHERE node_id=$1", id)
		if e != nil {
			return nil, e
		}
		result["allocated_resources"] = M{"memory": sums["memory"], "disk": sums["disk"]}
		result["servers_count"] = sums["servers"]
		for _, include := range strings.Split(r.URL.Query().Get("include"), ",") {
			if !infraIncludeAllowed(r, include) {
				continue
			}
			switch include {
			case "location":
				v, e := a.one(ctx, "SELECT * FROM locations WHERE id=$1", row["location_id"])
				if e != nil {
					return nil, e
				}
				relations[include] = item("location", v)
			case "allocations":
				v, e := a.query(ctx, "SELECT * FROM allocations WHERE node_id=$1 ORDER BY id", id)
				if e != nil {
					return nil, e
				}
				for _, allocation := range v {
					allocation["assigned"] = allocation["server_id"] != nil
					allocation["alias"] = allocation["ip_alias"]
				}
				relations[include] = collection("allocation", v)
			case "servers":
				v, e := a.query(ctx, "SELECT * FROM servers WHERE node_id=$1 ORDER BY id", id)
				if e != nil {
					return nil, e
				}
				relations[include] = collection("server", v)
			}
		}
	case "locations":
		counts, e := a.one(ctx, "SELECT COUNT(*)::bigint AS nodes FROM nodes WHERE location_id=$1", id)
		if e != nil {
			return nil, e
		}
		result["nodes_count"] = counts["nodes"]
		if strings.Contains(r.URL.Query().Get("include"), "nodes") && infraIncludeAllowed(r, "nodes") {
			v, e := a.query(ctx, "SELECT id,uuid,name,location_id,fqdn,scheme,daemon_listen FROM nodes WHERE location_id=$1 ORDER BY id", id)
			if e != nil {
				return nil, e
			}
			relations["nodes"] = collection("node", v)
		}
	case "mounts":
		for _, relation := range []string{"nodes", "eggs", "servers"} {
			table, column := infraMountTable(relation)
			v, e := a.query(ctx, "SELECT "+column+" AS id FROM "+table+" WHERE mount_id=$1 ORDER BY "+column, id)
			if e != nil {
				return nil, e
			}
			ids := []any{}
			for _, row := range v {
				ids = append(ids, row["id"])
			}
			result[relation] = ids
		}
	case "database-hosts":
		counts, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM databases WHERE database_host_id=$1", id)
		if e != nil {
			return nil, e
		}
		result["databases_count"] = counts["count"]
	}
	if len(relations) > 0 {
		result["relationships"] = relations
	}
	return result, nil
}
func infraIncludeAllowed(r *http.Request, relation string) bool {
	key, ok := r.Context().Value(apiKeyContextKey{}).(M)
	if !ok {
		return true
	}
	resource := relation
	switch relation {
	case "location":
		resource = "locations"
	case "node":
		resource = "nodes"
	case "server":
		resource = "servers"
	}
	return applicationScopeAllowed(asMap(key["permissions"]), http.MethodGet, "/api/application/"+resource)
}

var infraNodeName = regexp.MustCompile(`^[\pL\pN_ .-]{1,100}$`)

func infraString(data M, key string, min, max int) error {
	if data[key] == nil && min == 0 {
		data[key] = ""
		return nil
	}
	value, ok := data[key].(string)
	if !ok || utf8.RuneCountInString(value) < min || utf8.RuneCountInString(value) > max {
		return bad(fmt.Sprintf("%s must be a string between %d and %d characters.", key, min, max))
	}
	return nil
}
func infraInteger(data M, key string, min, max int64) error {
	v, ok := data[key]
	if !ok {
		return bad(key + " is required.")
	}
	var n int64
	switch value := v.(type) {
	case float64:
		if value != float64(int64(value)) {
			return bad(key + " must be an integer.")
		}
		n = int64(value)
	case int:
		n = int64(value)
	case int64:
		n = value
	case json.Number:
		x, e := value.Int64()
		if e != nil {
			return bad(key + " must be an integer.")
		}
		n = x
	case string:
		value = trimInput(value)
		if !infraIntegerString.MatchString(value) {
			return bad(key + " must be an integer.")
		}
		x, e := strconv.ParseInt(value, 10, 64)
		if e != nil {
			return bad(key + " must be an integer.")
		}
		n = x
	default:
		return bad(key + " must be an integer.")
	}
	if n < min || n > max {
		return bad(fmt.Sprintf("%s must be between %d and %d.", key, min, max))
	}
	data[key] = n
	return nil
}

var infraIntegerString = regexp.MustCompile(`^[+-]?(0|[1-9][0-9]*)$`)

func infraBool(data M, key string) error {
	if _, ok := data[key].(bool); !ok {
		return bad(key + " must be a boolean.")
	}
	return nil
}
func infraMerge(data, old, defaults M, allowed []string) (M, error) {
	result := M{}
	for k, v := range defaults {
		result[k] = v
	}
	for _, key := range allowed {
		if v, ok := old[key]; ok {
			result[key] = v
		}
	}
	for key, v := range data {
		found := false
		for _, allow := range allowed {
			if key == allow {
				found = true
				break
			}
		}
		if !found {
			return nil, bad("Unknown field: " + key)
		}
		result[key] = v
	}
	return result, nil
}

func (a *App) infraValidate(ctx context.Context, resource string, input, old M) (M, error) {
	var defaults M
	var allowed []string
	switch resource {
	case "locations":
		defaults = M{"long": ""}
		allowed = []string{"short", "long"}
	case "nodes":
		// Accept the legacy admin spelling as well as native application API fields.
		for legacy, native := range map[string]string{"daemonListen": "daemon_listen", "daemonSFTP": "daemon_sftp", "daemonBase": "daemon_base"} {
			if value, ok := input[legacy]; ok {
				input[native] = value
				delete(input, legacy)
			}
		}
		defaults = M{"description": "", "public": true, "scheme": "http", "behind_proxy": false, "memory_overallocate": int64(0), "disk_overallocate": int64(0), "upload_size": int64(100), "daemon_listen": int64(8080), "daemon_sftp": int64(2022), "daemon_base": "/var/lib/voltra/volumes", "maintenance_mode": false, "allowed_origins": []any{}}
		allowed = []string{"name", "description", "location_id", "fqdn", "scheme", "behind_proxy", "public", "memory", "memory_overallocate", "disk", "disk_overallocate", "upload_size", "daemon_listen", "daemon_sftp", "daemon_base", "maintenance_mode", "allowed_origins"}
	case "mounts":
		defaults = M{"description": "", "read_only": false, "user_mountable": false}
		allowed = []string{"name", "description", "source", "target", "read_only", "user_mountable"}
	case "database-hosts":
		defaults = M{"port": int64(3306), "password": "", "node_id": nil, "max_databases": nil}
		allowed = []string{"name", "host", "port", "username", "password", "node_id", "max_databases"}
	}
	data, err := infraMerge(input, old, defaults, allowed)
	if err != nil {
		return nil, err
	}
	switch resource {
	case "locations":
		if err = infraString(data, "short", 1, 60); err != nil {
			return nil, err
		}
		if err = infraString(data, "long", 0, 191); err != nil {
			return nil, err
		}
	case "nodes":
		if err = infraString(data, "name", 1, 100); err != nil {
			return nil, err
		}
		if !infraNodeName.MatchString(str(data["name"])) {
			return nil, bad("Node name contains unsupported characters.")
		}
		if err = infraString(data, "description", 0, 10000); err != nil {
			return nil, err
		}
		if err = infraString(data, "fqdn", 1, 253); err != nil {
			return nil, err
		}
		fqdn := str(data["fqdn"])
		if strings.ContainsAny(fqdn, " /\\?#@\t\n") || strings.Contains(fqdn, "://") {
			return nil, bad("fqdn must contain a hostname or IP address without a scheme, path or port.")
		}
		if strings.Contains(fqdn, ":") && net.ParseIP(strings.Trim(fqdn, "[]")) == nil {
			return nil, bad("fqdn must not include a port.")
		}
		if str(data["scheme"]) != "http" && str(data["scheme"]) != "https" {
			return nil, bad("scheme must be http or https.")
		}
		for key, bounds := range map[string][2]int64{"location_id": {1, 1 << 62}, "memory": {1, 1 << 50}, "disk": {1, 1 << 50}, "memory_overallocate": {-1, 1000000}, "disk_overallocate": {-1, 1000000}, "upload_size": {1, 1 << 30}, "daemon_listen": {1, 65535}, "daemon_sftp": {1, 65535}} {
			if err = infraInteger(data, key, bounds[0], bounds[1]); err != nil {
				return nil, err
			}
		}
		for _, key := range []string{"public", "behind_proxy", "maintenance_mode"} {
			if err = infraBool(data, key); err != nil {
				return nil, err
			}
		}
		if _, err = a.one(ctx, "SELECT id FROM locations WHERE id=$1", data["location_id"]); err != nil {
			return nil, bad("location_id does not reference an existing location.")
		}
		if !infraAbsolutePath(str(data["daemon_base"])) || str(data["daemon_base"]) == "/" {
			return nil, bad("daemon_base must be an absolute non-root Unix path.")
		}
		origins, ok := data["allowed_origins"].([]any)
		if !ok {
			return nil, bad("allowed_origins must be an array.")
		}
		for _, origin := range origins {
			u, e := url.Parse(str(origin))
			if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" && u.Path != "/" {
				return nil, bad("allowed_origins must contain HTTP origins.")
			}
		}
		if old == nil {
			data["uuid"] = newUUID()
			data["daemon_token_id"] = randomToken(12)[:16]
			data["daemon_token"], err = a.seal(randomToken(32))
			if err != nil {
				return nil, err
			}
		}
	case "mounts":
		for _, rule := range []struct {
			k        string
			min, max int
		}{{"name", 2, 64}, {"description", 0, 191}, {"source", 1, 4096}, {"target", 1, 4096}} {
			if err = infraString(data, rule.k, rule.min, rule.max); err != nil {
				return nil, err
			}
		}
		for _, key := range []string{"source", "target"} {
			if !infraAbsolutePath(str(data[key])) || str(data[key]) == "/" {
				return nil, bad(key + " must be an absolute non-root Unix path.")
			}
			data[key] = path.Clean(str(data[key]))
		}
		for _, blocked := range []string{"/etc/voltra", "/var/lib/voltra/volumes", "/etc/pterodactyl", "/var/lib/pterodactyl/volumes", "/srv/daemon-data"} {
			if str(data["source"]) == blocked {
				return nil, bad("The mount source is reserved by Wings.")
			}
		}
		if str(data["target"]) == "/home/container" {
			return nil, bad("The mount target cannot replace /home/container.")
		}
		for _, key := range []string{"read_only", "user_mountable"} {
			if err = infraBool(data, key); err != nil {
				return nil, err
			}
		}
		if old == nil {
			data["uuid"] = newUUID()
		}
	case "database-hosts":
		for _, rule := range []struct {
			k        string
			min, max int
		}{{"name", 1, 191}, {"host", 1, 253}, {"username", 1, 32}, {"password", 0, 4096}} {
			if err = infraString(data, rule.k, rule.min, rule.max); err != nil {
				return nil, err
			}
		}
		host := str(data["host"])
		if strings.ContainsAny(host, " /\\?#@\t\n") {
			return nil, bad("host must be a hostname or IP address.")
		}
		if err = infraInteger(data, "port", 1, 65535); err != nil {
			return nil, err
		}
		if data["node_id"] != nil {
			if err = infraInteger(data, "node_id", 1, 1<<62); err != nil {
				return nil, err
			}
			if _, err = a.one(ctx, "SELECT id FROM nodes WHERE id=$1", data["node_id"]); err != nil {
				return nil, bad("node_id does not reference an existing node.")
			}
		}
		if data["max_databases"] != nil {
			if err = infraInteger(data, "max_databases", 1, 1<<31); err != nil {
				return nil, err
			}
		}
		if _, changed := input["password"]; changed || old == nil {
			data["password"], err = a.seal(str(data["password"]))
			if err != nil {
				return nil, err
			}
		}
	}
	return data, nil
}
func infraAbsolutePath(value string) bool {
	return strings.HasPrefix(value, "/") && !strings.ContainsRune(value, 0) && !strings.Contains(value, "\\") && path.Clean(value) == value
}

func (a *App) infraDelete(ctx context.Context, resource string, id int64) error {
	var queries []string
	switch resource {
	case "locations":
		queries = []string{"SELECT COUNT(*)::bigint AS count FROM nodes WHERE location_id=$1"}
	case "nodes":
		queries = []string{"SELECT COUNT(*)::bigint AS count FROM servers WHERE node_id=$1", "SELECT COUNT(*)::bigint AS count FROM server_transfers WHERE (old_node=$1 OR new_node=$1) AND archived=false AND successful IS NULL"}
	case "database-hosts":
		queries = []string{"SELECT COUNT(*)::bigint AS count FROM databases WHERE database_host_id=$1"}
	case "mounts":
		queries = []string{"SELECT COUNT(*)::bigint AS count FROM mount_servers WHERE mount_id=$1"}
	}
	for _, q := range queries {
		row, err := a.one(ctx, q, id)
		if err != nil {
			return err
		}
		if num(row["count"]) > 0 {
			return bad("This resource is still in use. Remove its dependent assignments before deleting it.")
		}
	}
	if resource == "nodes" {
		tx, err := a.DB.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, "UPDATE database_hosts SET node_id=NULL WHERE node_id=$1", id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "DELETE FROM allocations WHERE node_id=$1 AND server_id IS NULL", id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "DELETE FROM nodes WHERE id=$1", id); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if resource == "mounts" {
		nodes, err := a.query(ctx, "SELECT n.* FROM nodes n JOIN mount_nodes mn ON mn.node_id=n.id WHERE mn.mount_id=$1 ORDER BY n.id", id)
		if err != nil {
			return err
		}
		if err = a.exec(ctx, "DELETE FROM mounts WHERE id=$1", id); err != nil {
			return err
		}
		for _, node := range nodes {
			if err = a.infraSyncNode(ctx, node, node); err != nil {
				return APIError{Status: 502, Code: "MountSyncFailed", Detail: "The mount was deleted, but Wings could not update its allowed mounts. Restore node connectivity and apply the node configuration."}
			}
		}
		return nil
	}
	return a.exec(ctx, "DELETE FROM "+infraTable(resource)+" WHERE id=$1", id)
}

func (a *App) infraDeployable(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	requirements := M{}
	for _, key := range []string{"memory", "disk"} {
		n, err := strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
		if err != nil || n < 0 {
			fail(w, bad(key+" must be a non-negative integer."))
			return
		}
		requirements[key] = n
	}
	nodes, err := a.query(r.Context(), `SELECT n.*, COALESCE(SUM(s.memory),0)::bigint AS sum_memory, COALESCE(SUM(s.disk),0)::bigint AS sum_disk FROM nodes n LEFT JOIN servers s ON s.node_id=n.id WHERE n.public=true AND n.maintenance_mode=false GROUP BY n.id ORDER BY n.id`)
	if err != nil {
		fail(w, err)
		return
	}
	wanted := map[int64]bool{}
	for key, values := range r.URL.Query() {
		if key == "location_ids" || key == "location_ids[]" || strings.HasPrefix(key, "location_ids[") {
			for _, v := range values {
				for _, part := range strings.Split(v, ",") {
					id, e := infraID(part)
					if e != nil {
						fail(w, bad("location_ids must contain numeric IDs."))
						return
					}
					wanted[id] = true
				}
			}
		}
	}
	result := []M{}
	for _, node := range nodes {
		if len(wanted) > 0 && !wanted[num(node["location_id"])] {
			continue
		}
		if !infraCapacity(num(node["memory"]), num(node["memory_overallocate"]), num(node["sum_memory"]), num(requirements["memory"])) || !infraCapacity(num(node["disk"]), num(node["disk_overallocate"]), num(node["sum_disk"]), num(requirements["disk"])) {
			continue
		}
		row, e := a.infraPresent(r, "nodes", node)
		if e != nil {
			fail(w, e)
			return
		}
		delete(row, "sum_memory")
		delete(row, "sum_disk")
		result = append(result, row)
	}
	infraPage(w, r, "node", result)
}
func infraCapacity(total, over, used, requested int64) bool {
	if requested < 0 || used < 0 || total < 1 {
		return false
	}
	if over == -1 {
		return true
	}
	return float64(used)+float64(requested) <= float64(total)*(1+float64(over)/100)
}

func (a *App) infraNodeConfiguration(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	node, e := a.one(r.Context(), "SELECT * FROM nodes WHERE id=$1", id)
	if e != nil {
		fail(w, e)
		return
	}
	config, e := a.nodeConfiguration(r.Context(), node)
	if e != nil {
		fail(w, e)
		return
	}
	if r.URL.Query().Get("format") == "yaml" || strings.Contains(r.Header.Get("Accept"), "yaml") {
		data, e := yaml.Marshal(config)
		if e != nil {
			fail(w, e)
			return
		}
		w.Header().Set("Content-Type", "application/yaml")
		_, _ = w.Write(data)
		return
	}
	writeJSON(w, 200, config)
}
func (a *App) nodeConfiguration(ctx context.Context, node M) (M, error) {
	mounts, err := a.query(ctx, "SELECT m.source FROM mounts m JOIN mount_nodes mn ON mn.mount_id=m.id WHERE mn.node_id=$1 ORDER BY m.id", node["id"])
	if err != nil {
		return nil, err
	}
	sources := []any{}
	for _, m := range mounts {
		sources = append(sources, m["source"])
	}
	fqdn := strings.ToLower(str(node["fqdn"]))
	token := str(node["daemon_token"])
	if strings.HasPrefix(token, "enc:v1:") {
		token, err = a.unseal(token)
		if err != nil {
			return nil, err
		}
	}
	remote := a.Config.DaemonURL
	if remote == "" {
		remote = a.panelPublicURL(ctx)
	}
	config := M{"debug": false, "uuid": node["uuid"], "token_id": node["daemon_token_id"], "token": token, "api": M{"host": "0.0.0.0", "port": node["daemon_listen"], "ssl": M{"enabled": !boolean(node["behind_proxy"]) && str(node["scheme"]) == "https", "cert": "/etc/letsencrypt/live/" + fqdn + "/fullchain.pem", "key": "/etc/letsencrypt/live/" + fqdn + "/privkey.pem"}, "upload_limit": node["upload_size"]}, "system": M{"data": node["daemon_base"], "sftp": M{"bind_port": node["daemon_sftp"]}}, "allowed_mounts": sources, "allowed_origins": node["allowed_origins"], "remote": strings.TrimRight(remote, "/")}
	if str(node["connection_mode"]) == "outbound" {
		config["api"] = M{"host": "127.0.0.1", "port": node["daemon_listen"], "ssl": M{"enabled": false}, "upload_limit": node["upload_size"]}
		asMap(asMap(config["system"])["sftp"])["bind_address"] = "127.0.0.1"
		config["remote"] = strings.TrimRight(a.panelPublicURL(ctx), "/")
	}
	return config, nil
}
func (a *App) infraSyncNode(ctx context.Context, connection, node M) error {
	config, e := a.nodeConfiguration(ctx, node)
	if e != nil {
		return e
	}
	if strings.HasPrefix(str(connection["daemon_token"]), "enc:v1:") {
		copy := M{}
		for k, v := range connection {
			copy[k] = v
		}
		copy["daemon_token"], e = a.unseal(str(connection["daemon_token"]))
		if e != nil {
			return e
		}
		connection = copy
	}
	response, e := a.daemon(ctx, connection, http.MethodPost, "/api/update", config)
	if e != nil {
		return e
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		var result struct {
			Applied *bool `json:"applied"`
		}
		if e = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); e != nil {
			return e
		}
		if result.Applied != nil && !*result.Applied {
			return APIError{Status: 502, Code: "NodeConfigurationNotPersisted", Detail: "Wings refused the configuration because panel configuration updates are disabled on this node."}
		}
	}
	return nil
}
func (a *App) infraResetNodeToken(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	old, e := a.one(r.Context(), "SELECT * FROM nodes WHERE id=$1", id)
	if e != nil {
		fail(w, e)
		return
	}
	token, e := a.seal(randomToken(32))
	if e != nil {
		fail(w, e)
		return
	}
	node, e := a.update(r.Context(), "nodes", id, M{"daemon_token_id": randomToken(12)[:16], "daemon_token": token})
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.infraSyncNode(r.Context(), old, node); e != nil {
		fail(w, APIError{Status: 502, Code: "NodeConfigurationNotPersisted", Detail: "New credentials were saved, but Wings could not apply them. Retrieve the node configuration and update Wings manually."})
		return
	}
	config, e := a.nodeConfiguration(r.Context(), node)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, config)
}
func (a *App) infraNodeDeployToken(w http.ResponseWriter, r *http.Request) {
	user, e := a.requireAdmin(r)
	if e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	if _, e = a.one(r.Context(), "SELECT id FROM nodes WHERE id=$1", id); e != nil {
		fail(w, e)
		return
	}
	identifier := randomToken(8)
	token := "ptla_" + identifier + randomToken(24)
	hashed := sha256.Sum256([]byte(token))
	key, e := a.insert(r.Context(), "api_keys", M{"user_id": num(user["id"]), "identifier": identifier, "token_hash": hex.EncodeToString(hashed[:]), "type": "application", "memo": fmt.Sprintf("Node %d deployment key", id), "allowed_ips": []any{}, "permissions": M{"nodes": int64(3)}})
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(user["id"]), 0, "node:deployment-key", M{"node_id": id, "key_id": key["id"]})
	writeJSON(w, 201, M{"node": id, "token": token, "key_id": key["id"]})
}
func (a *App) infraNodeSystem(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	node, e := a.node(r.Context(), id)
	if e != nil {
		fail(w, e)
		return
	}
	response, e := a.daemon(r.Context(), node, http.MethodGet, "/api/system", nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer response.Body.Close()
	var data any
	if e = json.NewDecoder(response.Body).Decode(&data); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, data)
}
func (a *App) infraNodeServers(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	if _, e = a.node(r.Context(), id); e != nil {
		fail(w, e)
		return
	}
	records, e := a.query(r.Context(), "SELECT * FROM servers WHERE node_id=$1 ORDER BY id", id)
	if e != nil {
		fail(w, e)
		return
	}
	infraPage(w, r, "server", records)
}

func infraPorts(value any) ([]int, error) {
	ports := map[int]bool{}
	values, ok := value.([]any)
	if !ok || len(values) == 0 {
		return nil, bad("ports must be a non-empty array of port numbers or ranges.")
	}
	for _, v := range values {
		spec := fmt.Sprint(v)
		pieces := strings.Split(spec, "-")
		if len(pieces) > 2 {
			return nil, bad("Invalid port range.")
		}
		start, e := strconv.Atoi(pieces[0])
		if e != nil {
			return nil, bad("Invalid port number.")
		}
		end := start
		if len(pieces) == 2 {
			end, e = strconv.Atoi(pieces[1])
			if e != nil {
				return nil, bad("Invalid port range.")
			}
		}
		if start <= 1024 || end > 65535 || end < start {
			return nil, bad("Ports must be between 1025 and 65535, with ranges in ascending order.")
		}
		if end-start+1 > 1000 {
			return nil, bad("Each port range must contain at most 1000 ports.")
		}
		for n := start; n <= end; n++ {
			ports[n] = true
		}
		if len(ports) > 10000 {
			return nil, bad("At most 10000 ports may be created in one request.")
		}
	}
	result := make([]int, 0, len(ports))
	for n := range ports {
		result = append(result, n)
	}
	sort.Ints(result)
	return result, nil
}
func infraIPs(ctx context.Context, value string) ([]string, error) {
	if prefix, e := netip.ParsePrefix(value); e == nil {
		if !prefix.Addr().Is4() || prefix.Bits() < 25 {
			return nil, bad("Allocation CIDR must be an IPv4 network between /25 and /32.")
		}
		prefix = prefix.Masked()
		result := []string{}
		for addr := prefix.Addr(); prefix.Contains(addr); addr = addr.Next() {
			result = append(result, addr.String())
		}
		return result, nil
	}
	if strings.Contains(value, "/") {
		return nil, bad("Invalid allocation CIDR.")
	}
	if ip, e := netip.ParseAddr(value); e == nil {
		return []string{ip.String()}, nil
	}
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, value)
	if e != nil {
		return nil, bad("The allocation IP or hostname could not be resolved.")
	}
	for _, ip := range ips {
		if ip.IP.To4() != nil {
			return []string{ip.IP.String()}, nil
		}
	}
	return nil, bad("The allocation hostname has no IPv4 address.")
}
func (a *App) infraAllocations(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	nodeID, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	if _, e = a.one(r.Context(), "SELECT id FROM nodes WHERE id=$1", nodeID); e != nil {
		fail(w, e)
		return
	}
	if r.Method == "DELETE" && r.PathValue("allocation") == "" {
		data, e := decode(r)
		if e != nil {
			fail(w, e)
			return
		}
		values, ok := data["allocations"].([]any)
		if !ok || len(values) == 0 {
			fail(w, bad("allocations must contain at least one allocation ID."))
			return
		}
		ids := []int64{}
		seen := map[int64]bool{}
		for _, value := range values {
			v := M{"id": value}
			if e = infraInteger(v, "id", 1, 1<<62); e != nil {
				fail(w, e)
				return
			}
			id := num(v["id"])
			if !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
		tx, e := a.DB.Begin(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		for _, id := range ids {
			var serverID *int64
			if e = tx.QueryRow(r.Context(), "SELECT server_id FROM allocations WHERE id=$1 AND node_id=$2 FOR UPDATE", id, nodeID).Scan(&serverID); e != nil {
				fail(w, bad("An allocation is missing or belongs to another node."))
				return
			}
			if serverID != nil {
				fail(w, bad("Assigned allocations cannot be deleted."))
				return
			}
		}
		for _, id := range ids {
			if _, e = tx.Exec(r.Context(), "DELETE FROM allocations WHERE id=$1 AND node_id=$2", id, nodeID); e != nil {
				fail(w, e)
				return
			}
		}
		if e = tx.Commit(r.Context()); e != nil {
			fail(w, e)
			return
		}
		w.WriteHeader(204)
		return
	}
	if r.Method == "GET" {
		records, e := a.query(r.Context(), "SELECT * FROM allocations WHERE node_id=$1 ORDER BY ip,port", nodeID)
		if e != nil {
			fail(w, e)
			return
		}
		result := []M{}
		for _, row := range records {
			row["assigned"] = row["server_id"] != nil
			row["alias"] = row["ip_alias"]
			if infraFilter(r, row) {
				if e = a.infraAllocationIncludes(r, row); e != nil {
					fail(w, e)
					return
				}
				result = append(result, row)
			}
		}
		infraPage(w, r, "allocation", result)
		return
	}
	if r.Method == "POST" {
		data, e := decode(r)
		if e != nil {
			fail(w, e)
			return
		}
		ip := str(data["ip"])
		if ip == "" {
			ip = str(data["allocation_ip"])
		}
		ports := data["ports"]
		if ports == nil {
			ports = data["allocation_ports"]
		}
		alias := data["alias"]
		if alias == nil {
			alias = data["allocation_alias"]
		}
		if alias != nil {
			if _, ok := alias.(string); !ok || len(str(alias)) > 191 {
				fail(w, bad("alias must be a string of at most 191 characters."))
				return
			}
		}
		parsedPorts, e := infraPorts(ports)
		if e != nil {
			fail(w, e)
			return
		}
		ips, e := infraIPs(r.Context(), ip)
		if e != nil {
			fail(w, e)
			return
		}
		if len(ips)*len(parsedPorts) > 100000 {
			fail(w, bad("At most 100000 allocations may be created per request."))
			return
		}
		tx, e := a.DB.Begin(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		for _, ip := range ips {
			for _, port := range parsedPorts {
				if _, e = tx.Exec(r.Context(), "INSERT INTO allocations(node_id,ip,port,ip_alias) VALUES($1,$2,$3,$4) ON CONFLICT(node_id,ip,port) DO NOTHING", nodeID, ip, port, alias); e != nil {
					fail(w, e)
					return
				}
			}
		}
		if e = tx.Commit(r.Context()); e != nil {
			fail(w, e)
			return
		}
		w.WriteHeader(204)
		return
	}
	id, e := infraID(r.PathValue("allocation"))
	if e != nil {
		fail(w, e)
		return
	}
	row, e := a.one(r.Context(), "SELECT * FROM allocations WHERE id=$1 AND node_id=$2", id, nodeID)
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "PATCH" {
		data, e := decode(r)
		if e != nil {
			fail(w, e)
			return
		}
		if alias, ok := data["alias"]; ok {
			data["ip_alias"] = alias
			delete(data, "alias")
		}
		for key := range data {
			if key != "ip_alias" && key != "notes" {
				fail(w, bad("Only ip_alias and notes may be changed."))
				return
			}
			if data[key] != nil {
				if _, ok := data[key].(string); !ok || len(str(data[key])) > 191 {
					fail(w, bad(key+" must be a string of at most 191 characters."))
					return
				}
			}
		}
		updated, e := a.update(r.Context(), "allocations", id, data)
		if e != nil {
			fail(w, e)
			return
		}
		updated["assigned"] = updated["server_id"] != nil
		updated["alias"] = updated["ip_alias"]
		if e = a.infraAllocationIncludes(r, updated); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, item("allocation", updated))
		return
	}
	if row["server_id"] != nil {
		fail(w, bad("This allocation is assigned to a server and cannot be deleted."))
		return
	}
	e = a.exec(r.Context(), "DELETE FROM allocations WHERE id=$1 AND node_id=$2 AND server_id IS NULL", id, nodeID)
	if e != nil {
		fail(w, e)
		return
	}
	w.WriteHeader(204)
}

func (a *App) infraAllocationIncludes(r *http.Request, row M) error {
	relations := M{}
	for _, include := range strings.Split(r.URL.Query().Get("include"), ",") {
		if !infraIncludeAllowed(r, include) {
			continue
		}
		switch include {
		case "node":
			node, e := a.one(r.Context(), "SELECT * FROM nodes WHERE id=$1", row["node_id"])
			if e != nil {
				return e
			}
			node, e = a.infraPresent(r, "nodes", node)
			if e != nil {
				return e
			}
			relations["node"] = item("node", node)
		case "server":
			if row["server_id"] == nil {
				continue
			}
			server, e := a.one(r.Context(), "SELECT * FROM servers WHERE id=$1", row["server_id"])
			if e != nil {
				return e
			}
			server, e = a.applicationServer(r.Context(), server)
			if e != nil {
				return e
			}
			relations["server"] = item("server", server)
		}
	}
	if len(relations) > 0 {
		row["relationships"] = relations
	}
	return nil
}

func infraMountTable(relation string) (string, string) {
	switch relation {
	case "nodes":
		return "mount_nodes", "node_id"
	case "eggs":
		return "mount_eggs", "egg_id"
	default:
		return "mount_servers", "server_id"
	}
}
func (a *App) infraMountRelation(relation string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.requireAdmin(r); e != nil {
			fail(w, e)
			return
		}
		mountID, e := infraID(r.PathValue("mount"))
		if e != nil {
			fail(w, e)
			return
		}
		if _, e = a.one(r.Context(), "SELECT id FROM mounts WHERE id=$1", mountID); e != nil {
			fail(w, e)
			return
		}
		table, column := infraMountTable(relation)
		if r.Method == "GET" {
			selectColumns := "related.*"
			if relation == "nodes" {
				selectColumns = "related.id,related.uuid,related.name,related.fqdn,related.location_id"
			}
			records, e := a.query(r.Context(), "SELECT "+selectColumns+" FROM "+relation+" related JOIN "+table+" assigned ON assigned."+column+"=related.id WHERE assigned.mount_id=$1 ORDER BY related.id", mountID)
			if e != nil {
				fail(w, e)
				return
			}
			object := strings.TrimSuffix(relation, "s")
			infraPage(w, r, object, records)
			return
		}
		ids := []int64{}
		if r.Method == "DELETE" {
			id, e := infraID(r.PathValue("related"))
			if e != nil {
				fail(w, e)
				return
			}
			ids = append(ids, id)
		} else {
			data, e := decode(r)
			if e != nil {
				fail(w, e)
				return
			}
			values, ok := data[relation].([]any)
			if !ok || len(values) == 0 {
				fail(w, bad(relation+" must be a non-empty array of IDs."))
				return
			}
			for _, value := range values {
				v := M{"id": value}
				if e = infraInteger(v, "id", 1, 1<<62); e != nil {
					fail(w, e)
					return
				}
				ids = append(ids, num(v["id"]))
			}
		}
		// Lock the assignment rows as one unit so bad IDs never leave partial assignments.
		tx, e := a.DB.Begin(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		for _, id := range ids {
			var exists int64
			if e = tx.QueryRow(r.Context(), "SELECT id FROM "+relation+" WHERE id=$1", id).Scan(&exists); e != nil {
				fail(w, bad("An assignment references a missing "+strings.TrimSuffix(relation, "s")+"."))
				return
			}
			if relation == "servers" && r.Method == "POST" {
				var eligible bool
				e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM servers s JOIN mount_nodes mn ON mn.node_id=s.node_id AND mn.mount_id=$1 JOIN mount_eggs me ON me.egg_id=s.egg_id AND me.mount_id=$1 WHERE s.id=$2)`, mountID, id).Scan(&eligible)
				if e != nil {
					fail(w, e)
					return
				}
				if !eligible {
					fail(w, bad("The mount must be assigned to the server's node and egg first."))
					return
				}
			}
			if r.Method == "DELETE" {
				if relation != "servers" {
					var count int64
					joinField := "node_id"
					if relation == "eggs" {
						joinField = "egg_id"
					}
					e = tx.QueryRow(r.Context(), "SELECT COUNT(*) FROM mount_servers ms JOIN servers s ON s.id=ms.server_id WHERE ms.mount_id=$1 AND s."+joinField+"=$2", mountID, id).Scan(&count)
					if e != nil {
						fail(w, e)
						return
					}
					if count > 0 {
						fail(w, bad("Detach this mount from its servers before removing the node or egg."))
						return
					}
				}
				_, e = tx.Exec(r.Context(), "DELETE FROM "+table+" WHERE mount_id=$1 AND "+column+"=$2", mountID, id)
			} else {
				_, e = tx.Exec(r.Context(), "INSERT INTO "+table+"(mount_id,"+column+") VALUES($1,$2) ON CONFLICT DO NOTHING", mountID, id)
			}
			if e != nil {
				fail(w, e)
				return
			}
		}
		if e = tx.Commit(r.Context()); e != nil {
			fail(w, e)
			return
		}
		if relation == "servers" {
			for _, id := range ids {
				server, e := a.one(r.Context(), "SELECT * FROM servers WHERE id=$1", id)
				if e == nil {
					e = a.syncServer(r.Context(), server)
				}
				if e != nil {
					fail(w, APIError{Status: 502, Code: "MountSyncFailed", Detail: "The assignment was saved, but Wings rejected the update. Retry after restoring node connectivity."})
					return
				}
			}
		}
		if relation == "nodes" {
			for _, id := range ids {
				node, e := a.node(r.Context(), id)
				if e == nil {
					e = a.infraSyncNode(r.Context(), node, node)
				}
				if e != nil {
					fail(w, APIError{Status: 502, Code: "MountSyncFailed", Detail: "The assignment was saved, but Wings could not apply its allowed mounts. Restore node connectivity and retry."})
					return
				}
			}
		}
		w.WriteHeader(204)
	}
}

func (a *App) infraSyncMount(ctx context.Context, mountID int64) error {
	nodes, e := a.query(ctx, "SELECT n.* FROM nodes n JOIN mount_nodes mn ON mn.node_id=n.id WHERE mn.mount_id=$1 ORDER BY n.id", mountID)
	if e != nil {
		return e
	}
	for _, node := range nodes {
		if e = a.infraSyncNode(ctx, node, node); e != nil {
			return e
		}
	}
	servers, e := a.query(ctx, "SELECT s.* FROM servers s JOIN mount_servers ms ON ms.server_id=s.id WHERE ms.mount_id=$1 ORDER BY s.id", mountID)
	if e != nil {
		return e
	}
	for _, server := range servers {
		if e = a.syncServer(ctx, server); e != nil {
			return e
		}
	}
	return nil
}

func (a *App) infraDatabaseHostTest(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("host"))
	if e != nil {
		fail(w, e)
		return
	}
	host, e := a.one(r.Context(), "SELECT * FROM database_hosts WHERE id=$1", id)
	if e != nil {
		fail(w, e)
		return
	}
	cfg := mysql.NewConfig()
	cfg.User = str(host["username"])
	cfg.Passwd, e = a.unseal(str(host["password"]))
	if e != nil {
		fail(w, e)
		return
	}
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(str(host["host"]), fmt.Sprint(num(host["port"])))
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 5 * time.Second
	cfg.WriteTimeout = 5 * time.Second
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		fail(w, APIError{Status: 502, Code: "DatabaseHostConnectionFailed", Detail: "Unable to configure the database host connection."})
		return
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if e = db.PingContext(ctx); e != nil {
		fail(w, APIError{Status: 502, Code: "DatabaseHostConnectionFailed", Detail: "Connection failed. Verify the address, credentials, network access and database user's grants."})
		return
	}
	var version string
	if e = db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, M{"object": "database_host_connection", "attributes": M{"connected": true, "version": version}})
}

func infraSettingDefaults() M {
	return M{
		"app:name": "Voltra", "app:locale": "en", "app:timezone": "UTC",
		"pterodactyl:guzzle:timeout": int64(30), "pterodactyl:guzzle:connect_timeout": int64(10),
		"pterodactyl:client_features:allocations:enabled":     false,
		"pterodactyl:client_features:allocations:range_start": int64(25565), "pterodactyl:client_features:allocations:range_end": int64(26000),
		"pterodactyl:client_features:databases:enabled": true, "pterodactyl:client_features:databases:allow_random": true,
		"pterodactyl:client_features:schedules:per_schedule_task_limit": int64(10), "activity:hide_admin_activity": false,
		"backups.default": "wings", "backups.throttles.limit": int64(2), "backups.throttles.period": int64(600), "backups.prune_age": int64(360), "backups.presigned_url_lifespan": int64(60),
		"backups.s3": M{"bucket": "", "region": "us-east-1", "endpoint": "", "daemon_endpoint": "", "access_key_id": "", "secret_access_key": "", "session_token": "", "path_style": false, "part_size": int64(5 * 1024 * 1024 * 1024), "storage_class": ""},
	}
}
func (a *App) infraLoadSettings(ctx context.Context) (M, error) {
	settings := infraSettingDefaults()
	if a.Config.Timezone != "" {
		settings["app:timezone"] = a.Config.Timezone
	}
	records, e := a.query(ctx, "SELECT key,value FROM settings ORDER BY key")
	if e != nil {
		return nil, e
	}
	for _, row := range records {
		if _, allowed := settings[str(row["key"])]; allowed {
			key := str(row["key"])
			if key == "backups.s3" {
				merged := asMap(settings[key])
				for k, v := range asMap(row["value"]) {
					merged[k] = v
				}
				settings[key] = merged
			} else {
				settings[key] = row["value"]
			}
		}
	}
	return settings, nil
}
func infraPublicSettings(settings M) M {
	result := M{}
	for key, value := range settings {
		if !strings.HasPrefix(key, "mail:") && !strings.HasPrefix(key, "pterodactyl:email:") {
			result[key] = value
		}
	}
	s3 := M{}
	for key, value := range asMap(settings["backups.s3"]) {
		if key != "secret_access_key" && key != "session_token" {
			s3[key] = value
		}
	}
	for _, key := range []string{"secret_access_key", "session_token"} {
		s3[key+"_configured"] = str(asMap(settings["backups.s3"])[key]) != ""
	}
	result["backups.s3"] = s3
	return result
}
func (a *App) infraSettings(w http.ResponseWriter, r *http.Request) {
	a.infraApplySettings(w, r, false)
}

// Deployment identity settings are writable by the local CLI only. Keep the
// browser route on the same validation and transaction path without exposing
// an HTTP option to enable these fields.
func (a *App) infraApplySettings(w http.ResponseWriter, r *http.Request, deploymentSettings bool) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	settings, e := a.infraLoadSettings(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "GET" {
		writeJSON(w, 200, item("settings", infraPublicSettings(settings)))
		return
	}
	data, e := decodeRaw(r)
	if e != nil {
		fail(w, e)
		return
	}
	if !deploymentSettings {
		for _, key := range []string{"app:name", "app:locale", "app:timezone"} {
			if _, present := data[key]; present {
				fail(w, bad(key+" is not editable through panel settings."))
				return
			}
		}
	}
	// This settings API distinguishes an empty secret, which retains credentials,
	// from explicit null, which clears them. Preserve secret bytes across the
	// panel's normal trim and empty-string normalization.
	rawSecrets := M{}
	for _, key := range []string{"secret_access_key", "session_token"} {
		if value, present := asMap(data["backups.s3"])[key]; present {
			rawSecrets[key] = value
		}
	}
	data = normalizeInput(data, "").(M)
	if incoming, ok := data["backups.s3"].(map[string]any); ok {
		for key, value := range rawSecrets {
			incoming[key] = value
		}
	}
	for key, value := range data {
		if _, allowed := settings[key]; !allowed {
			fail(w, bad("Unknown or unavailable setting: "+key))
			return
		}
		if key == "backups.s3" {
			incoming, ok := value.(map[string]any)
			if !ok {
				fail(w, bad("backups.s3 must be an object."))
				return
			}
			merged := M{}
			for k, v := range asMap(infraSettingDefaults()[key]) {
				merged[k] = v
			}
			for k, v := range asMap(settings[key]) {
				merged[k] = v
			}
			for k, v := range incoming {
				if _, allowed := merged[k]; !allowed {
					fail(w, bad("Unknown S3 setting: "+k))
					return
				}
				if k == "secret_access_key" || k == "session_token" {
					if v == nil {
						merged[k] = ""
					} else if v != "" {
						plain, ok := v.(string)
						if !ok || len(plain) > 4096 {
							fail(w, bad(k+" must be a string."))
							return
						}
						sealed, e := a.seal(plain)
						if e != nil {
							fail(w, e)
							return
						}
						merged[k] = sealed
					}
				} else {
					merged[k] = v
				}
			}
			settings[key] = merged
		} else {
			settings[key] = value
		}
	}
	if e = infraString(settings, "app:name", 1, 191); e != nil {
		fail(w, e)
		return
	}
	if e = infraString(settings, "app:locale", 2, 10); e != nil {
		fail(w, e)
		return
	}
	if e = infraString(settings, "app:timezone", 1, 128); e != nil {
		fail(w, e)
		return
	}
	if _, e = time.LoadLocation(str(settings["app:timezone"])); e != nil {
		fail(w, bad("app:timezone must be a valid IANA timezone, such as UTC or Europe/Berlin."))
		return
	}
	for _, key := range []string{"pterodactyl:guzzle:timeout", "pterodactyl:guzzle:connect_timeout"} {
		if e = infraInteger(settings, key, 1, 60); e != nil {
			fail(w, e)
			return
		}
	}
	if e = infraBool(settings, "pterodactyl:client_features:allocations:enabled"); e != nil {
		fail(w, e)
		return
	}
	for _, key := range []string{"pterodactyl:client_features:databases:enabled", "pterodactyl:client_features:databases:allow_random", "activity:hide_admin_activity"} {
		if e = infraBool(settings, key); e != nil {
			fail(w, e)
			return
		}
	}
	if e = infraInteger(settings, "pterodactyl:client_features:schedules:per_schedule_task_limit", 1, 10000); e != nil {
		fail(w, e)
		return
	}
	startKey, endKey := "pterodactyl:client_features:allocations:range_start", "pterodactyl:client_features:allocations:range_end"
	for _, key := range []string{startKey, endKey} {
		if e = infraInteger(settings, key, 1025, 65535); e != nil {
			fail(w, e)
			return
		}
	}
	if num(settings[endKey]) <= num(settings[startKey]) {
		fail(w, bad("The allocation ending port must exceed its starting port."))
		return
	}
	if str(settings["backups.default"]) != "wings" && str(settings["backups.default"]) != "s3" {
		fail(w, bad("backups.default must be wings or s3."))
		return
	}
	for key, bounds := range map[string][2]int64{"backups.throttles.limit": {0, 10000}, "backups.throttles.period": {0, 31536000}, "backups.prune_age": {0, 525600}, "backups.presigned_url_lifespan": {1, 10080}} {
		if e = infraInteger(settings, key, bounds[0], bounds[1]); e != nil {
			fail(w, e)
			return
		}
	}
	s3 := asMap(settings["backups.s3"])
	for _, key := range []string{"bucket", "region", "endpoint", "daemon_endpoint", "access_key_id", "secret_access_key", "session_token", "storage_class"} {
		if e = infraString(s3, key, 0, 8192); e != nil {
			fail(w, e)
			return
		}
	}
	if e = infraBool(s3, "path_style"); e != nil {
		fail(w, e)
		return
	}
	if e = infraInteger(s3, "part_size", 5*1024*1024, 5*1024*1024*1024); e != nil {
		fail(w, e)
		return
	}
	for _, key := range []string{"endpoint", "daemon_endpoint"} {
		if endpoint := str(s3[key]); endpoint != "" {
			u, e := url.Parse(endpoint)
			if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
				fail(w, bad("The S3 endpoint must be an HTTP or HTTPS URL without credentials."))
				return
			}
		}
	}
	if str(settings["backups.default"]) == "s3" && str(s3["bucket"]) == "" {
		fail(w, bad("An S3 bucket is required when the default backup storage is S3."))
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	for key := range data {
		encoded, e := json.Marshal(settings[key])
		if e != nil {
			fail(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, string(encoded)); e != nil {
			fail(w, e)
			return
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("settings", infraPublicSettings(settings)))
}
