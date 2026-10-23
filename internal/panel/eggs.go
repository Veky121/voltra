package panel

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Egg configuration is kept as JSONB internally. Pterodactyl share files encode
// those objects a second time as JSON strings; only the import/export boundary
// uses that representation.
func eggJSON(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	if s, ok := v.(string); ok {
		var d any
		if err := json.Unmarshal([]byte(s), &d); err != nil {
			return nil, bad("Invalid egg configuration JSON: " + err.Error())
		}
		return d, nil
	}
	return v, nil
}
func eggJSONString(v any) any {
	if v == nil {
		return nil
	}
	b, _ := json.Marshal(v)
	return string(b)
}
func eggStrings(v any) []any {
	out := []any{}
	for _, x := range asSlice(v) {
		if str(x) != "" {
			out = append(out, str(x))
		}
	}
	return out
}
func eggSlice(v any) []any {
	if rows, ok := v.([]M); ok {
		out := make([]any, len(rows))
		for i, row := range rows {
			out[i] = row
		}
		return out
	}
	return asSlice(v)
}
func eggFields() []string {
	return []string{"java_config", "name", "description", "features", "docker_images", "file_denylist", "startup", "config_files", "config_startup", "config_logs", "config_stop", "config_from", "script_install", "script_entry", "script_container", "script_is_privileged", "copy_script_from", "force_outgoing_ip", "update_url"}
}

// parseEggDocument deliberately does not validate defaults against rules: many
// upstream eggs require the owner to supply a credential at server creation.
func parseEggDocument(d M) (M, []M, error) {
	version := str(asMap(d["meta"])["version"])
	if version != "PTDL_v1" && version != "PTDL_v2" {
		return nil, nil, bad("Unrecognized egg format; expected PTDL_v1 or PTDL_v2")
	}
	images := asMap(d["docker_images"])
	if version == "PTDL_v1" {
		images = M{}
		values := asSlice(d["images"])
		if d["images"] == nil {
			image := str(d["image"])
			if image == "" {
				image = "nil"
			}
			values = []any{image}
		}
		for _, image := range values {
			images[str(image)] = str(image)
		}
	}
	config := asMap(d["config"])
	installation := asMap(asMap(d["scripts"])["installation"])
	egg := M{"uuid": newUUID(), "name": d["name"], "author": d["author"], "description": d["description"], "features": d["features"], "docker_images": images, "file_denylist": eggStrings(d["file_denylist"]), "startup": d["startup"], "config_stop": config["stop"], "script_install": installation["script"], "script_entry": installation["entrypoint"], "script_container": installation["container"], "update_url": asMap(d["meta"])["update_url"], "force_outgoing_ip": false, "script_is_privileged": false, "config_from": nil, "copy_script_from": nil}
	for _, key := range []string{"files", "startup", "logs"} {
		value, err := eggJSON(config[key])
		if err != nil {
			return nil, nil, err
		}
		egg["config_"+key] = value
	}
	if egg["script_entry"] == nil {
		egg["script_entry"] = "bash"
	}
	if egg["script_container"] == nil {
		egg["script_container"] = "alpine:latest"
	}
	jc := asMap(d["voltra"])["java_config"]
	if jc == nil {
		jc = M{}
	}
	var javaErr error
	egg["java_config"], javaErr = javaNormalize(jc, true)
	if javaErr != nil {
		return nil, nil, javaErr
	}
	if err := validateEggRecord(egg); err != nil {
		return nil, nil, err
	}
	variables := []M{}
	for _, raw := range eggSlice(d["variables"]) {
		v := asMap(raw)
		normalized, err := normalizeEggVariable(v, true)
		if err != nil {
			return nil, nil, err
		}
		variables = append(variables, normalized)
	}
	return egg, variables, nil
}

func validateEggRecord(e M) error {
	if v, ok := e["java_config"]; ok {
		if _, err := javaNormalize(v, true); err != nil {
			return err
		}
	}
	if strings.TrimSpace(str(e["name"])) == "" || utf8.RuneCountInString(str(e["name"])) > 191 {
		return bad("Egg name must contain 1 to 191 characters")
	}
	if _, err := mail.ParseAddress(str(e["author"])); err != nil {
		return bad("Egg author must be an email address")
	}
	images := asMap(e["docker_images"])
	if len(images) == 0 {
		return bad("At least one Docker image is required")
	}
	for _, v := range images {
		if strings.TrimSpace(str(v)) == "" || len(str(v)) > 191 {
			return bad("Invalid Docker image")
		}
	}
	return nil
}

func (a *App) registerEggs(mux *http.ServeMux) {
	for _, base := range []string{"/api/admin/nests", "/api/application/nests"} {
		mux.HandleFunc("GET "+base, a.listNests)
		mux.HandleFunc("GET "+base+"/{nest}", a.getNest)
		mux.HandleFunc("GET "+base+"/{nest}/eggs", a.listEggs)
		mux.HandleFunc("GET "+base+"/{nest}/eggs/{egg}", a.getEgg)
	}
	mux.HandleFunc("POST /api/admin/nests", a.saveNest)
	mux.HandleFunc("PATCH /api/admin/nests/{nest}", a.saveNest)
	mux.HandleFunc("DELETE /api/admin/nests/{nest}", a.deleteNest)
	mux.HandleFunc("GET /api/admin/eggs", a.listEggs)
	mux.HandleFunc("GET /api/admin/eggs/{egg}", a.getEgg)
	mux.HandleFunc("POST /api/admin/nests/{nest}/eggs", a.saveEgg)
	mux.HandleFunc("POST /api/admin/eggs", a.saveEgg)
	mux.HandleFunc("PATCH /api/admin/eggs/{egg}", a.saveEgg)
	mux.HandleFunc("DELETE /api/admin/eggs/{egg}", a.deleteEgg)
	mux.HandleFunc("POST /api/admin/nests/{nest}/eggs/import", a.importEgg)
	mux.HandleFunc("POST /api/admin/eggs/import", a.importEgg)
	mux.HandleFunc("POST /api/admin/eggs/{egg}/import", a.importEgg)
	mux.HandleFunc("GET /api/admin/eggs/{egg}/export", a.exportEgg)
	mux.HandleFunc("PATCH /api/admin/eggs/{egg}/scripts", a.saveEgg)
	mux.HandleFunc("GET /api/admin/eggs/{egg}/variables", a.listEggVariables)
	mux.HandleFunc("POST /api/admin/eggs/{egg}/variables", a.saveEggVariable)
	mux.HandleFunc("PATCH /api/admin/eggs/{egg}/variables/{variable}", a.saveEggVariable)
	mux.HandleFunc("DELETE /api/admin/eggs/{egg}/variables/{variable}", a.deleteEggVariable)
}
func eggParam(r *http.Request, key string) int64 {
	n, _ := strconv.ParseInt(r.PathValue(key), 10, 64)
	return n
}
func (a *App) eggAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return false
	}
	return true
}
func eggInclude(r *http.Request, name string) bool {
	for _, s := range strings.Split(r.URL.Query().Get("include"), ",") {
		if s == name || strings.HasPrefix(s, name+".") {
			return true
		}
	}
	return false
}
func (a *App) listNests(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	rows, err := a.query(r.Context(), "SELECT * FROM nests ORDER BY id")
	if err != nil {
		fail(w, err)
		return
	}
	for _, n := range rows {
		if err = a.nestRelationships(r, n); err != nil {
			fail(w, err)
			return
		}
	}
	writeJSON(w, 200, eggPage(r, "nest", rows))
}
func (a *App) nestRelationships(r *http.Request, n M) error {
	rels := M{}
	if eggInclude(r, "eggs") {
		eggs, err := a.query(r.Context(), "SELECT * FROM eggs WHERE nest_id=$1 ORDER BY id", n["id"])
		if err != nil {
			return err
		}
		out := []M{}
		for _, e := range eggs {
			x, err := a.eggAttributes(r, e)
			if err != nil {
				return err
			}
			out = append(out, x)
		}
		rels["eggs"] = collection("egg", out)
	}
	if eggInclude(r, "servers") {
		s, err := a.query(r.Context(), "SELECT * FROM servers WHERE nest_id=$1 ORDER BY id", n["id"])
		if err != nil {
			return err
		}
		rels["servers"] = collection("server", s)
	}
	if len(rels) > 0 {
		n["relationships"] = rels
	}
	return nil
}
func (a *App) getNest(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	n, err := a.one(r.Context(), "SELECT * FROM nests WHERE id=$1", eggParam(r, "nest"))
	if err == nil {
		err = a.nestRelationships(r, n)
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("nest", n))
}
func (a *App) saveNest(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	id := eggParam(r, "nest")
	data := M{}
	if id == 0 {
		data = M{"uuid": newUUID(), "author": "admin@localhost", "description": ""}
	}
	for _, k := range []string{"name", "description", "author"} {
		if v, ok := d[k]; ok {
			if v != nil {
				if _, isString := v.(string); !isString {
					fail(w, bad(k+" must be a string"))
					return
				}
			}
			data[k] = v
		}
	}
	if id != 0 {
		existing, e := a.one(r.Context(), "SELECT * FROM nests WHERE id=$1", id)
		if e != nil {
			fail(w, e)
			return
		}
		for k, v := range data {
			existing[k] = v
		}
		d = existing
	} else {
		d = data
	}
	if strings.TrimSpace(str(d["name"])) == "" || len(str(d["name"])) > 191 {
		fail(w, bad("Nest name must contain 1 to 191 characters"))
		return
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_\- ]+$`).MatchString(str(d["name"])) {
		fail(w, bad("Nest name contains invalid characters"))
		return
	}
	if _, err = mail.ParseAddress(str(d["author"])); err != nil {
		fail(w, bad("Nest author must be an email address"))
		return
	}
	var row M
	status := 200
	if id == 0 {
		row, err = a.insert(r.Context(), "nests", data)
		status = 201
	} else {
		row, err = a.update(r.Context(), "nests", id, data)
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, status, item("nest", row))
}
func (a *App) deleteNest(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	id := eggParam(r, "nest")
	n, err := a.one(r.Context(), "SELECT count(*) AS count FROM eggs WHERE nest_id=$1", id)
	if err == nil && num(n["count"]) > 0 {
		err = bad("Cannot delete a nest containing eggs")
	}
	if err == nil {
		_, err = a.one(r.Context(), "DELETE FROM nests WHERE id=$1 RETURNING id", id)
	}
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}
func (a *App) listEggs(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	sql := "SELECT * FROM eggs"
	args := []any{}
	id := eggParam(r, "nest")
	if id != 0 {
		sql += " WHERE nest_id=$1"
		args = append(args, id)
	}
	rows, err := a.query(r.Context(), sql+" ORDER BY id", args...)
	if err != nil {
		fail(w, err)
		return
	}
	out := []M{}
	for _, e := range rows {
		x, err := a.eggAttributes(r, e)
		if err != nil {
			fail(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, eggPage(r, "egg", out))
}
func (a *App) eggAttributes(r *http.Request, e M) (M, error) {
	images := asMap(e["docker_images"])
	keys := []string{}
	for k := range images {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	first := ""
	if len(keys) > 0 {
		first = str(images[keys[0]])
	}
	out := M{"id": e["id"], "uuid": e["uuid"], "nest": e["nest_id"], "nest_id": e["nest_id"], "name": e["name"], "author": e["author"], "description": e["description"], "docker_image": first, "docker_images": images, "startup": e["startup"], "features": e["features"], "force_outgoing_ip": e["force_outgoing_ip"], "update_url": e["update_url"], "java_config": asMap(e["java_config"]), "config": M{"files": e["config_files"], "startup": e["config_startup"], "logs": e["config_logs"], "stop": e["config_stop"], "file_denylist": e["file_denylist"], "extends": e["config_from"]}, "script": M{"privileged": e["script_is_privileged"], "install": e["script_install"], "entry": e["script_entry"], "container": e["script_container"], "extends": e["copy_script_from"]}, "created_at": e["created_at"], "updated_at": e["updated_at"]}
	// Flat properties are exposed on the admin API for editing.
	if strings.HasPrefix(r.URL.Path, "/api/admin/") {
		for _, k := range eggFields() {
			out[k] = e[k]
		}
	}
	rels := M{}
	if eggInclude(r, "variables") || strings.HasPrefix(r.URL.Path, "/api/admin/") {
		vars, err := a.eggVariables(r.Context(), num(e["id"]))
		if err != nil {
			return nil, err
		}
		rels["variables"] = collection("egg_variable", vars)
	}
	if eggInclude(r, "nest") {
		n, err := a.one(r.Context(), "SELECT * FROM nests WHERE id=$1", e["nest_id"])
		if err != nil {
			return nil, err
		}
		rels["nest"] = item("nest", n)
	}
	if eggInclude(r, "servers") {
		s, err := a.query(r.Context(), "SELECT * FROM servers WHERE egg_id=$1 ORDER BY id", e["id"])
		if err != nil {
			return nil, err
		}
		rels["servers"] = collection("server", s)
	}
	if eggInclude(r, "config") || eggInclude(r, "script") {
		eff, err := a.effectiveEgg(r.Context(), num(e["id"]))
		if err != nil {
			return nil, err
		}
		if eggInclude(r, "config") {
			rels["config"] = item("egg_config", M{"files": eff["config_files"], "startup": eff["config_startup"], "logs": eff["config_logs"], "stop": eff["config_stop"]})
		}
		if eggInclude(r, "script") {
			rels["script"] = item("egg_script", M{"privileged": eff["script_is_privileged"], "install": eff["script_install"], "entry": eff["script_entry"], "container": eff["script_container"]})
		}
	}
	if len(rels) > 0 {
		out["relationships"] = rels
	}
	return out, nil
}
func eggPage(r *http.Request, object string, rows []M) M {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	per, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if per < 1 || per > 1000 {
		per = 50
	}
	total := len(rows)
	start := (page - 1) * per
	if start > total {
		start = total
	}
	end := start + per
	if end > total {
		end = total
	}
	out := collection(object, rows[start:end])
	pages := (total + per - 1) / per
	if pages == 0 {
		pages = 1
	}
	out["meta"] = M{"pagination": M{"total": total, "count": end - start, "per_page": per, "current_page": page, "total_pages": pages, "links": M{}}}
	return out
}
func (a *App) getEgg(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	e, err := a.one(r.Context(), "SELECT * FROM eggs WHERE id=$1", eggParam(r, "egg"))
	if err == nil && eggParam(r, "nest") != 0 && num(e["nest_id"]) != eggParam(r, "nest") {
		err = notFound()
	}
	var out M
	if err == nil {
		out, err = a.eggAttributes(r, e)
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("egg", out))
}

func (a *App) saveEgg(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	id := eggParam(r, "egg")
	data := M{}
	var existing M
	if id == 0 {
		nest := eggParam(r, "nest")
		if nest == 0 {
			nest = num(d["nest_id"])
		}
		data = M{"uuid": newUUID(), "nest_id": nest, "author": "admin@localhost", "description": "", "features": nil, "file_denylist": []any{}, "docker_images": M{}, "startup": "", "config_files": M{}, "config_startup": M{}, "config_logs": M{}, "config_stop": "stop", "script_install": "", "script_entry": "bash", "script_container": "alpine:latest"}
		existing = M{}
	} else {
		existing, err = a.one(r.Context(), "SELECT * FROM eggs WHERE id=$1", id)
		if err != nil {
			fail(w, err)
			return
		}
	}
	if x, ok := d["author"]; ok {
		data["author"] = x
	}
	for _, key := range eggFields() {
		if v, ok := d[key]; ok {
			if key == "config_files" || key == "config_startup" || key == "config_logs" {
				v, err = eggJSON(v)
				if err != nil {
					fail(w, err)
					return
				}
			}
			if key == "config_from" || key == "copy_script_from" {
				if num(v) == 0 {
					v = nil
				} else {
					v = num(v)
				}
			}
			if key == "java_config" {
				v, err = javaNormalize(v, true)
				if err != nil {
					fail(w, err)
					return
				}
			}
			data[key] = v
		}
	}
	for k, v := range data {
		existing[k] = v
	}
	if err = validateEggEditor(d, existing, id == 0, strings.HasSuffix(r.URL.Path, "/scripts")); err == nil {
		err = validateEggRecord(existing)
	}
	if err == nil {
		err = a.validateEggParents(r.Context(), existing, id)
	}
	if err != nil {
		fail(w, err)
		return
	}
	status := 200
	var row M
	if id == 0 {
		row, err = a.insert(r.Context(), "eggs", data)
		status = 201
	} else {
		row, err = a.update(r.Context(), "eggs", id, data)
	}
	if err != nil {
		fail(w, err)
		return
	}
	out, err := a.eggAttributes(r, row)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, status, item("egg", out))
}

// PTDL force-import bypasses the original editor request validation. Keep the
// editor guards here so permissive share-file transport never weakens editing.
func validateEggEditor(input, effective M, creating, scriptsOnly bool) error {
	for _, key := range []string{"name", "author", "description", "startup", "config_stop", "script_install", "script_entry", "script_container", "update_url"} {
		if value, present := input[key]; present && value != nil {
			if _, ok := value.(string); !ok {
				return bad(key + " must be a string")
			}
		}
	}
	for _, key := range []string{"force_outgoing_ip", "script_is_privileged"} {
		if value, present := input[key]; present {
			if err := validateEggValue(value, true, "required|boolean", M{}); err != nil {
				return bad(key + " must be a boolean")
			}
		}
	}
	for _, key := range []string{"config_from", "copy_script_from"} {
		if value, present := input[key]; present && value != nil {
			if _, ok := eggRational(value); !ok {
				return bad(key + " must be numeric")
			}
		}
	}
	for _, key := range []string{"features", "file_denylist"} {
		if value, present := input[key]; present {
			values, _, ok := eggArray(value)
			if !ok {
				return bad(key + " must be an array")
			}
			if key == "file_denylist" {
				for _, element := range values {
					if _, ok := element.(string); !ok {
						return bad("file_denylist entries must be strings")
					}
				}
			}
		}
	}
	if images, present := input["docker_images"]; present {
		values, _, ok := eggArray(images)
		if !ok || len(values) == 0 {
			return bad("docker_images must contain at least one image")
		}
		imagePattern, err := eggPattern(`/^[\w#\.\/\- ]*\|?~?[\w\.\/\-:@ ]*$/`)
		if err != nil {
			return err
		}
		for _, image := range values {
			text, ok := image.(string)
			if !ok || strings.TrimSpace(text) == "" || utf8.RuneCountInString(text) > 191 {
				return bad("Docker image must be a nonempty string of at most 191 characters")
			}
			valid, err := imagePattern.MatchString(text)
			if err != nil || !valid {
				return bad("Invalid Docker image syntax")
			}
		}
	}
	if scriptsOnly {
		for _, key := range []string{"script_entry", "script_container"} {
			if value, present := input[key]; present && eggEmpty(value) {
				return bad(key + " is required")
			}
		}
		return nil
	}
	for _, key := range []string{"name", "startup"} {
		if eggEmpty(effective[key]) {
			return bad(key + " is required")
		}
	}
	if num(effective["config_from"]) == 0 {
		for _, key := range []string{"config_stop", "config_startup", "config_logs", "config_files"} {
			_, supplied := input[key]
			empty := effective[key] == nil
			if value, isString := effective[key].(string); isString {
				empty = strings.TrimSpace(value) == ""
			}
			if creating && !supplied || empty {
				return bad(key + " is required without config_from")
			}
		}
	}
	if value := effective["config_stop"]; value != nil && utf8.RuneCountInString(str(value)) > 191 {
		return bad("config_stop must contain at most 191 characters")
	}
	return nil
}
func (a *App) validateEggParents(ctx context.Context, e M, id int64) error {
	for _, key := range []string{"config_from", "copy_script_from"} {
		parent := num(e[key])
		if parent == 0 {
			continue
		}
		if parent == id {
			return bad("An egg cannot inherit from itself")
		}
		p, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", parent)
		if err != nil {
			return err
		}
		if num(p["nest_id"]) != num(e["nest_id"]) {
			return bad("Parent egg must belong to the same nest")
		}
		if key == "copy_script_from" && num(p[key]) != 0 {
			return bad("Cannot copy a script from an egg that already copies another script")
		}
		visited := map[int64]bool{id: true}
		for parent != 0 {
			if visited[parent] {
				return bad("Egg inheritance would create a cycle")
			}
			visited[parent] = true
			p, err = a.one(ctx, "SELECT * FROM eggs WHERE id=$1", parent)
			if err != nil {
				return err
			}
			parent = num(p[key])
		}
	}
	return nil
}
func (a *App) deleteEgg(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	id := eggParam(r, "egg")
	n, err := a.one(r.Context(), "SELECT (SELECT count(*) FROM servers WHERE egg_id=$1)+(SELECT count(*) FROM eggs WHERE config_from=$1 OR copy_script_from=$1) AS count", id)
	if err == nil && num(n["count"]) > 0 {
		err = bad("Egg has servers or dependent eggs and cannot be deleted")
	}
	if err == nil {
		_, err = a.one(r.Context(), "DELETE FROM eggs WHERE id=$1 RETURNING id", id)
	}
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}

func (a *App) effectiveEgg(ctx context.Context, id int64) (M, error) {
	return a.effectiveEggSeen(ctx, id, map[int64]bool{})
}
func (a *App) effectiveEggSeen(ctx context.Context, id int64, seen map[int64]bool) (M, error) {
	if seen[id] {
		return nil, bad("Egg inheritance cycle")
	}
	seen[id] = true
	defer delete(seen, id)
	e, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", id)
	if err != nil {
		return nil, err
	}
	if parent := num(e["config_from"]); parent != 0 {
		p, err := a.effectiveEggSeen(ctx, parent, seen)
		if err != nil {
			return nil, err
		}
		for _, k := range []string{"config_files", "config_startup", "config_logs", "config_stop", "features"} {
			if e[k] == nil {
				e[k] = p[k]
			}
		}
		e["file_denylist"] = p["file_denylist"]
	}
	if parent := num(e["copy_script_from"]); parent != 0 {
		p, err := a.effectiveEggSeen(ctx, parent, seen)
		if err != nil {
			return nil, err
		}
		if e["script_install"] == nil {
			e["script_install"] = p["script_install"]
		}
		e["script_entry"] = p["script_entry"]
		e["script_container"] = p["script_container"]
	}
	return e, nil
}
func (a *App) eggVariables(ctx context.Context, id int64) ([]M, error) {
	return a.query(ctx, "SELECT * FROM egg_variables WHERE egg_id=$1 ORDER BY id", id)
}

func (a *App) importEgg(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	var d M
	nest := eggParam(r, "nest")
	var err error
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err = r.ParseMultipartForm(8 << 20); err == nil {
			var f io.ReadCloser
			f, _, err = r.FormFile("file")
			if err != nil {
				f, _, err = r.FormFile("import_file")
			}
			if err == nil {
				defer f.Close()
				err = json.NewDecoder(f).Decode(&d)
			}
			if nest == 0 {
				nest, _ = strconv.ParseInt(r.FormValue("nest_id"), 10, 64)
			}
		}
	} else {
		d, err = decodeRaw(r)
		if err == nil {
			if nest == 0 {
				nest = num(d["nest_id"])
			}
			if raw, ok := d["egg"]; ok {
				if s, ok := raw.(string); ok {
					err = json.Unmarshal([]byte(s), &d)
				} else {
					d = asMap(raw)
				}
			}
		}
	}
	if err != nil {
		fail(w, bad("Cannot read egg upload: "+err.Error()))
		return
	}
	id := eggParam(r, "egg")
	if id != 0 {
		existing, e := a.one(r.Context(), "SELECT * FROM eggs WHERE id=$1", id)
		if e != nil {
			fail(w, e)
			return
		}
		nest = num(existing["nest_id"])
	}
	egg, vars, err := parseEggDocument(d)
	if err == nil {
		_, err = a.one(r.Context(), "SELECT id FROM nests WHERE id=$1", nest)
	}
	if err != nil {
		fail(w, err)
		return
	}
	egg["nest_id"] = nest
	row, err := a.importEggRecord(r.Context(), id, egg, vars)
	if err != nil {
		fail(w, err)
		return
	}
	out, err := a.eggAttributes(r, row)
	if err != nil {
		fail(w, err)
		return
	}
	status := 201
	if id != 0 {
		status = 200
	}
	writeJSON(w, status, item("egg", out))
}
func (a *App) importEggRecord(ctx context.Context, id int64, egg M, vars []M) (M, error) {
	updating := id != 0
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	fields := []string{"java_config", "nest_id", "author", "name", "description", "features", "docker_images", "file_denylist", "startup", "config_files", "config_startup", "config_logs", "config_stop", "script_install", "script_entry", "script_container", "update_url"}
	if egg["java_config"] == nil {
		egg["java_config"] = M{}
	}
	args := []any{}
	for _, k := range fields {
		args = append(args, egg[k])
	}
	if id == 0 {
		fields = append(fields, "uuid")
		args = append(args, egg["uuid"])
		holders := []string{}
		for i := range args {
			holders = append(holders, fmt.Sprintf("$%d", i+1))
		}
		err = tx.QueryRow(ctx, "INSERT INTO eggs ("+strings.Join(fields, ",")+") VALUES ("+strings.Join(holders, ",")+") RETURNING id", args...).Scan(&id)
	} else { // Updating an export preserves stable UUID, author and inheritance links upstream.
		sets := []string{}
		values := []any{}
		for _, k := range fields {
			if k == "author" || k == "nest_id" {
				continue
			}
			values = append(values, egg[k])
			sets = append(sets, fmt.Sprintf("%s=$%d", k, len(values)))
		}
		values = append(values, id)
		_, err = tx.Exec(ctx, "UPDATE eggs SET "+strings.Join(sets, ",")+",updated_at=now() WHERE id=$"+strconv.Itoa(len(values)), values...)
	}
	if err != nil {
		return nil, err
	}
	names := []string{}
	for _, v := range vars {
		names = append(names, str(v["env_variable"]))
		var variableID int64
		if updating {
			err = tx.QueryRow(ctx, "SELECT id FROM egg_variables WHERE egg_id=$1 AND env_variable=$2 ORDER BY id LIMIT 1", id, v["env_variable"]).Scan(&variableID)
			if err != nil && err != pgx.ErrNoRows {
				return nil, err
			}
		}
		if variableID == 0 {
			_, err = tx.Exec(ctx, `INSERT INTO egg_variables (egg_id,name,description,env_variable,default_value,user_viewable,user_editable,rules,field_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, v["name"], v["description"], v["env_variable"], v["default_value"], v["user_viewable"], v["user_editable"], v["rules"], v["field_type"])
		} else {
			_, err = tx.Exec(ctx, `UPDATE egg_variables SET name=$2,description=$3,default_value=$4,user_viewable=$5,user_editable=$6,rules=$7,field_type=$8,updated_at=now() WHERE id=$1`, variableID, v["name"], v["description"], v["default_value"], v["user_viewable"], v["user_editable"], v["rules"], v["field_type"])
		}
		if err != nil {
			return nil, err
		}
	}
	if _, err = tx.Exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1 AND NOT (env_variable=ANY($2::text[]))", id, names); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return a.one(ctx, "SELECT * FROM eggs WHERE id=$1", id)
}
func (a *App) eggExport(ctx context.Context, id int64) (M, error) {
	raw, err := a.one(ctx, "SELECT features FROM eggs WHERE id=$1", id)
	if err != nil {
		return nil, err
	}
	e, err := a.effectiveEgg(ctx, id)
	if err != nil {
		return nil, err
	}
	vars, err := a.eggVariables(ctx, id)
	if err != nil {
		return nil, err
	}
	outVars := []M{}
	for _, v := range vars {
		outVars = append(outVars, M{"name": v["name"], "description": v["description"], "env_variable": v["env_variable"], "default_value": v["default_value"], "user_viewable": v["user_viewable"], "user_editable": v["user_editable"], "rules": v["rules"], "field_type": "text"})
	}
	return M{"voltra": M{"java_config": asMap(e["java_config"])}, "_comment": "DO NOT EDIT: FILE GENERATED AUTOMATICALLY BY VOLTRA", "meta": M{"version": "PTDL_v2", "update_url": e["update_url"]}, "exported_at": time.Now().UTC().Format(time.RFC3339), "name": e["name"], "author": e["author"], "description": e["description"], "features": raw["features"], "docker_images": e["docker_images"], "file_denylist": eggStrings(e["file_denylist"]), "startup": e["startup"], "config": M{"files": eggJSONString(e["config_files"]), "startup": eggJSONString(e["config_startup"]), "logs": eggJSONString(e["config_logs"]), "stop": e["config_stop"]}, "scripts": M{"installation": M{"script": e["script_install"], "container": e["script_container"], "entrypoint": e["script_entry"]}}, "variables": outVars}, nil
}
func (a *App) exportEgg(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	d, err := a.eggExport(r.Context(), eggParam(r, "egg"))
	if err != nil {
		fail(w, err)
		return
	}
	filename := regexp.MustCompile(`[^a-z0-9_-]+`).ReplaceAllString(strings.ToLower(str(d["name"])), "-")
	w.Header().Set("Content-Disposition", `attachment; filename="egg-`+filename+`.json"`)
	writeJSON(w, 200, d)
}

func normalizeEggVariable(d M, imported bool) (M, error) {
	if _, ok := d["rules"].(string); !ok || strings.TrimSpace(str(d["rules"])) == "" {
		return nil, bad("Variable rules must be a nonempty string")
	}
	if !imported {
		for _, key := range []string{"name", "env_variable"} {
			if _, ok := d[key].(string); !ok {
				return nil, bad(key + " must be a string")
			}
		}
		if value, present := d["description"]; present && value != nil {
			if _, ok := value.(string); !ok {
				return nil, bad("description must be a string")
			}
		}
		if value, present := d["default_value"]; !present {
			return nil, bad("default_value must be present")
		} else if value != nil {
			if _, ok := value.(string); !ok {
				return nil, bad("default_value must be a string")
			}
		}
		for _, key := range []string{"user_viewable", "user_editable"} {
			if value, present := d[key]; present {
				if err := validateEggValue(value, true, "boolean", M{}); err != nil {
					return nil, bad(key + " must be a boolean")
				}
			}
		}
		if options, present := d["options"]; present {
			if _, _, ok := eggArray(options); !ok || eggEmpty(options) {
				return nil, bad("options must be a nonempty array")
			}
		}
	}
	v := M{"name": str(d["name"]), "description": str(d["description"]), "env_variable": str(d["env_variable"]), "default_value": str(d["default_value"]), "user_viewable": boolean(d["user_viewable"]), "user_editable": boolean(d["user_editable"]), "rules": str(d["rules"]), "field_type": "text"}
	if options, ok := d["options"]; ok {
		v["user_viewable"] = false
		v["user_editable"] = false
		for _, x := range asSlice(options) {
			if str(x) == "user_viewable" {
				v["user_viewable"] = true
			}
			if str(x) == "user_editable" {
				v["user_editable"] = true
			}
		}
	}
	if str(v["name"]) == "" || utf8.RuneCountInString(str(v["name"])) > 191 {
		return nil, bad("Variable name must contain 1 to 191 characters")
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_]{1,191}$`).MatchString(str(v["env_variable"])) {
		return nil, bad("Invalid environment variable name")
	}
	// Imports upstream bypass the reserved-name guard; preserve that compatibility.
	if !imported && strings.Contains(",SERVER_MEMORY,SERVER_IP,SERVER_PORT,ENV,HOME,USER,STARTUP,SERVER_UUID,UUID,", ","+strings.ToUpper(str(v["env_variable"]))+",") {
		return nil, bad("Reserved environment variable name")
	}
	if !imported {
		if err := validateEggRules(str(v["rules"])); err != nil {
			return nil, err
		}
	}
	return v, nil
}
func (a *App) listEggVariables(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	rows, err := a.eggVariables(r.Context(), eggParam(r, "egg"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, collection("egg_variable", rows))
}
func (a *App) saveEggVariable(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	id := eggParam(r, "variable")
	if id != 0 {
		existing, e := a.one(r.Context(), "SELECT * FROM egg_variables WHERE id=$1 AND egg_id=$2", id, eggParam(r, "egg"))
		if e != nil {
			fail(w, e)
			return
		}
		for k, v := range d {
			existing[k] = v
		}
		d = existing
	}
	v, err := normalizeEggVariable(d, false)
	if err != nil {
		fail(w, err)
		return
	}
	var row M
	status := 200
	if id == 0 {
		v["egg_id"] = eggParam(r, "egg")
		row, err = a.insert(r.Context(), "egg_variables", v)
		status = 201
	} else {
		row, err = a.update(r.Context(), "egg_variables", id, v)
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, status, item("egg_variable", row))
}
func (a *App) deleteEggVariable(w http.ResponseWriter, r *http.Request) {
	if !a.eggAdmin(w, r) {
		return
	}
	_, err := a.one(r.Context(), "DELETE FROM egg_variables WHERE id=$1 AND egg_id=$2 RETURNING id", eggParam(r, "variable"), eggParam(r, "egg"))
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}

type eggRule struct {
	name   string
	params string
}

const eggSupportedRuleNames = "required nullable present sometimes bail string integer numeric decimal boolean alpha alpha_num alpha_dash ascii lowercase uppercase in not_in min max between size gt gte lt lte digits digits_between min_digits max_digits url active_url email ip ipv4 ipv6 json uuid starts_with ends_with doesnt_start_with doesnt_end_with required_if required_unless required_with required_with_all required_without required_without_all same different confirmed accepted declined date date_format after after_or_equal before before_or_equal regex not_regex multiple_of hex_color mac_address filled date_equals timezone ulid accepted_if declined_if required_if_accepted required_if_declined present_if present_unless present_with present_with_all missing missing_if missing_unless missing_with missing_with_all prohibited prohibited_if prohibited_unless prohibited_if_accepted prohibited_if_declined prohibits exclude exclude_if exclude_unless exclude_with exclude_without encoding array list required_array_keys contains doesnt_contain in_array in_array_keys distinct file image mimes mimetypes extensions dimensions exists unique"

func eggCanonicalRuleName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "int" {
		return "integer"
	}
	if name == "bool" {
		return "boolean"
	}
	compact := strings.ReplaceAll(name, "_", "")
	for _, known := range strings.Fields(eggSupportedRuleNames) {
		if strings.ReplaceAll(known, "_", "") == compact {
			return known
		}
	}
	return name
}

// Regex rules may contain pipes, including an escaped delimiter. Splitting the
// entire rule string on pipes corrupts common PTDL expressions.
func splitEggRules(rules string) ([]eggRule, error) {
	out := []eggRule{}
	for len(rules) > 0 {
		rules = strings.TrimLeft(rules, "|")
		if rules == "" {
			break
		}
		colon := strings.IndexByte(rules, ':')
		pipe := strings.IndexByte(rules, '|')
		name := rules
		params := ""
		if colon >= 0 && (pipe < 0 || colon < pipe) {
			name = eggCanonicalRuleName(rules[:colon])
			rest := rules[colon+1:]
			if name == "regex" || name == "not_regex" {
				if len(rest) < 2 {
					return nil, bad("Malformed " + name + " rule")
				}
				start := 0
				for start < len(rest) && strings.ContainsRune(" \t\r\n\v\f", rune(rest[start])) {
					start++
				}
				if start >= len(rest) {
					return nil, bad("Malformed regex rule")
				}
				delimiter := rest[start]
				close := delimiter
				switch delimiter {
				case '(':
					close = ')'
				case '[':
					close = ']'
				case '{':
					close = '}'
				case '<':
					close = '>'
				}
				level := 1
				end := -1
				escaped := false
				for i := start + 1; i < len(rest); i++ {
					if escaped {
						escaped = false
						continue
					}
					if rest[i] == '\\' {
						escaped = true
						continue
					}
					if rest[i] == close {
						level--
						if level == 0 {
							end = i
							break
						}
					} else if close != delimiter && rest[i] == delimiter {
						level++
					}
				}
				if end < 0 {
					return nil, bad("Unterminated regex rule")
				}
				next := strings.IndexByte(rest[end+1:], '|')
				if next < 0 {
					params = rest
					rules = ""
				} else {
					next += end + 1
					params = rest[:next]
					rules = rest[next+1:]
				}
			} else {
				if p := strings.IndexByte(rest, '|'); p >= 0 {
					params = rest[:p]
					rules = rest[p+1:]
				} else {
					params = rest
					rules = ""
				}
			}
		} else {
			if pipe >= 0 {
				name = rules[:pipe]
				rules = rules[pipe+1:]
			} else {
				rules = ""
			}
		}
		if name != "" {
			out = append(out, eggRule{eggCanonicalRuleName(name), params})
		}
	}
	return out, nil
}
func eggPattern(pattern string) (*eggPCRE, error) { return compileEggPCRE(pattern) }
func validateEggRules(rules string) error {
	parsed, err := splitEggRules(rules)
	if err != nil {
		return err
	}
	for _, r := range parsed {
		switch r.name {
		case "regex", "not_regex":
			if _, err := eggPattern(r.params); err != nil {
				return err
			}
		default:
			if !strings.Contains(" "+eggSupportedRuleNames+" ", " "+r.name+" ") {
				return bad("Unsupported Laravel validation rule: " + r.name)
			}
			if err := eggRuleDefinition(r); err != nil {
				return err
			}
		}
	}
	return nil
}
func eggRuleParams(s string) []string {
	v, err := csv.NewReader(strings.NewReader(s)).Read()
	if err != nil {
		return strings.Split(s, ",")
	}
	return v
}
func eggHasRule(rs []eggRule, name string) bool {
	for _, r := range rs {
		if r.name == name {
			return true
		}
	}
	return false
}
func eggParamContains(list []string, value string) bool {
	for _, x := range list {
		if x == value {
			return true
		}
	}
	return false
}
func eggEmpty(v any) bool {
	if v == nil {
		return true
	}
	switch x := v.(type) {
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	case string:
		return strings.TrimSpace(x) == ""
	}
	return false
}
func eggValueSize(value string, rs []eggRule) float64 {
	if eggHasRule(rs, "numeric") || eggHasRule(rs, "integer") || eggHasRule(rs, "int") || eggHasRule(rs, "decimal") {
		n, _ := strconv.ParseFloat(value, 64)
		return n
	}
	return float64(utf8.RuneCountInString(value))
}
func eggRuleDefinition(r eggRule) error {
	count := len(eggRuleParams(r.params))
	if r.params == "" {
		count = 0
	}
	min := 0
	switch r.name {
	case "required_if", "required_unless", "present_if", "present_unless", "missing_if", "missing_unless", "prohibited_if", "prohibited_unless", "exclude_if", "exclude_unless", "accepted_if", "declined_if":
		min = 2
	case "multiple_of", "exists", "unique", "decimal", "encoding", "date_equals", "date_format", "after", "before", "after_or_equal", "before_or_equal", "same", "different", "gt", "gte", "lt", "lte", "size", "min", "max", "digits", "min_digits", "max_digits", "required_with", "required_with_all", "required_without", "required_without_all", "required_if_accepted", "required_if_declined", "present_with", "present_with_all", "missing_with", "missing_with_all", "prohibited_if_accepted", "prohibited_if_declined", "exclude_with", "exclude_without", "starts_with", "ends_with", "doesnt_start_with", "doesnt_end_with", "required_array_keys", "in_array", "in_array_keys":
		min = 1
	case "between", "digits_between":
		min = 2
	}
	if count < min {
		return bad("Validation rule " + r.name + " requires more parameters")
	}
	if r.name == "encoding" && !eggEncodingSupported(eggRuleParams(r.params)[0]) {
		return bad("Unsupported encoding parameter: " + eggRuleParams(r.params)[0])
	}
	return nil
}
func eggRuleOther(env M, key string) (any, bool) {
	if data, ok := env["__egg_validation_data"].(map[string]any); ok {
		return eggRuleLookup(data, key)
	}
	if !strings.HasPrefix(key, "environment.") {
		return nil, false
	}
	key = strings.TrimPrefix(key, "environment.")
	return eggRuleLookup(env, key)
}
func eggRuleLookup(env M, key string) (any, bool) {
	var current any = env
	for _, part := range strings.Split(key, ".") {
		m, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		value, ok := m[part]
		if !ok {
			return nil, false
		}
		current = value
	}
	return current, true
}
func eggAccepted(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return eggParamContains([]string{"yes", "on", "1", "true"}, x)
	case int, int32, int64, float64, json.Number:
		return str(v) == "1"
	}
	return false
}
func eggDeclined(v any) bool {
	switch x := v.(type) {
	case bool:
		return !x
	case string:
		return eggParamContains([]string{"no", "off", "0", "false"}, x)
	case int, int32, int64, float64, json.Number:
		return str(v) == "0"
	}
	return false
}
func eggRational(v any) (*big.Rat, bool) {
	s := strings.TrimSpace(str(v))
	if len(s) > 8192 || !regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`).MatchString(s) {
		return nil, false
	}
	if at := strings.IndexAny(s, "eE"); at >= 0 {
		exponent, e := strconv.Atoi(s[at+1:])
		if e != nil || exponent > 4096 || exponent < -4096 {
			return nil, false
		}
	}
	return new(big.Rat).SetString(s)
}
func eggSizeRational(value any, rs []eggRule) *big.Rat {
	if eggHasRule(rs, "numeric") || eggHasRule(rs, "integer") || eggHasRule(rs, "decimal") {
		if n, ok := eggRational(value); ok {
			return n
		}
	}
	if values, _, ok := eggArray(value); ok {
		return new(big.Rat).SetInt64(int64(len(values)))
	}
	s := str(value)
	if b, ok := value.(bool); ok {
		if b {
			s = "1"
		} else {
			s = ""
		}
	}
	return new(big.Rat).SetInt64(int64(utf8.RuneCountInString(s)))
}
func eggLooseEqual(a, b any) bool {
	if reflect.DeepEqual(a, b) {
		return true
	}
	if av, ok := eggRational(a); ok {
		if bv, ok := eggRational(b); ok {
			return av.Cmp(bv) == 0
		}
	}
	if a == nil {
		return b == nil || str(b) == ""
	}
	if b == nil {
		return str(a) == ""
	}
	return str(a) == str(b)
}

func eggPHPScalarString(value any) string {
	if value == nil {
		return ""
	}
	if b, ok := value.(bool); ok {
		if b {
			return "1"
		}
		return ""
	}
	return str(value)
}

func eggPHPType(value any) string {
	if _, _, array := eggArray(value); array {
		return "array"
	}
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case string:
		return "string"
	case int, int32, int64, json.Number:
		return "integer"
	case float32, float64:
		return "double"
	}
	return "object"
}

func eggRuleDottedValues(env M) M {
	data := M{"environment": env}
	if request, ok := env["__egg_validation_data"].(map[string]any); ok {
		data = request
	}
	out := M{}
	var flatten func(any, string)
	flatten = func(value any, path string) {
		_, items, array := eggArray(value)
		if array && len(items) > 0 {
			for key, item := range items {
				next := key
				if path != "" {
					next = path + "." + key
				}
				flatten(item, next)
			}
			return
		}
		out[path] = value
	}
	flatten(data, "")
	return out
}
func eggDependentMatches(env M, p []string) bool {
	if len(p) < 2 {
		return false
	}
	other, _ := eggRuleOther(env, p[0])
	for _, candidate := range p[1:] {
		if other == nil {
			if candidate == "null" {
				return true
			}
			continue
		}
		if b, ok := other.(bool); ok {
			if candidate == "true" && b || candidate == "false" && !b {
				return true
			}
			continue
		}
		if eggLooseEqual(other, candidate) {
			return true
		}
	}
	return false
}
func eggControlRule(value any, present bool, r eggRule, env M) (handled, excluded, valid bool) {
	p := eggRuleParams(r.params)
	other := any(nil)
	hasOther := false
	if len(p) > 0 {
		other, hasOther = eggRuleOther(env, p[0])
	}
	match := eggDependentMatches(env, p)
	hasAny, hasAll, filledAny, filledAll := false, true, false, true
	for _, name := range p {
		v, has := eggRuleOther(env, name)
		hasAny = hasAny || has
		hasAll = hasAll && has
		filledAny = filledAny || !eggEmpty(v)
		filledAll = filledAll && !eggEmpty(v)
	}
	handled = true
	valid = true
	required := false
	presentRequired := false
	missingRequired := false
	prohibit := false
	switch r.name {
	case "exclude":
		excluded = true
	case "exclude_if":
		excluded = hasOther && match
	case "exclude_unless":
		excluded = !match
	case "exclude_with":
		excluded = hasOther
	case "exclude_without":
		excluded = eggEmpty(other)
	case "required":
		required = true
	case "filled":
		required = present
	case "required_if":
		required = hasOther && match
	case "required_unless":
		required = !match
	case "required_if_accepted":
		required = eggAccepted(other)
	case "required_if_declined":
		required = eggDeclined(other)
	case "required_with":
		required = filledAny
	case "required_with_all":
		required = filledAll
	case "required_without":
		required = !filledAll
	case "required_without_all":
		required = !filledAny
	case "present":
		presentRequired = true
	case "present_if":
		presentRequired = match
	case "present_unless":
		presentRequired = !match
	case "present_with":
		presentRequired = hasAny
	case "present_with_all":
		presentRequired = hasAll
	case "missing":
		missingRequired = true
	case "missing_if":
		missingRequired = match
	case "missing_unless":
		missingRequired = !match
	case "missing_with":
		missingRequired = hasAny
	case "missing_with_all":
		missingRequired = hasAll
	case "accepted":
		valid = present && eggAccepted(value)
	case "declined":
		valid = present && eggDeclined(value)
	case "accepted_if":
		valid = !match || present && eggAccepted(value)
	case "declined_if":
		valid = !match || present && eggDeclined(value)
	case "prohibited":
		prohibit = true
	case "prohibited_if":
		prohibit = match
	case "prohibited_unless":
		prohibit = !match
	case "prohibited_if_accepted":
		prohibit = eggAccepted(other)
	case "prohibited_if_declined":
		prohibit = eggDeclined(other)
	case "prohibits":
		valid = eggEmpty(value) || !filledAny
	default:
		handled = false
	}
	if required {
		valid = valid && present && !eggEmpty(value)
	}
	if presentRequired {
		valid = valid && present
	}
	if missingRequired {
		valid = valid && !present
	}
	if prohibit {
		valid = valid && eggEmpty(value)
	}
	return
}
func eggArray(v any) ([]any, map[string]any, bool) {
	switch x := v.(type) {
	case []any:
		m := M{}
		for i, v := range x {
			m[strconv.Itoa(i)] = v
		}
		return x, m, true
	case map[string]any:
		values := []any{}
		for _, v := range x {
			values = append(values, v)
		}
		return values, x, true
	}
	return nil, nil, false
}
func eggExtraScalarRule(value any, r eggRule, env M) (bool, error) {
	s := str(value)
	p := eggRuleParams(r.params)
	switch r.name {
	case "multiple_of":
		a, ok := eggRational(value)
		b, bok := eggRational(p[0])
		if !ok || !bok || b.Sign() == 0 {
			return false, nil
		}
		return new(big.Rat).Quo(a, b).IsInt(), nil
	case "hex_color":
		pattern, err := eggPattern(`/^#(?:(?:[0-9a-f]{3}){1,2}|(?:[0-9a-f]{4}){1,2})$/i`)
		if err != nil {
			return false, err
		}
		return pattern.MatchString(s)
	case "mac_address":
		return regexp.MustCompile(`(?i)^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$`).MatchString(s) || regexp.MustCompile(`(?i)^(?:[0-9a-f]{2}-){5}[0-9a-f]{2}$`).MatchString(s), nil
	case "ulid":
		_, ok := value.(string)
		return ok && regexp.MustCompile(`(?i)^[0-7][0-9a-hjkmnp-tv-z]{25}$`).MatchString(s), nil
	case "timezone":
		return eggTimezoneValid(s, p), nil
	case "encoding":
		return validateEggEncoding(value, p[0])
	case "file", "image", "mimes", "mimetypes", "extensions", "dimensions", "uploaded":
		return false, nil // Environment JSON cannot contain a Laravel UploadedFile instance.
	case "array", "list", "required_array_keys", "contains", "doesnt_contain", "in_array", "in_array_keys", "distinct":
		values, keys, isArray := eggArray(value)
		switch r.name {
		case "array":
			if !isArray {
				return false, nil
			}
			if r.params != "" {
				for key := range keys {
					if !eggParamContains(p, key) {
						return false, nil
					}
				}
			}
			return true, nil
		case "list":
			if !isArray {
				return false, nil
			}
			for i := 0; i < len(keys); i++ {
				if _, ok := keys[strconv.Itoa(i)]; !ok {
					return false, nil
				}
			}
			return true, nil
		case "required_array_keys":
			if !isArray {
				return false, nil
			}
			for _, key := range p {
				if _, ok := keys[key]; !ok {
					return false, nil
				}
			}
			return true, nil
		case "contains", "doesnt_contain":
			if !isArray {
				return false, nil
			}
			for _, target := range p {
				found := false
				for _, v := range values {
					found = found || eggLooseEqual(v, target)
				}
				if r.name == "contains" && !found || r.name == "doesnt_contain" && found {
					return false, nil
				}
			}
			return true, nil
		case "in_array":
			pattern := regexp.MustCompile("^" + strings.ReplaceAll(regexp.QuoteMeta(p[0]), `\*`, ".*") + "$")
			for key, v := range eggRuleDottedValues(env) {
				if pattern.MatchString(key) && eggLooseEqual(value, v) {
					return true, nil
				}
			}
			return false, nil
		case "in_array_keys":
			if !isArray {
				return false, nil
			}
			for _, key := range p {
				if _, ok := keys[key]; ok {
					return true, nil
				}
			}
			return false, nil
		case "distinct": // A scalar environment attribute has no wildcard siblings. Array values are compared as whole attributes in Laravel.
			return true, nil
		}
	}
	return false, bad("Unsupported rule evaluation: " + r.name)
}

type eggPresenceHook func(eggRule, any, M, string) (bool, error)

func (a *App) validateEggValue(ctx context.Context, value any, present bool, rules string, env M, attribute ...string) error {
	contextData := M{}
	for key, v := range env {
		contextData[key] = v
	}
	if rs, err := splitEggRules(rules); err == nil {
		for _, rule := range rs {
			if eggParamContains([]string{"date", "date_format", "date_equals", "after", "before", "after_or_equal", "before_or_equal"}, rule.name) {
				if _, exists := contextData["__egg_timezone"]; !exists {
					location, err := a.timezone(ctx)
					if err != nil {
						return err
					}
					contextData["__egg_timezone"] = location
				}
				break
			}
		}
	}
	contextData["__egg_presence_verifier"] = eggPresenceHook(func(rule eggRule, value any, data M, name string) (bool, error) {
		return a.eggDatabasePresence(ctx, rule, value, data, name)
	})
	return validateEggValue(value, present, rules, contextData, attribute...)
}
func eggRuleAttribute(env M, attribute []string) string {
	if len(attribute) > 0 {
		return attribute[0]
	}
	if _, request := env["__egg_validation_data"].(map[string]any); request {
		if name := str(env["__egg_variable"]); name != "" {
			return name
		}
		return "value"
	}
	return "environment.VALUE"
}
func eggPresenceTable(raw string) (string, error) {
	if strings.Contains(raw, ".") {
		parts := strings.SplitN(raw, ".", 2)
		if !eggParamContains([]string{"mysql", "pgsql", "postgres", "postgresql", "default"}, parts[0]) {
			return "", bad("Unknown database presence connection")
		}
		raw = parts[1]
	}
	models := map[string]string{"User": "users", "ApiKey": "api_keys", "UserSSHKey": "ssh_keys", "Node": "nodes", "Location": "locations", "Nest": "nests", "Egg": "eggs", "EggVariable": "egg_variables", "Server": "servers", "Allocation": "allocations", "ServerVariable": "server_variables", "Subuser": "subusers", "Backup": "backups", "Schedule": "schedules", "Task": "tasks", "DatabaseHost": "database_hosts", "Database": "databases", "Mount": "mounts", "ActivityLog": "activity_logs", "Setting": "settings", "ServerTransfer": "server_transfers"}
	if strings.HasPrefix(raw, `Pterodactyl\Models\`) {
		var ok bool
		raw, ok = models[strings.TrimPrefix(raw, `Pterodactyl\Models\`)]
		if !ok {
			return "", bad("Unknown model in database presence rule")
		}
	}
	aliases := map[string]string{"user_ssh_keys": "ssh_keys", "mount_node": "mount_nodes", "egg_mount": "mount_eggs", "mount_server": "mount_servers"}
	if alias, ok := aliases[raw]; ok {
		raw = alias
	}
	if !identifierRE.MatchString(raw) {
		return "", bad("Invalid database presence table")
	}
	return raw, nil
}
func eggPresenceColumn(table, column string) string {
	if table == "nodes" {
		switch column {
		case "daemonListen":
			return "daemon_listen"
		case "daemonSFTP":
			return "daemon_sftp"
		case "daemonBase":
			return "daemon_base"
		}
	}
	if table == "servers" && column == "uuidShort" {
		return "uuid_short"
	}
	return column
}
func eggPresenceBind(value any, kind string) (any, error) {
	if value == nil {
		return nil, nil
	}
	switch kind {
	case "text", "character varying", "character":
		return eggEnvironmentString(value), nil
	case "bigint", "integer", "smallint":
		if n, ok := eggRational(value); ok && n.IsInt() {
			if n.Num().IsInt64() {
				return n.Num().Int64(), nil
			}
		}
		return nil, bad("Database presence value is not an integer")
	case "boolean":
		if b, ok := value.(bool); ok {
			return b, nil
		}
		switch str(value) {
		case "1", "true":
			return true, nil
		case "0", "false":
			return false, nil
		}
		return nil, bad("Database presence value is not boolean")
	case "numeric", "double precision", "real":
		if n, ok := eggRational(value); ok {
			return n.FloatString(30), nil
		}
		return nil, bad("Database presence value is not numeric")
	case "json", "jsonb":
		encoded, err := json.Marshal(value)
		return json.RawMessage(encoded), err
	case "timestamp with time zone", "timestamp without time zone":
		return migrationValue(value, migrationColumn{Kind: kind, Nullable: true})
	}
	return value, nil
}
func eggPresenceFlatten(value any) any {
	for {
		if values, _, isArray := eggArray(value); isArray {
			if len(values) == 0 {
				return false
			}
			value = values[0]
			continue
		}
		return value
	}
}
func (a *App) eggDatabasePresence(ctx context.Context, rule eggRule, value any, env M, attribute string) (bool, error) {
	p := eggRuleParams(rule.params)
	if len(p) < 1 {
		return false, bad("Database presence rule requires a table")
	}
	values, _, isArray := eggArray(value)
	if rule.name == "exists" && isArray && len(values) == 0 {
		return true, nil
	}
	table, err := eggPresenceTable(p[0])
	if err != nil {
		return false, err
	}
	records, err := a.query(ctx, "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1", table)
	if err != nil {
		return false, bad("Cannot inspect database presence schema")
	}
	if len(records) == 0 {
		return false, bad("Database presence table does not exist")
	}
	type colInfo struct{ name, kind string }
	columns := map[string]colInfo{}
	for _, record := range records {
		columns[strings.ToLower(str(record["column_name"]))] = colInfo{str(record["column_name"]), str(record["data_type"])}
	}
	resolve := func(name string) (colInfo, error) {
		name = eggPresenceColumn(table, name)
		column, ok := columns[strings.ToLower(name)]
		if !ok {
			return colInfo{}, bad("Database presence column does not exist")
		}
		return column, nil
	}
	columnName := attribute
	if len(p) > 1 && p[1] != "NULL" {
		columnName = p[1]
	}
	column, err := resolve(columnName)
	if err != nil {
		return false, err
	}
	args := []any{}
	bind := func(v any, kind string) (string, error) {
		typed, err := eggPresenceBind(v, kind)
		if err != nil {
			return "", err
		}
		args = append(args, typed)
		return "$" + strconv.Itoa(len(args)), nil
	}
	quote := func(name string) string { return pgx.Identifier{name}.Sanitize() }
	conditions := []string{}
	expected := int64(1)
	selectCount := "count(*)"
	if rule.name == "exists" && isArray {
		distinct := map[string]bool{}
		holders := []string{}
		for _, v := range values {
			key := str(v)
			if b, ok := v.(bool); ok {
				if b {
					key = "1"
				} else {
					key = ""
				}
			}
			if v == nil {
				key = ""
			}
			distinct[key] = true
			placeholder, err := bind(v, column.kind)
			if err != nil {
				return false, nil
			}
			holders = append(holders, placeholder)
		}
		expected = int64(len(distinct))
		conditions = append(conditions, quote(column.name)+" IN ("+strings.Join(holders, ",")+")")
		selectCount = "count(DISTINCT " + quote(column.name) + ")"
	} else {
		if isArray {
			value = eggPresenceFlatten(value)
		}
		if value == nil {
			conditions = append(conditions, quote(column.name)+" IS NULL")
		} else {
			holder, err := bind(value, column.kind)
			if err != nil {
				return false, nil
			}
			conditions = append(conditions, quote(column.name)+"="+holder)
		}
	}
	extraStart := 2
	if rule.name == "unique" {
		extraStart = 4
		if len(p) > 2 {
			ignored := any(p[2])
			if match := regexp.MustCompile(`\[(.*)\]`).FindStringSubmatch(p[2]); len(match) > 1 {
				ignored, _ = eggRuleOther(env, match[1])
			}
			if ignored != nil && !strings.EqualFold(str(ignored), "null") {
				idName := "id"
				if len(p) > 3 {
					idName = p[3]
				}
				idColumn, err := resolve(idName)
				if err != nil {
					return false, err
				}
				holder, err := bind(ignored, idColumn.kind)
				if err != nil {
					return false, bad("Invalid ignored ID in unique validation rule")
				}
				conditions = append(conditions, quote(idColumn.name)+"<>"+holder)
			}
		}
	}
	extras := map[string]string{}
	extraOrder := []string{}
	for i := extraStart; i < len(p); i += 2 {
		if i+1 >= len(p) {
			return false, bad("Database presence extra conditions must be column/value pairs")
		}
		if _, exists := extras[p[i]]; !exists {
			extraOrder = append(extraOrder, p[i])
		}
		extras[p[i]] = p[i+1]
	}
	for _, name := range extraOrder {
		extra := extras[name]
		target, err := resolve(name)
		if err != nil {
			return false, err
		}
		switch extra {
		case "NULL":
			conditions = append(conditions, quote(target.name)+" IS NULL")
		case "NOT_NULL":
			conditions = append(conditions, quote(target.name)+" IS NOT NULL")
		default:
			operator := "="
			if strings.HasPrefix(extra, "!") {
				operator = "<>"
				extra = strings.TrimPrefix(extra, "!")
			}
			holder, err := bind(extra, target.kind)
			if err != nil {
				return false, nil
			}
			conditions = append(conditions, quote(target.name)+operator+holder)
		}
	}
	row, err := a.one(ctx, "SELECT "+selectCount+" AS count FROM "+quote(table)+" WHERE "+strings.Join(conditions, " AND "), args...)
	if err != nil {
		return false, bad("Database presence query failed")
	}
	if rule.name == "unique" {
		return num(row["count"]) == 0, nil
	}
	return num(row["count"]) >= expected, nil
}

type eggTimezoneEntry struct {
	All     bool   `json:"a"`
	Country string `json:"c"`
}

var eggTimezoneCatalog = func() map[string]eggTimezoneEntry {
	catalog := map[string]eggTimezoneEntry{}
	_ = json.Unmarshal([]byte(eggTimezoneData), &catalog)
	return catalog
}()

func eggTimezoneValid(name string, p []string) bool {
	entry, ok := eggTimezoneCatalog[name]
	if !ok {
		return false
	}
	kind := "ALL"
	if len(p) > 0 && p[0] != "" {
		kind = strings.ToUpper(p[0])
	}
	switch kind {
	case "ALL_WITH_BC":
		return true
	case "ALL":
		return entry.All
	case "PER_COUNTRY":
		return entry.All && len(p) > 1 && entry.Country == strings.ToUpper(p[1])
	case "UTC":
		return name == "UTC"
	}
	return entry.All && strings.ToUpper(strings.SplitN(name, "/", 2)[0]) == kind
}
func validateEggValue(value any, present bool, rules string, env M, attribute ...string) error {
	rs, err := splitEggRules(rules)
	if err != nil {
		return err
	}
	if err = validateEggRules(rules); err != nil {
		return err
	}
	s := str(value)
	for _, r := range rs {
		isExclude := strings.HasPrefix(r.name, "exclude")
		if !isExclude && eggHasRule(rs, "sometimes") && !present {
			continue
		}
		handled, excluded, controlValid := eggControlRule(value, present, r, env)
		if excluded {
			return nil
		}
		if handled {
			if !controlValid {
				return bad("does not satisfy " + r.name)
			}
			continue
		}
		if !present || (value == nil && eggHasRule(rs, "nullable")) {
			continue
		}
		if text, isString := value.(string); isString && strings.TrimSpace(text) == "" {
			continue
		}
		valid := true
		p := eggRuleParams(r.params)
		number := func(i int) float64 {
			if i >= len(p) {
				return 0
			}
			n, _ := strconv.ParseFloat(p[i], 64)
			return n
		}
		switch r.name {
		case "exists", "unique":
			hook, ok := env["__egg_presence_verifier"].(eggPresenceHook)
			if !ok {
				return bad("Database validation requires application context")
			}
			valid, err = hook(r, value, env, eggRuleAttribute(env, attribute))
			if err != nil {
				return err
			}
		case "multiple_of", "hex_color", "mac_address", "timezone", "ulid", "encoding", "array", "list", "required_array_keys", "contains", "doesnt_contain", "in_array", "in_array_keys", "distinct", "file", "image", "mimes", "mimetypes", "extensions", "dimensions", "uploaded":
			valid, err = eggExtraScalarRule(value, r, env)
			if err != nil {
				return err
			}
		case "string":
			_, valid = value.(string)
		case "integer", "int":
			valid = regexp.MustCompile(`^[+-]?(0|[1-9]\d*)$`).MatchString(strings.TrimSpace(s))
			if valid {
				_, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
				valid = err == nil
			}
			if r.params == "strict" {
				switch value.(type) {
				case int, int32, int64:
				default:
					valid = false
				}
			}
		case "numeric", "decimal":
			parsed, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
			valid = err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
			if r.params == "strict" {
				if _, ok := value.(string); ok {
					valid = false
				}
			}
			if valid && r.name == "decimal" {
				valid = regexp.MustCompile(`^[+-]?\d*\.?(\d*)$`).MatchString(s)
				fraction := 0
				if dot := strings.IndexByte(s, '.'); dot >= 0 {
					fraction = len(s) - dot - 1
				}
				valid = valid && float64(fraction) >= number(0)
				if len(p) > 1 {
					valid = valid && float64(fraction) <= number(1)
				} else {
					valid = valid && float64(fraction) == number(0)
				}
			}
		case "boolean":
			switch x := value.(type) {
			case bool:
				valid = true
			case string:
				valid = x == "0" || x == "1"
			case int, int32, int64, float64, json.Number:
				valid = s == "0" || s == "1"
			default:
				valid = false
			}
			if r.params == "strict" {
				_, valid = value.(bool)
			}
		case "alpha", "alpha_num", "alpha_dash":
			for _, c := range s {
				if r.params == "ascii" && c > 127 {
					valid = false
					break
				}
				if unicode.IsLetter(c) || unicode.IsMark(c) || (r.name != "alpha" && unicode.IsNumber(c)) || (r.name == "alpha_dash" && (c == '_' || c == '-')) {
					continue
				}
				valid = false
				break
			}
		case "ascii":
			for _, c := range s {
				if c > 127 {
					valid = false
				}
			}
		case "lowercase":
			_, valid = value.(string)
			valid = valid && s == strings.ToLower(s)
		case "uppercase":
			_, valid = value.(string)
			valid = valid && s == strings.ToUpper(s)
		case "in":
			valid = false
			if values, _, array := eggArray(value); array {
				valid = eggHasRule(rs, "array")
				for _, element := range values {
					if _, _, nested := eggArray(element); nested {
						valid = false
						break
					}
					if !eggParamContains(p, eggPHPScalarString(element)) {
						valid = false
						break
					}
				}
			} else {
				for _, x := range p {
					valid = valid || eggLooseEqual(eggPHPScalarString(value), x)
				}
			}
		case "not_in", "notin":
			valid = true
			for _, x := range p {
				if eggLooseEqual(value, x) {
					valid = false
				}
			}
		case "min", "max", "size", "between":
			bound, boundValid := eggRational(p[0])
			valid = boundValid
			if valid {
				cmp := eggSizeRational(value, rs).Cmp(bound)
				switch r.name {
				case "min":
					valid = cmp >= 0
				case "max":
					valid = cmp <= 0
				case "size":
					valid = cmp == 0
				case "between":
					upper, ok := eggRational(p[1])
					valid = ok && cmp >= 0
					if valid {
						valid = eggSizeRational(value, rs).Cmp(upper) <= 0
					}
				}
			}
		case "gt", "gte", "lt", "lte":
			otherValue, _ := eggRuleOther(env, r.params)
			left, leftNumeric := eggRational(value)
			right, parameterNumeric := eggRational(r.params)
			var comparison int
			if otherValue == nil && leftNumeric && parameterNumeric {
				comparison = left.Cmp(right)
			} else if parameterNumeric {
				valid = false
			} else {
				right, rightNumeric := eggRational(otherValue)
				if leftNumeric && rightNumeric {
					comparison = left.Cmp(right)
				} else if eggPHPType(value) != eggPHPType(otherValue) {
					valid = false
				} else {
					sizingRules := rs
					if leftNumeric {
						sizingRules = append(append([]eggRule{}, rs...), eggRule{name: "numeric"})
					}
					comparison = eggSizeRational(value, sizingRules).Cmp(eggSizeRational(otherValue, sizingRules))
				}
			}
			if valid {
				switch r.name {
				case "gt":
					valid = comparison > 0
				case "gte":
					valid = comparison >= 0
				case "lt":
					valid = comparison < 0
				case "lte":
					valid = comparison <= 0
				}
			}

		case "digits", "digits_between", "min_digits", "max_digits":
			valid = regexp.MustCompile(`^\d+$`).MatchString(s)
			count := float64(len(s))
			switch r.name {
			case "digits":
				valid = valid && count == number(0)
			case "digits_between":
				valid = valid && count >= number(0) && count <= number(1)
			case "min_digits":
				valid = valid && count >= number(0)
			case "max_digits":
				valid = valid && count <= number(0)
			}
		case "regex", "not_regex":
			re, e := eggPattern(r.params)
			if e != nil {
				return e
			}
			valid, e = re.MatchString(s)
			if e != nil {
				return bad("Regex evaluation exceeded limit")
			}
			if r.name == "not_regex" {
				valid = !valid
			}
		case "url", "active_url":
			u, e := url.Parse(s)
			_, isString := value.(string)
			valid = isString && e == nil && u.Host != ""
			if r.name == "url" {
				protocols := eggURLProtocols
				if r.params != "" {
					protocols = strings.Join(p, "|")
				}
				pattern, e := eggPattern(strings.ReplaceAll(eggURLPattern, "LARAVEL_PROTOCOLS", protocols))
				if e != nil {
					return e
				}
				valid, e = pattern.MatchString(s)
				if e != nil {
					return bad("URL evaluation exceeded limit")
				}
			}
			if valid && r.name == "active_url" {
				if net.ParseIP(u.Hostname()) != nil {
					valid = false
				} else {
					ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
					ips, err := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname()+".")
					cancel()
					valid = err == nil && len(ips) > 0
				}
			}
		case "email":
			valid, err = validateEggEmail(value, p)
			if err != nil {
				return err
			}
		case "ip", "ipv4", "ipv6":
			ip := net.ParseIP(s)
			valid = ip != nil
			if valid && r.name == "ipv4" {
				valid = ip.To4() != nil
			}
			if valid && r.name == "ipv6" {
				valid = ip.To4() == nil
			}
		case "json":
			valid = json.Valid([]byte(s))
		case "uuid":
			valid = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).MatchString(s)
			if valid && r.params != "" {
				switch r.params {
				case "0", "nil":
					valid = s == "00000000-0000-0000-0000-000000000000"
				case "max":
					valid = strings.ToLower(s) == "ffffffff-ffff-ffff-ffff-ffffffffffff"
				default:
					valid = len(r.params) == 1 && s[14:15] == r.params && strings.ContainsAny(s[19:20], "89aAbB")
				}
			}
		case "starts_with", "ends_with", "doesnt_start_with", "doesnt_end_with":
			match := false
			for _, v := range p {
				if strings.Contains(r.name, "start") {
					match = match || strings.HasPrefix(s, v)
				} else {
					match = match || strings.HasSuffix(s, v)
				}
			}
			valid = match
			if strings.HasPrefix(r.name, "doesnt_") {
				valid = !match
			}
		case "same":
			other, has := eggRuleOther(env, r.params)
			valid = has && reflect.DeepEqual(value, other)
		case "different":
			other, _ := eggRuleOther(env, r.params)
			valid = !reflect.DeepEqual(value, other)
		case "confirmed":
			key := r.params
			if key == "" {
				name := "environment.VALUE"
				if len(attribute) > 0 {
					name = attribute[0]
				} else if _, isRequest := env["__egg_validation_data"].(map[string]any); isRequest {
					name = str(env["__egg_variable"])
					if name == "" {
						name = "value"
					}
				} else if selected := str(env["__egg_variable"]); selected != "" {
					name = "environment." + selected
				}
				key = name + "_confirmation"
			}
			other, has := eggRuleOther(env, key)
			valid = has && reflect.DeepEqual(value, other)
		case "accepted":
			valid = eggParamContains([]string{"yes", "on", "1", "true"}, s)
		case "declined":
			valid = eggParamContains([]string{"no", "off", "0", "false"}, s)
		case "date", "date_format", "date_equals", "after", "after_or_equal", "before", "before_or_equal":
			valid, err = eggDateRule(value, r, rs, env)
			if err != nil {
				return err
			}

		}
		if !valid {
			return bad("does not satisfy " + r.name + func() string {
				if r.params != "" {
					return ":" + r.params
				}
				return ""
			}())
		}
	}
	return nil
}
func (a *App) validateEggEnvironment(ctx context.Context, eggID int64, environment M, userEditableOnly bool) (M, error) {
	vars, err := a.eggVariables(ctx, eggID)
	if err != nil {
		return nil, err
	}
	out := M{}
	for _, v := range vars {
		out[str(v["env_variable"])] = nil
	}
	for _, v := range vars {
		name := str(v["env_variable"])
		if value, ok := environment[name]; ok {
			if userEditableOnly && (!boolean(v["user_viewable"]) || !boolean(v["user_editable"])) {
				return nil, bad("Variable " + name + " is not user editable")
			}
			out[name] = value
		}
	}
	validationIndices := map[string]int{}
	dateFormats := M{}
	for i, v := range vars {
		validationIndices[str(v["env_variable"])] = i
		if rules, err := splitEggRules(str(v["rules"])); err == nil {
			for _, rule := range rules {
				if rule.name == "date_format" {
					dateFormats["environment."+str(v["env_variable"])] = eggRuleParams(rule.params)[0]
					break
				}
			}
		}
	}
	validationContext := M{}
	for key, value := range out {
		validationContext[key] = value
	}
	validationContext["__egg_date_formats"] = dateFormats
	for i, v := range vars {
		name := str(v["env_variable"])
		if validationIndices[name] != i {
			continue
		}
		rules := str(v["rules"])
		if err := a.validateEggValue(ctx, out[name], true, rules, validationContext, "environment."+name); err != nil {
			return nil, bad("Variable " + name + " " + err.Error())
		}
	}
	for name, value := range out {
		out[name] = eggEnvironmentString(value)
	}
	return out, nil
}
func eggEnvironmentString(v any) string {
	if b, ok := v.(bool); ok {
		if b {
			return "1"
		}
		return "0"
	}
	return str(v)
}

func eggLookup(m M, path string) any {
	var v any = m
	for _, part := range strings.Split(path, ".") {
		v = asMap(v)[part]
	}
	return v
}
func eggReplaceValue(v any, structure M) any {
	switch data := v.(type) {
	case string:
		legacy := map[string]string{"config.docker.interface": "config.docker.network.interface", "server.build.env.SERVER_MEMORY": "server.build.memory", "env.SERVER_MEMORY": "server.build.memory", "server.build.env.SERVER_IP": "server.build.default.ip", "env.SERVER_IP": "server.build.default.ip", "server.build.env.SERVER_PORT": "server.build.default.port", "env.SERVER_PORT": "server.build.default.port"}
		re := regexp.MustCompile(`\{\{([\w.-]*)\}\}`)
		return re.ReplaceAllStringFunc(data, func(token string) string {
			key := token[2 : len(token)-2]
			if replacement, ok := legacy[key]; ok {
				key = replacement
			}
			if strings.HasPrefix(key, "config.") {
				return "{{" + key + "}}"
			}
			if strings.HasPrefix(key, "server.") {
				return str(eggLookup(structure, strings.TrimPrefix(key, "server.")))
			}
			if strings.HasPrefix(key, "env.") {
				return str(eggLookup(structure, "build.env."+strings.TrimPrefix(key, "env.")))
			}
			return token
		})
	case M:
		out := M{}
		for k, x := range data {
			out[k] = eggReplaceValue(x, structure)
		}
		return out
	case []any:
		out := []any{}
		for _, x := range data {
			out = append(out, eggReplaceValue(x, structure))
		}
		return out
	}
	return v
}
func (a *App) eggDaemonConfiguration(ctx context.Context, server M, environment M) (M, error) {
	e, err := a.serverEffectiveEgg(ctx, server)
	if err != nil {
		return nil, err
	}
	allocation := M{}
	if id := num(server["allocation_id"]); id != 0 {
		allocation, err = a.one(ctx, "SELECT * FROM allocations WHERE id=$1", id)
		if err != nil {
			return nil, err
		}
	}
	allocations, err := a.query(ctx, "SELECT ip,port FROM allocations WHERE server_id=$1 ORDER BY id", server["id"])
	if err != nil {
		return nil, err
	}
	ports := M{}
	for _, v := range allocations {
		ip := str(v["ip"])
		ports[ip] = append(asSlice(ports[ip]), v["port"])
	}
	suspended := 0
	if str(server["status"]) == "suspended" {
		suspended = 1
	}
	structure := M{"uuid": server["uuid"], "build": M{"memory": server["memory"], "swap": server["swap"], "io": server["io"], "cpu": server["cpu"], "threads": server["threads"], "disk": server["disk"], "image": server["image"], "oom_disabled": server["oom_disabled"], "ports": ports, "env": environment, "default": M{"ip": allocation["ip"], "port": allocation["port"]}}, "service": M{"egg": e["uuid"], "skip_scripts": server["skip_scripts"]}, "rebuild": false, "suspended": suspended}
	return eggDaemonConfig(e, structure), nil
}
func eggDaemonConfig(e M, structure M) M {
	startup := asMap(e["config_startup"])
	done := startup["done"]
	if s, ok := done.(string); ok {
		done = []any{s}
	}
	stop := str(e["config_stop"])
	stopConfig := M{"type": "command", "value": stop}
	if strings.HasPrefix(stop, "^") {
		signal := strings.ToUpper(strings.TrimPrefix(stop, "^"))
		// Imported recipes also use terminal Ctrl-C notation. Wings expects
		// the actual signal name, otherwise Stop falls through to its timeout.
		if signal == "C" || signal == "^C" {
			signal = "SIGINT"
		}
		stopConfig = M{"type": "signal", "value": signal}
	}
	configs := []any{}
	files := asMap(e["config_files"])
	names := []string{}
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		data := asMap(files[name])
		if _, ok := data["find"]; !ok {
			continue
		}
		entry := M{}
		for k, v := range data {
			if k != "find" {
				entry[k] = v
			}
		}
		entry["file"] = name
		replacements := []any{}
		find := asMap(eggReplaceValue(data["find"], structure))
		keys := []string{}
		for k := range find {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, key := range keys {
			value := find[key]
			if conditions, isObject := value.(map[string]any); isObject {
				conditionKeys := []string{}
				for k := range conditions {
					conditionKeys = append(conditionKeys, k)
				}
				sort.Strings(conditionKeys)
				for _, condition := range conditionKeys {
					replacements = append(replacements, M{"match": key, "if_value": condition, "replace_with": conditions[condition]})
				}
			} else {
				replacements = append(replacements, M{"match": key, "replace_with": value})
			}
		}
		entry["replace"] = replacements
		configs = append(configs, entry)
	}
	return M{"startup": M{"done": done, "user_interaction": []any{}, "strip_ansi": boolean(startup["strip_ansi"])}, "stop": stopConfig, "configs": configs}
}

// Canonical timezone names and country assignments from the installed Laravel PHP runtime.
const eggTimezoneData = `{"Africa/Abidjan":{"a":true,"c":"CI"},"Africa/Accra":{"a":true,"c":"GH"},"Africa/Addis_Ababa":{"a":true,"c":"ET"},"Africa/Algiers":{"a":true,"c":"DZ"},"Africa/Asmara":{"a":true,"c":"ER"},"Africa/Bamako":{"a":true,"c":"ML"},"Africa/Bangui":{"a":true,"c":"CF"},"Africa/Banjul":{"a":true,"c":"GM"},"Africa/Bissau":{"a":true,"c":"GW"},"Africa/Blantyre":{"a":true,"c":"MW"},"Africa/Brazzaville":{"a":true,"c":"CG"},"Africa/Bujumbura":{"a":true,"c":"BI"},"Africa/Cairo":{"a":true,"c":"EG"},"Africa/Casablanca":{"a":true,"c":"MA"},"Africa/Ceuta":{"a":true,"c":"ES"},"Africa/Conakry":{"a":true,"c":"GN"},"Africa/Dakar":{"a":true,"c":"SN"},"Africa/Dar_es_Salaam":{"a":true,"c":"TZ"},"Africa/Djibouti":{"a":true,"c":"DJ"},"Africa/Douala":{"a":true,"c":"CM"},"Africa/El_Aaiun":{"a":true,"c":"EH"},"Africa/Freetown":{"a":true,"c":"SL"},"Africa/Gaborone":{"a":true,"c":"BW"},"Africa/Harare":{"a":true,"c":"ZW"},"Africa/Johannesburg":{"a":true,"c":"ZA"},"Africa/Juba":{"a":true,"c":"SS"},"Africa/Kampala":{"a":true,"c":"UG"},"Africa/Khartoum":{"a":true,"c":"SD"},"Africa/Kigali":{"a":true,"c":"RW"},"Africa/Kinshasa":{"a":true,"c":"CD"},"Africa/Lagos":{"a":true,"c":"NG"},"Africa/Libreville":{"a":true,"c":"GA"},"Africa/Lome":{"a":true,"c":"TG"},"Africa/Luanda":{"a":true,"c":"AO"},"Africa/Lubumbashi":{"a":true,"c":"CD"},"Africa/Lusaka":{"a":true,"c":"ZM"},"Africa/Malabo":{"a":true,"c":"GQ"},"Africa/Maputo":{"a":true,"c":"MZ"},"Africa/Maseru":{"a":true,"c":"LS"},"Africa/Mbabane":{"a":true,"c":"SZ"},"Africa/Mogadishu":{"a":true,"c":"SO"},"Africa/Monrovia":{"a":true,"c":"LR"},"Africa/Nairobi":{"a":true,"c":"KE"},"Africa/Ndjamena":{"a":true,"c":"TD"},"Africa/Niamey":{"a":true,"c":"NE"},"Africa/Nouakchott":{"a":true,"c":"MR"},"Africa/Ouagadougou":{"a":true,"c":"BF"},"Africa/Porto-Novo":{"a":true,"c":"BJ"},"Africa/Sao_Tome":{"a":true,"c":"ST"},"Africa/Timbuktu":{"a":false,"c":"??"},"Africa/Tripoli":{"a":true,"c":"LY"},"Africa/Tunis":{"a":true,"c":"TN"},"Africa/Windhoek":{"a":true,"c":"NA"},"America/Adak":{"a":true,"c":"US"},"America/Anchorage":{"a":true,"c":"US"},"America/Anguilla":{"a":true,"c":"AI"},"America/Antigua":{"a":true,"c":"AG"},"America/Araguaina":{"a":true,"c":"BR"},"America/Argentina/Buenos_Aires":{"a":true,"c":"AR"},"America/Argentina/Catamarca":{"a":true,"c":"AR"},"America/Argentina/Cordoba":{"a":true,"c":"AR"},"America/Argentina/Jujuy":{"a":true,"c":"AR"},"America/Argentina/La_Rioja":{"a":true,"c":"AR"},"America/Argentina/Mendoza":{"a":true,"c":"AR"},"America/Argentina/Rio_Gallegos":{"a":true,"c":"AR"},"America/Argentina/Salta":{"a":true,"c":"AR"},"America/Argentina/San_Juan":{"a":true,"c":"AR"},"America/Argentina/San_Luis":{"a":true,"c":"AR"},"America/Argentina/Tucuman":{"a":true,"c":"AR"},"America/Argentina/Ushuaia":{"a":true,"c":"AR"},"America/Aruba":{"a":true,"c":"AW"},"America/Asuncion":{"a":true,"c":"PY"},"America/Atikokan":{"a":true,"c":"CA"},"America/Atka":{"a":false,"c":"??"},"America/Bahia":{"a":true,"c":"BR"},"America/Bahia_Banderas":{"a":true,"c":"MX"},"America/Barbados":{"a":true,"c":"BB"},"America/Belem":{"a":true,"c":"BR"},"America/Belize":{"a":true,"c":"BZ"},"America/Blanc-Sablon":{"a":true,"c":"CA"},"America/Boa_Vista":{"a":true,"c":"BR"},"America/Bogota":{"a":true,"c":"CO"},"America/Boise":{"a":true,"c":"US"},"America/Cambridge_Bay":{"a":true,"c":"CA"},"America/Campo_Grande":{"a":true,"c":"BR"},"America/Cancun":{"a":true,"c":"MX"},"America/Caracas":{"a":true,"c":"VE"},"America/Cayenne":{"a":true,"c":"GF"},"America/Cayman":{"a":true,"c":"KY"},"America/Chicago":{"a":true,"c":"US"},"America/Chihuahua":{"a":true,"c":"MX"},"America/Ciudad_Juarez":{"a":true,"c":"MX"},"America/Coral_Harbour":{"a":false,"c":"??"},"America/Costa_Rica":{"a":true,"c":"CR"},"America/Coyhaique":{"a":true,"c":"CL"},"America/Creston":{"a":true,"c":"CA"},"America/Cuiaba":{"a":true,"c":"BR"},"America/Curacao":{"a":true,"c":"CW"},"America/Danmarkshavn":{"a":true,"c":"GL"},"America/Dawson":{"a":true,"c":"CA"},"America/Dawson_Creek":{"a":true,"c":"CA"},"America/Denver":{"a":true,"c":"US"},"America/Detroit":{"a":true,"c":"US"},"America/Dominica":{"a":true,"c":"DM"},"America/Edmonton":{"a":true,"c":"CA"},"America/Eirunepe":{"a":true,"c":"BR"},"America/El_Salvador":{"a":true,"c":"SV"},"America/Ensenada":{"a":false,"c":"??"},"America/Fort_Nelson":{"a":true,"c":"CA"},"America/Fortaleza":{"a":true,"c":"BR"},"America/Glace_Bay":{"a":true,"c":"CA"},"America/Goose_Bay":{"a":true,"c":"CA"},"America/Grand_Turk":{"a":true,"c":"TC"},"America/Grenada":{"a":true,"c":"GD"},"America/Guadeloupe":{"a":true,"c":"GP"},"America/Guatemala":{"a":true,"c":"GT"},"America/Guayaquil":{"a":true,"c":"EC"},"America/Guyana":{"a":true,"c":"GY"},"America/Halifax":{"a":true,"c":"CA"},"America/Havana":{"a":true,"c":"CU"},"America/Hermosillo":{"a":true,"c":"MX"},"America/Indiana/Indianapolis":{"a":true,"c":"US"},"America/Indiana/Knox":{"a":true,"c":"US"},"America/Indiana/Marengo":{"a":true,"c":"US"},"America/Indiana/Petersburg":{"a":true,"c":"US"},"America/Indiana/Tell_City":{"a":true,"c":"US"},"America/Indiana/Vevay":{"a":true,"c":"US"},"America/Indiana/Vincennes":{"a":true,"c":"US"},"America/Indiana/Winamac":{"a":true,"c":"US"},"America/Inuvik":{"a":true,"c":"CA"},"America/Iqaluit":{"a":true,"c":"CA"},"America/Jamaica":{"a":true,"c":"JM"},"America/Juneau":{"a":true,"c":"US"},"America/Kentucky/Louisville":{"a":true,"c":"US"},"America/Kentucky/Monticello":{"a":true,"c":"US"},"America/Kralendijk":{"a":true,"c":"BQ"},"America/La_Paz":{"a":true,"c":"BO"},"America/Lima":{"a":true,"c":"PE"},"America/Los_Angeles":{"a":true,"c":"US"},"America/Lower_Princes":{"a":true,"c":"SX"},"America/Maceio":{"a":true,"c":"BR"},"America/Managua":{"a":true,"c":"NI"},"America/Manaus":{"a":true,"c":"BR"},"America/Marigot":{"a":true,"c":"MF"},"America/Martinique":{"a":true,"c":"MQ"},"America/Matamoros":{"a":true,"c":"MX"},"America/Mazatlan":{"a":true,"c":"MX"},"America/Menominee":{"a":true,"c":"US"},"America/Merida":{"a":true,"c":"MX"},"America/Metlakatla":{"a":true,"c":"US"},"America/Mexico_City":{"a":true,"c":"MX"},"America/Miquelon":{"a":true,"c":"PM"},"America/Moncton":{"a":true,"c":"CA"},"America/Monterrey":{"a":true,"c":"MX"},"America/Montevideo":{"a":true,"c":"UY"},"America/Montreal":{"a":false,"c":"??"},"America/Montserrat":{"a":true,"c":"MS"},"America/Nassau":{"a":true,"c":"BS"},"America/New_York":{"a":true,"c":"US"},"America/Nipigon":{"a":false,"c":"??"},"America/Nome":{"a":true,"c":"US"},"America/Noronha":{"a":true,"c":"BR"},"America/North_Dakota/Beulah":{"a":true,"c":"US"},"America/North_Dakota/Center":{"a":true,"c":"US"},"America/North_Dakota/New_Salem":{"a":true,"c":"US"},"America/Nuuk":{"a":true,"c":"GL"},"America/Ojinaga":{"a":true,"c":"MX"},"America/Panama":{"a":true,"c":"PA"},"America/Pangnirtung":{"a":false,"c":"??"},"America/Paramaribo":{"a":true,"c":"SR"},"America/Phoenix":{"a":true,"c":"US"},"America/Port-au-Prince":{"a":true,"c":"HT"},"America/Port_of_Spain":{"a":true,"c":"TT"},"America/Porto_Acre":{"a":false,"c":"??"},"America/Porto_Velho":{"a":true,"c":"BR"},"America/Puerto_Rico":{"a":true,"c":"PR"},"America/Punta_Arenas":{"a":true,"c":"CL"},"America/Rainy_River":{"a":false,"c":"??"},"America/Rankin_Inlet":{"a":true,"c":"CA"},"America/Recife":{"a":true,"c":"BR"},"America/Regina":{"a":true,"c":"CA"},"America/Resolute":{"a":true,"c":"CA"},"America/Rio_Branco":{"a":true,"c":"BR"},"America/Santa_Isabel":{"a":false,"c":"??"},"America/Santarem":{"a":true,"c":"BR"},"America/Santiago":{"a":true,"c":"CL"},"America/Santo_Domingo":{"a":true,"c":"DO"},"America/Sao_Paulo":{"a":true,"c":"BR"},"America/Scoresbysund":{"a":true,"c":"GL"},"America/Shiprock":{"a":false,"c":"??"},"America/Sitka":{"a":true,"c":"US"},"America/St_Barthelemy":{"a":true,"c":"BL"},"America/St_Johns":{"a":true,"c":"CA"},"America/St_Kitts":{"a":true,"c":"KN"},"America/St_Lucia":{"a":true,"c":"LC"},"America/St_Thomas":{"a":true,"c":"VI"},"America/St_Vincent":{"a":true,"c":"VC"},"America/Swift_Current":{"a":true,"c":"CA"},"America/Tegucigalpa":{"a":true,"c":"HN"},"America/Thule":{"a":true,"c":"GL"},"America/Thunder_Bay":{"a":false,"c":"??"},"America/Tijuana":{"a":true,"c":"MX"},"America/Toronto":{"a":true,"c":"CA"},"America/Tortola":{"a":true,"c":"VG"},"America/Vancouver":{"a":true,"c":"CA"},"America/Virgin":{"a":false,"c":"??"},"America/Whitehorse":{"a":true,"c":"CA"},"America/Winnipeg":{"a":true,"c":"CA"},"America/Yakutat":{"a":true,"c":"US"},"America/Yellowknife":{"a":false,"c":"??"},"Antarctica/Casey":{"a":true,"c":"AQ"},"Antarctica/Davis":{"a":true,"c":"AQ"},"Antarctica/DumontDUrville":{"a":true,"c":"AQ"},"Antarctica/Macquarie":{"a":true,"c":"AU"},"Antarctica/Mawson":{"a":true,"c":"AQ"},"Antarctica/McMurdo":{"a":true,"c":"AQ"},"Antarctica/Palmer":{"a":true,"c":"AQ"},"Antarctica/Rothera":{"a":true,"c":"AQ"},"Antarctica/Syowa":{"a":true,"c":"AQ"},"Antarctica/Troll":{"a":true,"c":"AQ"},"Antarctica/Vostok":{"a":true,"c":"AQ"},"Arctic/Longyearbyen":{"a":true,"c":"SJ"},"Asia/Aden":{"a":true,"c":"YE"},"Asia/Almaty":{"a":true,"c":"KZ"},"Asia/Amman":{"a":true,"c":"JO"},"Asia/Anadyr":{"a":true,"c":"RU"},"Asia/Aqtau":{"a":true,"c":"KZ"},"Asia/Aqtobe":{"a":true,"c":"KZ"},"Asia/Ashgabat":{"a":true,"c":"TM"},"Asia/Atyrau":{"a":true,"c":"KZ"},"Asia/Baghdad":{"a":true,"c":"IQ"},"Asia/Bahrain":{"a":true,"c":"BH"},"Asia/Baku":{"a":true,"c":"AZ"},"Asia/Bangkok":{"a":true,"c":"TH"},"Asia/Barnaul":{"a":true,"c":"RU"},"Asia/Beirut":{"a":true,"c":"LB"},"Asia/Bishkek":{"a":true,"c":"KG"},"Asia/Brunei":{"a":true,"c":"BN"},"Asia/Chita":{"a":true,"c":"RU"},"Asia/Chongqing":{"a":false,"c":"??"},"Asia/Colombo":{"a":true,"c":"LK"},"Asia/Damascus":{"a":true,"c":"SY"},"Asia/Dhaka":{"a":true,"c":"BD"},"Asia/Dili":{"a":true,"c":"TL"},"Asia/Dubai":{"a":true,"c":"AE"},"Asia/Dushanbe":{"a":true,"c":"TJ"},"Asia/Famagusta":{"a":true,"c":"CY"},"Asia/Gaza":{"a":true,"c":"PS"},"Asia/Harbin":{"a":false,"c":"??"},"Asia/Hebron":{"a":true,"c":"PS"},"Asia/Ho_Chi_Minh":{"a":true,"c":"VN"},"Asia/Hong_Kong":{"a":true,"c":"HK"},"Asia/Hovd":{"a":true,"c":"MN"},"Asia/Irkutsk":{"a":true,"c":"RU"},"Asia/Istanbul":{"a":false,"c":"??"},"Asia/Jakarta":{"a":true,"c":"ID"},"Asia/Jayapura":{"a":true,"c":"ID"},"Asia/Jerusalem":{"a":true,"c":"IL"},"Asia/Kabul":{"a":true,"c":"AF"},"Asia/Kamchatka":{"a":true,"c":"RU"},"Asia/Karachi":{"a":true,"c":"PK"},"Asia/Kashgar":{"a":false,"c":"??"},"Asia/Kathmandu":{"a":true,"c":"NP"},"Asia/Khandyga":{"a":true,"c":"RU"},"Asia/Kolkata":{"a":true,"c":"IN"},"Asia/Krasnoyarsk":{"a":true,"c":"RU"},"Asia/Kuala_Lumpur":{"a":true,"c":"MY"},"Asia/Kuching":{"a":true,"c":"MY"},"Asia/Kuwait":{"a":true,"c":"KW"},"Asia/Macau":{"a":true,"c":"MO"},"Asia/Magadan":{"a":true,"c":"RU"},"Asia/Makassar":{"a":true,"c":"ID"},"Asia/Manila":{"a":true,"c":"PH"},"Asia/Muscat":{"a":true,"c":"OM"},"Asia/Nicosia":{"a":true,"c":"CY"},"Asia/Novokuznetsk":{"a":true,"c":"RU"},"Asia/Novosibirsk":{"a":true,"c":"RU"},"Asia/Omsk":{"a":true,"c":"RU"},"Asia/Oral":{"a":true,"c":"KZ"},"Asia/Phnom_Penh":{"a":true,"c":"KH"},"Asia/Pontianak":{"a":true,"c":"ID"},"Asia/Pyongyang":{"a":true,"c":"KP"},"Asia/Qatar":{"a":true,"c":"QA"},"Asia/Qostanay":{"a":true,"c":"KZ"},"Asia/Qyzylorda":{"a":true,"c":"KZ"},"Asia/Riyadh":{"a":true,"c":"SA"},"Asia/Sakhalin":{"a":true,"c":"RU"},"Asia/Samarkand":{"a":true,"c":"UZ"},"Asia/Seoul":{"a":true,"c":"KR"},"Asia/Shanghai":{"a":true,"c":"CN"},"Asia/Singapore":{"a":true,"c":"SG"},"Asia/Srednekolymsk":{"a":true,"c":"RU"},"Asia/Taipei":{"a":true,"c":"TW"},"Asia/Tashkent":{"a":true,"c":"UZ"},"Asia/Tbilisi":{"a":true,"c":"GE"},"Asia/Tehran":{"a":true,"c":"IR"},"Asia/Tel_Aviv":{"a":false,"c":"??"},"Asia/Thimphu":{"a":true,"c":"BT"},"Asia/Tokyo":{"a":true,"c":"JP"},"Asia/Tomsk":{"a":true,"c":"RU"},"Asia/Ulaanbaatar":{"a":true,"c":"MN"},"Asia/Urumqi":{"a":true,"c":"CN"},"Asia/Ust-Nera":{"a":true,"c":"RU"},"Asia/Vientiane":{"a":true,"c":"LA"},"Asia/Vladivostok":{"a":true,"c":"RU"},"Asia/Yakutsk":{"a":true,"c":"RU"},"Asia/Yangon":{"a":true,"c":"MM"},"Asia/Yekaterinburg":{"a":true,"c":"RU"},"Asia/Yerevan":{"a":true,"c":"AM"},"Atlantic/Azores":{"a":true,"c":"PT"},"Atlantic/Bermuda":{"a":true,"c":"BM"},"Atlantic/Canary":{"a":true,"c":"ES"},"Atlantic/Cape_Verde":{"a":true,"c":"CV"},"Atlantic/Faroe":{"a":true,"c":"FO"},"Atlantic/Jan_Mayen":{"a":false,"c":"??"},"Atlantic/Madeira":{"a":true,"c":"PT"},"Atlantic/Reykjavik":{"a":true,"c":"IS"},"Atlantic/South_Georgia":{"a":true,"c":"GS"},"Atlantic/St_Helena":{"a":true,"c":"SH"},"Atlantic/Stanley":{"a":true,"c":"FK"},"Australia/Adelaide":{"a":true,"c":"AU"},"Australia/Brisbane":{"a":true,"c":"AU"},"Australia/Broken_Hill":{"a":true,"c":"AU"},"Australia/Canberra":{"a":false,"c":"??"},"Australia/Currie":{"a":false,"c":"??"},"Australia/Darwin":{"a":true,"c":"AU"},"Australia/Eucla":{"a":true,"c":"AU"},"Australia/Hobart":{"a":true,"c":"AU"},"Australia/Lindeman":{"a":true,"c":"AU"},"Australia/Lord_Howe":{"a":true,"c":"AU"},"Australia/Melbourne":{"a":true,"c":"AU"},"Australia/Perth":{"a":true,"c":"AU"},"Australia/Sydney":{"a":true,"c":"AU"},"Australia/Yancowinna":{"a":false,"c":"??"},"Etc/GMT":{"a":false,"c":"??"},"Etc/GMT+0":{"a":false,"c":"??"},"Etc/GMT+1":{"a":false,"c":"??"},"Etc/GMT+10":{"a":false,"c":"??"},"Etc/GMT+11":{"a":false,"c":"??"},"Etc/GMT+12":{"a":false,"c":"??"},"Etc/GMT+2":{"a":false,"c":"??"},"Etc/GMT+3":{"a":false,"c":"??"},"Etc/GMT+4":{"a":false,"c":"??"},"Etc/GMT+5":{"a":false,"c":"??"},"Etc/GMT+6":{"a":false,"c":"??"},"Etc/GMT+7":{"a":false,"c":"??"},"Etc/GMT+8":{"a":false,"c":"??"},"Etc/GMT+9":{"a":false,"c":"??"},"Etc/GMT-0":{"a":false,"c":"??"},"Etc/GMT-1":{"a":false,"c":"??"},"Etc/GMT-10":{"a":false,"c":"??"},"Etc/GMT-11":{"a":false,"c":"??"},"Etc/GMT-12":{"a":false,"c":"??"},"Etc/GMT-13":{"a":false,"c":"??"},"Etc/GMT-14":{"a":false,"c":"??"},"Etc/GMT-2":{"a":false,"c":"??"},"Etc/GMT-3":{"a":false,"c":"??"},"Etc/GMT-4":{"a":false,"c":"??"},"Etc/GMT-5":{"a":false,"c":"??"},"Etc/GMT-6":{"a":false,"c":"??"},"Etc/GMT-7":{"a":false,"c":"??"},"Etc/GMT-8":{"a":false,"c":"??"},"Etc/GMT-9":{"a":false,"c":"??"},"Etc/GMT0":{"a":false,"c":"??"},"Etc/Greenwich":{"a":false,"c":"??"},"Etc/UCT":{"a":false,"c":"??"},"Etc/Universal":{"a":false,"c":"??"},"Etc/UTC":{"a":false,"c":"??"},"Etc/Zulu":{"a":false,"c":"??"},"Europe/Amsterdam":{"a":true,"c":"NL"},"Europe/Andorra":{"a":true,"c":"AD"},"Europe/Astrakhan":{"a":true,"c":"RU"},"Europe/Athens":{"a":true,"c":"GR"},"Europe/Belfast":{"a":false,"c":"??"},"Europe/Belgrade":{"a":true,"c":"RS"},"Europe/Berlin":{"a":true,"c":"DE"},"Europe/Bratislava":{"a":true,"c":"SK"},"Europe/Brussels":{"a":true,"c":"BE"},"Europe/Bucharest":{"a":true,"c":"RO"},"Europe/Budapest":{"a":true,"c":"HU"},"Europe/Busingen":{"a":true,"c":"DE"},"Europe/Chisinau":{"a":true,"c":"MD"},"Europe/Copenhagen":{"a":true,"c":"DK"},"Europe/Dublin":{"a":true,"c":"IE"},"Europe/Gibraltar":{"a":true,"c":"GI"},"Europe/Guernsey":{"a":true,"c":"GG"},"Europe/Helsinki":{"a":true,"c":"FI"},"Europe/Isle_of_Man":{"a":true,"c":"IM"},"Europe/Istanbul":{"a":true,"c":"TR"},"Europe/Jersey":{"a":true,"c":"JE"},"Europe/Kaliningrad":{"a":true,"c":"RU"},"Europe/Kirov":{"a":true,"c":"RU"},"Europe/Kyiv":{"a":true,"c":"UA"},"Europe/Lisbon":{"a":true,"c":"PT"},"Europe/Ljubljana":{"a":true,"c":"SI"},"Europe/London":{"a":true,"c":"GB"},"Europe/Luxembourg":{"a":true,"c":"LU"},"Europe/Madrid":{"a":true,"c":"ES"},"Europe/Malta":{"a":true,"c":"MT"},"Europe/Mariehamn":{"a":true,"c":"AX"},"Europe/Minsk":{"a":true,"c":"BY"},"Europe/Monaco":{"a":true,"c":"MC"},"Europe/Moscow":{"a":true,"c":"RU"},"Europe/Nicosia":{"a":false,"c":"??"},"Europe/Oslo":{"a":true,"c":"NO"},"Europe/Paris":{"a":true,"c":"FR"},"Europe/Podgorica":{"a":true,"c":"ME"},"Europe/Prague":{"a":true,"c":"CZ"},"Europe/Riga":{"a":true,"c":"LV"},"Europe/Rome":{"a":true,"c":"IT"},"Europe/Samara":{"a":true,"c":"RU"},"Europe/San_Marino":{"a":true,"c":"SM"},"Europe/Sarajevo":{"a":true,"c":"BA"},"Europe/Saratov":{"a":true,"c":"RU"},"Europe/Simferopol":{"a":true,"c":"UA"},"Europe/Skopje":{"a":true,"c":"MK"},"Europe/Sofia":{"a":true,"c":"BG"},"Europe/Stockholm":{"a":true,"c":"SE"},"Europe/Tallinn":{"a":true,"c":"EE"},"Europe/Tirane":{"a":true,"c":"AL"},"Europe/Tiraspol":{"a":false,"c":"??"},"Europe/Ulyanovsk":{"a":true,"c":"RU"},"Europe/Vaduz":{"a":true,"c":"LI"},"Europe/Vatican":{"a":true,"c":"VA"},"Europe/Vienna":{"a":true,"c":"AT"},"Europe/Vilnius":{"a":true,"c":"LT"},"Europe/Volgograd":{"a":true,"c":"RU"},"Europe/Warsaw":{"a":true,"c":"PL"},"Europe/Zagreb":{"a":true,"c":"HR"},"Europe/Zurich":{"a":true,"c":"CH"},"Factory":{"a":false,"c":"??"},"GMT":{"a":false,"c":""},"Indian/Antananarivo":{"a":true,"c":"MG"},"Indian/Chagos":{"a":true,"c":"IO"},"Indian/Christmas":{"a":true,"c":"CX"},"Indian/Cocos":{"a":true,"c":"CC"},"Indian/Comoro":{"a":true,"c":"KM"},"Indian/Kerguelen":{"a":true,"c":"TF"},"Indian/Mahe":{"a":true,"c":"SC"},"Indian/Maldives":{"a":true,"c":"MV"},"Indian/Mauritius":{"a":true,"c":"MU"},"Indian/Mayotte":{"a":true,"c":"YT"},"Indian/Reunion":{"a":true,"c":"RE"},"localtime":{"a":false,"c":"??"},"Pacific/Apia":{"a":true,"c":"WS"},"Pacific/Auckland":{"a":true,"c":"NZ"},"Pacific/Bougainville":{"a":true,"c":"PG"},"Pacific/Chatham":{"a":true,"c":"NZ"},"Pacific/Chuuk":{"a":true,"c":"FM"},"Pacific/Easter":{"a":true,"c":"CL"},"Pacific/Efate":{"a":true,"c":"VU"},"Pacific/Fakaofo":{"a":true,"c":"TK"},"Pacific/Fiji":{"a":true,"c":"FJ"},"Pacific/Funafuti":{"a":true,"c":"TV"},"Pacific/Galapagos":{"a":true,"c":"EC"},"Pacific/Gambier":{"a":true,"c":"PF"},"Pacific/Guadalcanal":{"a":true,"c":"SB"},"Pacific/Guam":{"a":true,"c":"GU"},"Pacific/Honolulu":{"a":true,"c":"US"},"Pacific/Johnston":{"a":false,"c":"??"},"Pacific/Kanton":{"a":true,"c":"KI"},"Pacific/Kiritimati":{"a":true,"c":"KI"},"Pacific/Kosrae":{"a":true,"c":"FM"},"Pacific/Kwajalein":{"a":true,"c":"MH"},"Pacific/Majuro":{"a":true,"c":"MH"},"Pacific/Marquesas":{"a":true,"c":"PF"},"Pacific/Midway":{"a":true,"c":"UM"},"Pacific/Nauru":{"a":true,"c":"NR"},"Pacific/Niue":{"a":true,"c":"NU"},"Pacific/Norfolk":{"a":true,"c":"NF"},"Pacific/Noumea":{"a":true,"c":"NC"},"Pacific/Pago_Pago":{"a":true,"c":"AS"},"Pacific/Palau":{"a":true,"c":"PW"},"Pacific/Pitcairn":{"a":true,"c":"PN"},"Pacific/Pohnpei":{"a":true,"c":"FM"},"Pacific/Port_Moresby":{"a":true,"c":"PG"},"Pacific/Rarotonga":{"a":true,"c":"CK"},"Pacific/Saipan":{"a":true,"c":"MP"},"Pacific/Samoa":{"a":false,"c":"??"},"Pacific/Tahiti":{"a":true,"c":"PF"},"Pacific/Tarawa":{"a":true,"c":"KI"},"Pacific/Tongatapu":{"a":true,"c":"TO"},"Pacific/Wake":{"a":true,"c":"UM"},"Pacific/Wallis":{"a":true,"c":"WF"},"Pacific/Yap":{"a":false,"c":"??"},"UTC":{"a":true,"c":"??"}}`

// URL grammar from Illuminate\Support\Str (MIT), derived from Symfony UrlValidator.
const eggURLProtocols = `aaa|aaas|about|acap|acct|acd|acr|adiumxtra|adt|afp|afs|aim|amss|android|appdata|apt|ark|attachment|aw|barion|beshare|bitcoin|bitcoincash|blob|bolo|browserext|calculator|callto|cap|cast|casts|chrome|chrome-extension|cid|coap|coap\+tcp|coap\+ws|coaps|coaps\+tcp|coaps\+ws|com-eventbrite-attendee|content|conti|crid|cvs|dab|data|dav|diaspora|dict|did|dis|dlna-playcontainer|dlna-playsingle|dns|dntp|dpp|drm|drop|dtn|dvb|ed2k|elsi|example|facetime|fax|feed|feedready|file|filesystem|finger|first-run-pen-experience|fish|fm|ftp|fuchsia-pkg|geo|gg|git|gizmoproject|go|gopher|graph|gtalk|h323|ham|hcap|hcp|http|https|hxxp|hxxps|hydrazone|iax|icap|icon|im|imap|info|iotdisco|ipn|ipp|ipps|irc|irc6|ircs|iris|iris\.beep|iris\.lwz|iris\.xpc|iris\.xpcs|isostore|itms|jabber|jar|jms|keyparc|lastfm|ldap|ldaps|leaptofrogans|lorawan|lvlt|magnet|mailserver|mailto|maps|market|message|mid|mms|modem|mongodb|moz|ms-access|ms-browser-extension|ms-calculator|ms-drive-to|ms-enrollment|ms-excel|ms-eyecontrolspeech|ms-gamebarservices|ms-gamingoverlay|ms-getoffice|ms-help|ms-infopath|ms-inputapp|ms-lockscreencomponent-config|ms-media-stream-id|ms-mixedrealitycapture|ms-mobileplans|ms-officeapp|ms-people|ms-project|ms-powerpoint|ms-publisher|ms-restoretabcompanion|ms-screenclip|ms-screensketch|ms-search|ms-search-repair|ms-secondary-screen-controller|ms-secondary-screen-setup|ms-settings|ms-settings-airplanemode|ms-settings-bluetooth|ms-settings-camera|ms-settings-cellular|ms-settings-cloudstorage|ms-settings-connectabledevices|ms-settings-displays-topology|ms-settings-emailandaccounts|ms-settings-language|ms-settings-location|ms-settings-lock|ms-settings-nfctransactions|ms-settings-notifications|ms-settings-power|ms-settings-privacy|ms-settings-proximity|ms-settings-screenrotation|ms-settings-wifi|ms-settings-workplace|ms-spd|ms-sttoverlay|ms-transit-to|ms-useractivityset|ms-virtualtouchpad|ms-visio|ms-walk-to|ms-whiteboard|ms-whiteboard-cmd|ms-word|msnim|msrp|msrps|mss|mtqp|mumble|mupdate|mvn|news|nfs|ni|nih|nntp|notes|ocf|oid|onenote|onenote-cmd|opaquelocktoken|openpgp4fpr|pack|palm|paparazzi|payto|pkcs11|platform|pop|pres|prospero|proxy|pwid|psyc|pttp|qb|query|redis|rediss|reload|res|resource|rmi|rsync|rtmfp|rtmp|rtsp|rtsps|rtspu|s3|secondlife|service|session|sftp|sgn|shttp|sieve|simpleledger|sip|sips|skype|smb|sms|smtp|snews|snmp|soap\.beep|soap\.beeps|soldat|spiffe|spotify|ssh|steam|stun|stuns|submit|svn|tag|teamspeak|tel|teliaeid|telnet|tftp|tg|things|thismessage|tip|tn3270|tool|ts3server|turn|turns|tv|udp|unreal|urn|ut2004|v-event|vemmi|ventrilo|videotex|vnc|view-source|wais|webcal|wpid|ws|wss|wtai|wyciwyg|xcon|xcon-userid|xfire|xmlrpc\.beep|xmlrpc\.beeps|xmpp|xri|ymsgr|z39\.50|z39\.50r|z39\.50s`
const eggURLPattern = `~^
            (LARAVEL_PROTOCOLS)://                                 # protocol
            (((?:[\_\.\pL\pN-]|%[0-9A-Fa-f]{2})+:)?((?:[\_\.\pL\pN-]|%[0-9A-Fa-f]{2})+)@)?  # basic auth
            (
                (?:
                    (?:
                        (?:[\pL\pN\pS\pM\-\_]++\.)+
                        (?:
                            (?:xn--[a-z0-9-]++)     # punycode in tld
                            |
                            (?:[\pL\pN\pM]++)       # no punycode in tld
                        )
                    )                               # a multi-level domain name
                        |
                    [a-z0-9\-\_]++                  # a single-level domain name
                )\.?
                    |                               # or
                \d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}  # an IP address
                    |                               # or
                \[
                    (?:(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){6})(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:::(?:(?:(?:[0-9a-f]{1,4})):){5})(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:(?:(?:(?:[0-9a-f]{1,4})))?::(?:(?:(?:[0-9a-f]{1,4})):){4})(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){0,1}(?:(?:[0-9a-f]{1,4})))?::(?:(?:(?:[0-9a-f]{1,4})):){3})(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){0,2}(?:(?:[0-9a-f]{1,4})))?::(?:(?:(?:[0-9a-f]{1,4})):){2})(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){0,3}(?:(?:[0-9a-f]{1,4})))?::(?:(?:[0-9a-f]{1,4})):)(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){0,4}(?:(?:[0-9a-f]{1,4})))?::)(?:(?:(?:(?:(?:[0-9a-f]{1,4})):(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9]))\.){3}(?:(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])))))))|(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){0,5}(?:(?:[0-9a-f]{1,4})))?::)(?:(?:[0-9a-f]{1,4})))|(?:(?:(?:(?:(?:(?:[0-9a-f]{1,4})):){0,6}(?:(?:[0-9a-f]{1,4})))?::))))
                \]  # an IPv6 address
            )
            (:[0-9]+)?                              # a port (optional)
            (?:/ (?:[\pL\pN\-._\~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})* )*          # a path
            (?:\? (?:[\pL\pN\-._\~!$&'\[\]()*+,;=:@/?]|%[0-9A-Fa-f]{2})* )?   # a query (optional)
            (?:\# (?:[\pL\pN\-._\~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2})* )?       # a fragment (optional)
        $~ixu`
