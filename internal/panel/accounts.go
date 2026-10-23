package panel

import (
	"context"
	"crypto/dsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/ssh"
)

type apiKeyContextKey struct{}

// AuthenticateAPIKey handles machine credentials independently of development
// identity. A malformed or rejected bearer token must never fall back to admin.
func (a *App) AuthenticateAPIKey(r *http.Request) (*http.Request, error) {
	header := r.Header.Get("Authorization")
	if header == "" {
		return r, nil
	}
	fields := strings.Fields(header)
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		return r, unauthorizedKey()
	}
	token := fields[1]
	if len(token) < 20 || len(token) > 512 {
		return r, unauthorizedKey()
	}
	hash := sha256.Sum256([]byte(token))
	key, err := a.one(r.Context(), "SELECT * FROM api_keys WHERE token_hash=$1 AND (expires_at IS NULL OR expires_at>now())", hex.EncodeToString(hash[:]))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return r, unauthorizedKey()
		}
		return r, err
	}
	if subtle.ConstantTimeCompare([]byte(str(key["token_hash"])), []byte(hex.EncodeToString(hash[:]))) != 1 {
		return r, unauthorizedKey()
	}
	if !keyIPAllowed(r.RemoteAddr, asSlice(key["allowed_ips"])) {
		return r, forbidden()
	}
	if strings.HasPrefix(r.URL.Path, "/api/client") && str(key["type"]) != "client" {
		return r, forbidden()
	}
	if (strings.HasPrefix(r.URL.Path, "/api/application") || strings.HasPrefix(r.URL.Path, "/api/admin")) && str(key["type"]) != "application" {
		return r, forbidden()
	}
	r = WithUser(r, num(key["user_id"]))
	r = r.WithContext(context.WithValue(r.Context(), apiKeyContextKey{}, key))
	if _, err = a.user(r); err != nil {
		return r, err
	}
	if err = a.exec(r.Context(), "UPDATE api_keys SET last_used_at=now() WHERE id=$1", key["id"]); err != nil {
		return r, err
	}
	return r, nil
}

func unauthorizedKey() error {
	return APIError{Status: 401, Code: "InvalidCredentials", Detail: "A valid API bearer token is required."}
}

func keyIPAllowed(remote string, allowed []any) bool {
	if len(allowed) == 0 {
		return true
	}
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	for _, v := range allowed {
		s := str(v)
		if p, e := netip.ParsePrefix(s); e == nil && p.Contains(ip) {
			return true
		}
		if p, e := netip.ParseAddr(s); e == nil && p.Unmap() == ip {
			return true
		}
	}
	return false
}

func (a *App) user(r *http.Request) (M, error) {
	id := UserID(r)
	if id <= 0 {
		return nil, unauthorizedKey()
	}
	user, err := a.one(r.Context(), "SELECT * FROM users WHERE id=$1", id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, unauthorizedKey()
	}
	if err != nil {
		return nil, err
	}
	if boolean(user["disabled"]) {
		return nil, forbidden()
	}
	return user, nil
}

func (a *App) requireAdmin(r *http.Request) (M, error) {
	u, err := a.user(r)
	if err != nil {
		return nil, err
	}
	if !boolean(u["root_admin"]) {
		return nil, forbidden()
	}
	if k, ok := r.Context().Value(apiKeyContextKey{}).(M); ok {
		if str(k["type"]) != "application" || !applicationScopeAllowed(asMap(k["permissions"]), r.Method, r.URL.Path) {
			return nil, forbidden()
		}
	}
	return u, nil
}

func applicationScopeAllowed(scopes M, method, path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 {
		return false
	}
	resource := parts[2]
	if len(parts) > 4 && parts[3] != "external" {
		switch {
		case resource == "nodes" && parts[4] == "allocations":
			resource = "allocations"
		case resource == "nests" && parts[4] == "eggs":
			resource = "eggs"
		case resource == "servers" && parts[4] == "databases":
			resource = "server_databases"
		}
	}
	if resource == "database-hosts" {
		resource = "database_hosts"
	}
	level := num(scopes[resource])
	if level == 0 {
		level = num(scopes["r_"+resource])
	}
	action := int64(2)
	if method == http.MethodGet || method == http.MethodHead {
		action = 1
	}
	return level&action != 0
}

func (a *App) can(ctx context.Context, user M, server M, permission string) bool {
	if boolean(user["disabled"]) || num(user["id"]) <= 0 {
		return false
	}
	if boolean(user["root_admin"]) || num(server["owner_id"]) == num(user["id"]) {
		return true
	}
	sub, err := a.one(ctx, "SELECT permissions FROM subusers WHERE user_id=$1 AND server_id=$2", user["id"], server["id"])
	if err != nil {
		return false
	}
	if permission == "" {
		return true
	}
	return hasServerPermission(asSlice(sub["permissions"]), permission)
}

func hasServerPermission(grants []any, permission string) bool {
	// Pterodactyl grants exact permissions. Wildcards are reserved for owners and
	// administrators and must not be accepted from a subuser record.
	if !validServerPermission(permission) {
		return false
	}
	for _, v := range grants {
		if str(v) == permission {
			return true
		}
	}
	return false
}

func (a *App) server(r *http.Request, permission string) (M, error) {
	u, err := a.user(r)
	if err != nil {
		return nil, err
	}
	if k, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && str(k["type"]) != "client" {
		return nil, forbidden()
	}
	identifier := r.PathValue("server")
	id, _ := strconv.ParseInt(identifier, 10, 64)
	s, err := a.one(r.Context(), `SELECT s.*,n.maintenance_mode AS node_maintenance,
 EXISTS(SELECT 1 FROM server_transfers t WHERE t.server_id=s.id AND t.successful IS NULL AND NOT t.archived) AS transferring
 FROM servers s JOIN nodes n ON n.id=s.node_id WHERE s.uuid=$1 OR s.uuid_short=$1 OR s.identifier=$1 OR s.id=$2`, identifier, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound()
	}
	if err != nil {
		return nil, err
	}
	if !a.can(r.Context(), u, s, "") {
		return nil, notFound()
	}
	if permission != "" && !a.can(r.Context(), u, s, permission) {
		return nil, forbidden()
	}
	base := "/api/client/servers/" + identifier
	view := strings.TrimRight(r.URL.Path, "/") == base
	// Steam status is read-only and must remain visible during initial directory
	// preparation, so the owner can follow installation progress and failures.
	steamStatus := r.Method == http.MethodGet && r.URL.Path == base+"/steam"
	navigation := r.URL.Path == base+"/navigation" && (r.Method == http.MethodPost || r.Method == http.MethodPut)
	adminSocket := boolean(u["root_admin"]) && (r.URL.Path == base+"/websocket" || r.URL.Path == base+"/ws")
	status := str(s["status"])
	if ((status != "" && status != "reinstall_failed") || boolean(s["node_maintenance"]) || boolean(s["transferring"])) && !view && !adminSocket && !steamStatus && !navigation {
		if status == "" {
			status = "unavailable during installation, maintenance, or transfer"
		}
		return nil, APIError{Status: 409, Code: "ServerStateConflict", Detail: "Server is " + status + "."}
	}
	return s, nil
}

var permissionGroups = map[string][]string{
	"websocket": {"connect"}, "control": {"console", "start", "stop", "restart"},
	"user": {"create", "read", "update", "delete"}, "file": {"create", "read", "read-content", "update", "delete", "archive", "sftp"},
	"backup": {"create", "read", "delete", "download", "restore"}, "allocation": {"read", "create", "update", "delete"},
	"startup": {"read", "update", "docker-image"}, "database": {"create", "read", "update", "delete", "view_password"},
	"schedule": {"create", "read", "update", "delete"}, "settings": {"rename", "reinstall"}, "activity": {"read"},
}

func validServerPermission(p string) bool {
	parts := strings.SplitN(p, ".", 2)
	if len(parts) != 2 {
		return false
	}
	for _, v := range permissionGroups[parts[0]] {
		if v == parts[1] {
			return true
		}
	}
	return false
}

func permissionCatalog() M {
	groups := M{}
	for group, keys := range permissionGroups {
		m := M{}
		for _, key := range keys {
			m[key] = "Allows " + group + " " + strings.ReplaceAll(key, "_", " ") + "."
		}
		groups[group] = M{"description": "Permissions for " + group + ".", "keys": m}
	}
	return M{"object": "system_permissions", "attributes": M{"permissions": groups}}
}

func (a *App) registerAccounts(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/permissions", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.user(r); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, permissionCatalog())
	})
	mux.HandleFunc("GET /api/client/account", a.accountGet)
	mux.HandleFunc("PATCH /api/client/account", a.accountUpdate)
	mux.HandleFunc("GET /api/client/account/api-keys", a.apiKeysList)
	mux.HandleFunc("POST /api/client/account/api-keys", a.apiKeysCreate)
	mux.HandleFunc("DELETE /api/client/account/api-keys/{identifier}", a.apiKeysDelete)
	mux.HandleFunc("GET /api/client/account/ssh-keys", a.sshKeysList)
	mux.HandleFunc("POST /api/client/account/ssh-keys", a.sshKeysCreate)
	mux.HandleFunc("POST /api/client/account/ssh-keys/remove", a.sshKeysDelete)
	for _, prefix := range []string{"/api/application", "/api/admin"} {
		mux.HandleFunc("GET "+prefix+"/users", a.usersList)
		mux.HandleFunc("POST "+prefix+"/users", a.usersCreate)
		mux.HandleFunc("GET "+prefix+"/users/external/{external}", a.usersExternal)
		mux.HandleFunc("GET "+prefix+"/users/{user}", a.usersGet)
		mux.HandleFunc("PATCH "+prefix+"/users/{user}", a.usersUpdate)
		mux.HandleFunc("DELETE "+prefix+"/users/{user}", a.usersDelete)
	}
	mux.HandleFunc("GET /api/admin/api-keys", a.applicationKeysList)
	mux.HandleFunc("POST /api/admin/api-keys", a.applicationKeysCreate)
	mux.HandleFunc("DELETE /api/admin/api-keys/{identifier}", a.applicationKeysDelete)
}

func accountAttributes(u M) M {
	provider := "development"
	if str(u["password_hash"]) != "" {
		provider = "password"
	}
	return M{"id": u["id"], "uuid": u["uuid"], "admin": u["root_admin"], "root_admin": u["root_admin"], "username": u["username"], "email": u["email"], "first_name": u["name_first"], "last_name": u["name_last"], "language": u["language"], "auth_provider": provider, "cloudflare_pending": provider == "development"}
}
func userAttributes(u M) M {
	return M{"id": u["id"], "uuid": u["uuid"], "external_id": u["external_id"], "username": u["username"], "email": u["email"], "first_name": u["name_first"], "last_name": u["name_last"], "language": u["language"], "root_admin": u["root_admin"], "disabled": u["disabled"], "created_at": u["created_at"], "updated_at": u["updated_at"]}
}

func (a *App) accountGet(w http.ResponseWriter, r *http.Request) {
	u, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("user", accountAttributes(u)))
}
func (a *App) accountUpdate(w http.ResponseWriter, r *http.Request) {
	u, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	fields := M{}
	for _, key := range []string{"first_name", "last_name", "language"} {
		if v, ok := d[key]; ok {
			fields[key] = v
		}
	}
	data, e := accountUserDataWithLocales(fields, false, a.Config.LocalesDir)
	if e != nil {
		fail(w, e)
		return
	}
	u, e = a.update(r.Context(), "users", num(u["id"]), data)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("user", accountAttributes(u)))
}

func (a *App) usersList(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	filters := []string{"true"}
	args := []any{}
	for _, field := range []string{"id", "uuid", "username", "email", "external_id"} {
		if value := r.URL.Query().Get("filter[" + field + "]"); value != "" {
			args = append(args, value)
			filters = append(filters, fmt.Sprintf("%s::text ILIKE '%%'||$%d||'%%'", field, len(args)))
		}
	}
	where := strings.Join(filters, " AND ")
	total, e := a.one(r.Context(), "SELECT count(*) AS count FROM users WHERE "+where, args...)
	if e != nil {
		fail(w, e)
		return
	}
	page, limit := int64(1), int64(50)
	if raw := r.URL.Query().Get("page"); raw != "" {
		page, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || page < 1 || page > 1000000 {
			fail(w, bad("page must be between 1 and 1000000."))
			return
		}
	}
	if raw := r.URL.Query().Get("per_page"); raw != "" {
		limit, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || limit < 1 || limit > 100 {
			fail(w, bad("per_page must be between 1 and 100."))
			return
		}
	}
	sort, desc := r.URL.Query().Get("sort"), false
	if strings.HasPrefix(sort, "-") {
		desc = true
		sort = strings.TrimPrefix(sort, "-")
	}
	if sort == "" {
		sort = "id"
	}
	if sort != "id" && sort != "username" && sort != "email" && sort != "created_at" && sort != "updated_at" {
		fail(w, bad("Unsupported user sort column."))
		return
	}
	direction := " ASC"
	if desc {
		direction = " DESC"
	}
	args = append(args, limit, (page-1)*limit)
	list, e := a.query(r.Context(), fmt.Sprintf("SELECT * FROM users WHERE %s ORDER BY %s%s,id LIMIT $%d OFFSET $%d", where, sort, direction, len(args)-1, len(args)), args...)
	if e != nil {
		fail(w, e)
		return
	}
	for i, u := range list {
		list[i], e = a.applicationUser(r, u)
		if e != nil {
			fail(w, e)
			return
		}
	}
	result := collection("user", list)
	count := num(total["count"])
	pages := (count + limit - 1) / limit
	if pages == 0 {
		pages = 1
	}
	result["meta"] = M{"pagination": M{"total": count, "count": len(list), "per_page": limit, "current_page": page, "total_pages": pages, "links": M{}}}
	writeJSON(w, 200, result)
}
func (a *App) usersGet(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("user"), 10, 64)
	u, e := a.one(r.Context(), "SELECT * FROM users WHERE id=$1", id)
	if e != nil {
		fail(w, e)
		return
	}
	attributes, e := a.applicationUser(r, u)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("user", attributes))
}
func (a *App) usersExternal(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	u, e := a.one(r.Context(), "SELECT * FROM users WHERE external_id=$1", r.PathValue("external"))
	if e != nil {
		fail(w, e)
		return
	}
	attributes, e := a.applicationUser(r, u)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("user", attributes))
}

func (a *App) applicationUser(r *http.Request, u M) (M, error) {
	attributes := userAttributes(u)
	include := false
	for _, v := range strings.Split(r.URL.Query().Get("include"), ",") {
		if v == "servers" {
			include = true
		}
	}
	if !include {
		return attributes, nil
	}
	if key, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && !applicationScopeAllowed(asMap(key["permissions"]), http.MethodGet, "/api/application/servers") {
		attributes["relationships"] = M{"servers": M{"object": "null", "attributes": nil}}
		return attributes, nil
	}
	servers, err := a.query(r.Context(), "SELECT * FROM servers WHERE owner_id=$1 ORDER BY id", u["id"])
	if err != nil {
		return nil, err
	}
	for i, s := range servers {
		servers[i], err = a.applicationServer(r.Context(), s)
		if err != nil {
			return nil, err
		}
	}
	attributes["relationships"] = M{"servers": collection("server", servers)}
	return attributes, nil
}

// The native Username rule requires an alphanumeric start and end with at
// least one allowed character between them. User models store lowercase names.
var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{1,189}[a-z0-9]$`)

func validateAccountLanguage(language, localesDir string) error {
	if localeCodePattern.MatchString(language) {
		if _, err := bundledLocales.ReadDir("locales/" + language); err == nil {
			return nil
		}
		if localesDir != "" {
			if info, err := os.Stat(filepath.Join(localesDir, language)); err == nil && info.IsDir() {
				return nil
			}
		}
	}
	return bad("Language must match an available locale code.")
}

func accountUserData(d M, create bool) (M, error) {
	return accountUserDataWithLocales(d, create, "")
}

func accountUserDataWithLocales(d M, create bool, localesDir string) (M, error) {
	data := M{}
	for _, key := range []string{"username", "email", "first_name", "last_name", "language", "external_id", "root_admin", "disabled"} {
		v, ok := d[key]
		if !ok {
			continue
		}
		column := key
		if key == "first_name" {
			column = "name_first"
		}
		if key == "last_name" {
			column = "name_last"
		}
		switch key {
		case "root_admin", "disabled":
			b, ok := v.(bool)
			if !ok {
				return nil, bad(key + " must be boolean.")
			}
			data[column] = b
		case "external_id":
			if v == nil {
				data[column] = nil
			} else {
				s, ok := v.(string)
				if !ok || utf8.RuneCountInString(s) > 191 {
					return nil, bad("external_id must be null or a string up to 191 characters.")
				}
				data[column] = s
			}
		default:
			s, ok := v.(string)
			if !ok || utf8.RuneCountInString(s) > 191 {
				return nil, bad(key + " must be a string up to 191 characters.")
			}
			data[column] = strings.TrimSpace(s)
			if (key == "first_name" || key == "last_name") && data[column] == "" {
				return nil, bad(key + " is required.")
			}
		}
	}
	if create {
		for _, key := range []string{"username", "email", "name_first", "name_last"} {
			if strings.TrimSpace(str(data[key])) == "" {
				return nil, bad(key + " is required.")
			}
		}
		data["uuid"] = newUUID()
	}
	if v, ok := data["username"]; ok {
		username := strings.ToLower(str(v))
		if !usernamePattern.MatchString(username) {
			return nil, bad("Username must contain 3 to 191 characters, start and end with letters or numbers, and contain only letters, numbers, periods, underscores, or dashes.")
		}
		data["username"] = username
	}
	if v, ok := data["language"]; ok {
		if err := validateAccountLanguage(str(v), localesDir); err != nil {
			return nil, err
		}
	}
	if v, ok := data["email"]; ok {
		address, err := mail.ParseAddress(str(v))
		if err != nil || address.Address != str(v) {
			return nil, bad("Email must be a valid email address.")
		}
		data["email"] = strings.ToLower(str(v))
	}
	if len(data) == 0 {
		return nil, bad("No account fields were provided.")
	}
	return data, nil
}
func (a *App) usersCreate(w http.ResponseWriter, r *http.Request) {
	actor, e := a.requireAdmin(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	data, e := accountUserDataWithLocales(d, true, a.Config.LocalesDir)
	if e != nil {
		fail(w, e)
		return
	}
	u, e := a.insert(r.Context(), "users", data)
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(actor["id"]), 0, "user:create", M{"user_id": u["id"]})
	writeJSON(w, 201, item("user", userAttributes(u)))
}
func (a *App) usersUpdate(w http.ResponseWriter, r *http.Request) {
	actor, e := a.requireAdmin(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	// The native application UpdateUserRequest reuses StoreUserRequest. Its
	// PATCH contract requires all four identity fields even though admin and
	// profile updates support partial edits.
	if strings.HasPrefix(r.URL.Path, "/api/application/") {
		for _, key := range []string{"username", "email", "first_name", "last_name"} {
			if value, ok := d[key]; !ok || value == nil {
				fail(w, bad(key+" is required."))
				return
			}
		}
	}
	data, e := accountUserDataWithLocales(d, false, a.Config.LocalesDir)
	if e != nil {
		fail(w, e)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("user"), 10, 64)
	if id == num(actor["id"]) && (data["root_admin"] == false || data["disabled"] == true) {
		fail(w, bad("You cannot disable or remove your own administrator access."))
		return
	}
	u, e := a.update(r.Context(), "users", id, data)
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(actor["id"]), 0, "user:update", M{"user_id": id})
	writeJSON(w, 200, item("user", userAttributes(u)))
}
func (a *App) usersDelete(w http.ResponseWriter, r *http.Request) {
	actor, e := a.requireAdmin(r)
	if e != nil {
		fail(w, e)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("user"), 10, 64)
	if id == num(actor["id"]) {
		fail(w, bad("You cannot delete your own account."))
		return
	}
	u, e := a.one(r.Context(), "SELECT id FROM users WHERE id=$1", id)
	if e != nil {
		fail(w, e)
		return
	}
	owned, e := a.one(r.Context(), "SELECT count(*) AS count FROM servers WHERE owner_id=$1", u["id"])
	if e != nil {
		fail(w, e)
		return
	}
	if num(owned["count"]) > 0 {
		fail(w, bad("Transfer or delete this user's servers before deleting their account."))
		return
	}
	if e = a.exec(r.Context(), "DELETE FROM users WHERE id=$1", id); e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(actor["id"]), 0, "user:delete", M{"user_id": id})
	w.WriteHeader(204)
}

func apiKeyAttributes(k M) M {
	return M{"identifier": k["identifier"], "user_id": k["user_id"], "description": k["memo"], "allowed_ips": k["allowed_ips"], "permissions": k["permissions"], "type": k["type"], "last_used_at": k["last_used_at"], "expires_at": k["expires_at"], "created_at": k["created_at"]}
}
func (a *App) apiKeysList(w http.ResponseWriter, r *http.Request)         { a.keysList(w, r, false) }
func (a *App) applicationKeysList(w http.ResponseWriter, r *http.Request) { a.keysList(w, r, true) }
func (a *App) keysList(w http.ResponseWriter, r *http.Request, application bool) {
	u, e := a.keyActor(r, application)
	if e != nil {
		fail(w, e)
		return
	}
	kind := "client"
	if application {
		kind = "application"
	}
	query := "SELECT * FROM api_keys WHERE user_id=$1 AND type=$2 ORDER BY id"
	args := []any{u["id"], kind}
	if application {
		query = "SELECT * FROM api_keys WHERE type=$1 ORDER BY id"
		args = []any{kind}
	}
	list, e := a.query(r.Context(), query, args...)
	if e != nil {
		fail(w, e)
		return
	}
	for i, k := range list {
		list[i] = apiKeyAttributes(k)
	}
	writeJSON(w, 200, collection("api_key", list))
}
func (a *App) keyActor(r *http.Request, application bool) (M, error) {
	if application {
		if _, isKey := r.Context().Value(apiKeyContextKey{}).(M); isKey {
			return nil, forbidden()
		}
		return a.requireAdmin(r)
	}
	if k, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && str(k["type"]) != "client" {
		return nil, forbidden()
	}
	return a.user(r)
}
func (a *App) apiKeysCreate(w http.ResponseWriter, r *http.Request)         { a.keysCreate(w, r, false) }
func (a *App) applicationKeysCreate(w http.ResponseWriter, r *http.Request) { a.keysCreate(w, r, true) }
func validateAllowedIPs(v any) ([]any, error) {
	if v == nil {
		return []any{}, nil
	}
	ips, ok := v.([]any)
	if !ok || len(ips) > 100 {
		return nil, bad("allowed_ips must be an array of at most 100 IP addresses or CIDRs.")
	}
	out := []any{}
	for _, raw := range ips {
		s, ok := raw.(string)
		if !ok {
			return nil, bad("Each allowed IP must be a string.")
		}
		s = strings.TrimSpace(s)
		if _, err := netip.ParseAddr(s); err != nil {
			if _, err = netip.ParsePrefix(s); err != nil {
				return nil, bad("Invalid allowed IP: " + s)
			}
		}
		out = append(out, s)
	}
	return out, nil
}
func validateApplicationScopes(v any) (M, error) {
	out := M{}
	if v == nil {
		return out, nil
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, bad("permissions must be an object.")
	}
	allowed := map[string]bool{}
	for _, key := range []string{"servers", "nodes", "allocations", "users", "locations", "nests", "eggs", "database_hosts", "server_databases", "mounts", "settings"} {
		allowed[key] = true
	}
	for key, value := range m {
		key = strings.TrimPrefix(key, "r_")
		if _, isString := value.(string); isString {
			return nil, bad("Application permissions must be integers from 0 to 3.")
		}
		n := num(value)
		if !allowed[key] || n < 0 || n > 3 {
			return nil, bad("Invalid application API permission.")
		}
		if fmt.Sprint(value) != strconv.FormatInt(n, 10) {
			return nil, bad("Application permissions must be integers from 0 to 3.")
		}
		out[key] = n
	}
	return out, nil
}
func (a *App) keysCreate(w http.ResponseWriter, r *http.Request, application bool) {
	u, e := a.keyActor(r, application)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	memo, ok := d["description"].(string)
	if !ok || strings.TrimSpace(memo) == "" || len(memo) > 500 {
		fail(w, bad("description is required and must be at most 500 characters."))
		return
	}
	ips, e := validateAllowedIPs(d["allowed_ips"])
	if e != nil {
		fail(w, e)
		return
	}
	scopes := M{}
	kind := "client"
	if application {
		kind = "application"
		scopes, e = validateApplicationScopes(d["permissions"])
		if e != nil {
			fail(w, e)
			return
		}
	}
	var expiresAt any
	if raw, ok := d["expires_at"]; ok && raw != nil {
		value, ok := raw.(string)
		if !ok {
			fail(w, bad("expires_at must be an RFC3339 timestamp or null."))
			return
		}
		expiry, e := time.Parse(time.RFC3339, value)
		if e != nil || !expiry.After(time.Now()) {
			fail(w, bad("expires_at must be a future RFC3339 timestamp."))
			return
		}
		expiresAt = expiry.UTC()
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var uid int64
	if e = tx.QueryRow(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", u["id"]).Scan(&uid); e != nil {
		fail(w, e)
		return
	}
	var count int
	if e = tx.QueryRow(r.Context(), "SELECT count(*) FROM api_keys WHERE user_id=$1 AND type=$2", uid, kind).Scan(&count); e != nil {
		fail(w, e)
		return
	}
	if !application && count >= 25 {
		fail(w, bad("You have reached the account limit of 25 API keys."))
		return
	}
	identifier := randomToken(8)
	prefix := "ptlc_"
	if application {
		prefix = "ptla_"
	}
	token := prefix + identifier + randomToken(24)
	hash := sha256.Sum256([]byte(token))
	var id int64
	if e = tx.QueryRow(r.Context(), "INSERT INTO api_keys(user_id,identifier,token_hash,type,memo,allowed_ips,permissions,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", uid, identifier, hex.EncodeToString(hash[:]), kind, memo, ips, scopes, expiresAt).Scan(&id); e != nil {
		fail(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		fail(w, e)
		return
	}
	key, e := a.one(r.Context(), "SELECT * FROM api_keys WHERE id=$1", id)
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), uid, 0, "user:api-key.create", M{"identifier": identifier})
	result := item("api_key", apiKeyAttributes(key))
	result["meta"] = M{"secret_token": token}
	writeJSON(w, 201, result)
}
func (a *App) apiKeysDelete(w http.ResponseWriter, r *http.Request)         { a.keysDelete(w, r, false) }
func (a *App) applicationKeysDelete(w http.ResponseWriter, r *http.Request) { a.keysDelete(w, r, true) }
func (a *App) keysDelete(w http.ResponseWriter, r *http.Request, application bool) {
	u, e := a.keyActor(r, application)
	if e != nil {
		fail(w, e)
		return
	}
	kind := "client"
	if application {
		kind = "application"
	}
	identifier := r.PathValue("identifier")
	query := "SELECT id FROM api_keys WHERE user_id=$1 AND identifier=$2 AND type=$3"
	args := []any{u["id"], identifier, kind}
	if application {
		query = "SELECT id FROM api_keys WHERE identifier=$1 AND type=$2"
		args = []any{identifier, kind}
	}
	key, e := a.one(r.Context(), query, args...)
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.exec(r.Context(), "DELETE FROM api_keys WHERE id=$1", key["id"]); e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(u["id"]), 0, "user:api-key.delete", M{"identifier": identifier})
	w.WriteHeader(204)
}

func (a *App) sshKeysList(w http.ResponseWriter, r *http.Request) {
	u, e := a.keyActor(r, false)
	if e != nil {
		fail(w, e)
		return
	}
	list, e := a.query(r.Context(), "SELECT name,public_key,fingerprint,created_at FROM ssh_keys WHERE user_id=$1 ORDER BY id", u["id"])
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, collection("ssh_key", list))
}
func parseUserSSHKey(raw string) (string, string, error) {
	if len(raw) > 16384 {
		return "", "", bad("SSH key is too long.")
	}
	key, _, options, rest, err := ssh.ParseAuthorizedKey([]byte(raw))
	if err != nil {
		if block, trailing := pem.Decode([]byte(raw)); block != nil && strings.TrimSpace(string(trailing)) == "" && (block.Type == "PUBLIC KEY" || block.Type == "RSA PUBLIC KEY") {
			var public any
			if block.Type == "RSA PUBLIC KEY" {
				public, err = x509.ParsePKCS1PublicKey(block.Bytes)
			} else {
				public, err = x509.ParsePKIXPublicKey(block.Bytes)
			}
			if err == nil {
				key, err = ssh.NewPublicKey(public)
				options = nil
				rest = nil
			}
		}
	}
	if err != nil || len(strings.TrimSpace(string(rest))) != 0 || len(options) != 0 {
		return "", "", bad("Provide a single SSH public key without authorized_keys options.")
	}
	if _, certificate := key.(*ssh.Certificate); certificate {
		return "", "", bad("SSH certificates cannot be registered as account keys.")
	}
	if cryptoKey, ok := key.(ssh.CryptoPublicKey); ok {
		switch public := cryptoKey.CryptoPublicKey().(type) {
		case *dsa.PublicKey:
			return "", "", bad("DSA keys are not supported.")
		case *rsa.PublicKey:
			if public.N.BitLen() < 2048 {
				return "", "", bad("RSA keys must be at least 2048 bits.")
			}
		}
	}
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key))), ssh.FingerprintSHA256(key), nil
}
func (a *App) sshKeysCreate(w http.ResponseWriter, r *http.Request) {
	u, e := a.keyActor(r, false)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	name := strings.TrimSpace(str(d["name"]))
	if name == "" || len(name) > 191 {
		fail(w, bad("SSH key name is required and must be at most 191 characters."))
		return
	}
	key, fingerprint, e := parseUserSSHKey(str(d["public_key"]))
	if e != nil {
		fail(w, e)
		return
	}
	row, e := a.insert(r.Context(), "ssh_keys", M{"user_id": u["id"], "name": name, "public_key": key, "fingerprint": fingerprint})
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(u["id"]), 0, "user:ssh-key.create", M{"fingerprint": fingerprint})
	delete(row, "user_id")
	delete(row, "id")
	writeJSON(w, 201, item("ssh_key", row))
}
func (a *App) sshKeysDelete(w http.ResponseWriter, r *http.Request) {
	u, e := a.keyActor(r, false)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	fingerprint := str(d["fingerprint"])
	if fingerprint == "" {
		fail(w, bad("fingerprint is required."))
		return
	}
	if e = a.exec(r.Context(), "DELETE FROM ssh_keys WHERE user_id=$1 AND fingerprint=$2", u["id"], fingerprint); e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(r.Context(), num(u["id"]), 0, "user:ssh-key.delete", M{"fingerprint": fingerprint})
	w.WriteHeader(204)
}
