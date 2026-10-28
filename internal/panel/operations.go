package panel

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
)

func (a *App) registerOperations(mux *http.ServeMux) {
	a.registerFileTransfers(mux)
	mux.HandleFunc("GET /api/client/{$}", a.clientServers)
	mux.HandleFunc("GET /api/client", a.clientServers)
	mux.HandleFunc("GET /api/client/servers/{server}", a.clientServerDetail)
	mux.HandleFunc("GET /api/client/servers/{server}/artwork/{asset}", a.clientArtwork)
	mux.HandleFunc("GET /api/client/servers/{server}/resources", a.clientResources)
	mux.HandleFunc("POST /api/client/servers/{server}/command", a.clientCommand)
	mux.HandleFunc("POST /api/client/servers/{server}/power", a.clientPower)
	mux.HandleFunc("GET /api/client/servers/{server}/websocket", a.clientWebsocket)
	mux.HandleFunc("GET /api/client/servers/{server}/console-history", a.clientConsoleHistory)
	mux.HandleFunc("GET /api/client/servers/{server}/ws", a.clientSocketProxy)
	for _, op := range []string{"list", "contents", "download", "upload"} {
		mux.HandleFunc("GET /api/client/servers/{server}/files/"+op, a.clientFiles)
	}
	for _, op := range []string{"copy", "write", "compress", "decompress", "delete", "create-folder", "chmod", "pull"} {
		mux.HandleFunc("POST /api/client/servers/{server}/files/"+op, a.clientFiles)
	}
	mux.HandleFunc("PUT /api/client/servers/{server}/files/rename", a.clientFiles)
	mux.HandleFunc("GET /api/wings/{node}/download/{kind}", a.signedWingsProxy)
	mux.HandleFunc("POST /api/wings/{node}/upload/file", a.signedWingsProxy)
	mux.HandleFunc("GET /api/client/servers/{server}/backups", a.clientBackups)
	mux.HandleFunc("POST /api/client/servers/{server}/backups", a.clientBackups)
	mux.HandleFunc("GET /api/client/servers/{server}/backups/{backup}", a.clientBackup)
	mux.HandleFunc("DELETE /api/client/servers/{server}/backups/{backup}", a.clientBackup)
	mux.HandleFunc("GET /api/client/servers/{server}/backups/{backup}/download", a.clientBackup)
	mux.HandleFunc("POST /api/client/servers/{server}/backups/{backup}/lock", a.clientBackup)
	mux.HandleFunc("POST /api/client/servers/{server}/backups/{backup}/restore", a.clientBackup)
	mux.HandleFunc("GET /api/client/servers/{server}/network/allocations", a.clientAllocations)
	mux.HandleFunc("POST /api/client/servers/{server}/network/allocations", a.clientAllocations)
	mux.HandleFunc("POST /api/client/servers/{server}/network/allocations/{allocation}", a.clientAllocations)
	mux.HandleFunc("DELETE /api/client/servers/{server}/network/allocations/{allocation}", a.clientAllocations)
	mux.HandleFunc("POST /api/client/servers/{server}/network/allocations/{allocation}/primary", a.clientAllocations)
	mux.HandleFunc("GET /api/client/servers/{server}/startup", a.clientStartup)
	mux.HandleFunc("PUT /api/client/servers/{server}/startup/variable", a.clientStartup)
	mux.HandleFunc("POST /api/client/servers/{server}/settings/rename", a.clientSettings)
	mux.HandleFunc("POST /api/client/servers/{server}/settings/reinstall", a.clientSettings)
	mux.HandleFunc("PUT /api/client/servers/{server}/settings/docker-image", a.clientSettings)
	a.registerS3Operations(mux)
}

func opLast(r *http.Request) string {
	p := strings.Split(strings.TrimRight(r.URL.Path, "/"), "/")
	return p[len(p)-1]
}
func opDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}
func opJSON(resp *http.Response) (M, error) {
	defer resp.Body.Close()
	var m M
	err := json.NewDecoder(resp.Body).Decode(&m)
	return m, err
}
func (a *App) opAudit(r *http.Request, s M, event string, p M) {
	_ = a.audit(r.Context(), UserID(r), num(s["id"]), event, p)
}

func (a *App) clientServers(w http.ResponseWriter, r *http.Request) {
	if k, ok := r.Context().Value(apiKeyContextKey{}).(M); ok && str(k["type"]) != "client" {
		fail(w, forbidden())
		return
	}
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	if r.URL.Query().Get("summary") == "overview" {
		a.clientServerSummaries(w, r, u)
		return
	}
	listType := r.URL.Query().Get("type")
	if listType == "" && boolean(u["root_admin"]) {
		listType = "admin-all"
	}
	rows, err := a.query(r.Context(), `SELECT s.* FROM servers s WHERE ($2 AND $3='admin-all') OR ($2 AND $3='admin' AND s.owner_id<>$1 AND NOT EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=s.id AND su.user_id=$1)) OR ($3='owner' AND s.owner_id=$1) OR ($3 NOT IN ('admin','admin-all','owner') AND (s.owner_id=$1 OR EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=s.id AND su.user_id=$1))) ORDER BY s.id`, num(u["id"]), boolean(u["root_admin"]), listType)
	if err != nil {
		fail(w, err)
		return
	}
	filtered := []M{}
	for _, s := range rows {
		match := true
		for _, k := range []string{"uuid", "name", "description", "external_id"} {
			if q := r.URL.Query().Get("filter[" + k + "]"); q != "" && !strings.Contains(strings.ToLower(str(s[k])), strings.ToLower(q)) {
				match = false
			}
		}
		if q := r.URL.Query().Get("filter[*]"); q != "" && !strings.Contains(strings.ToLower(str(s["name"])+str(s["uuid"])+str(s["description"])), strings.ToLower(q)) {
			match = false
		}
		if match {
			filtered = append(filtered, s)
		}
	}
	per, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if per < 1 {
		per = 50
	}
	if per > 100 {
		per = 100
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	total := len(filtered)
	start := (page - 1) * per
	if start > total {
		start = total
	}
	end := start + per
	if end > total {
		end = total
	}
	out := []any{}
	for _, s := range filtered[start:end] {
		attrs, e := a.clientServer(r.Context(), u, s)
		if e != nil {
			fail(w, e)
			return
		}
		out = append(out, item("server", attrs))
	}
	pages := (total + per - 1) / per
	if pages == 0 {
		pages = 1
	}
	writeJSON(w, 200, M{"object": "list", "data": out, "meta": M{"pagination": M{"total": total, "count": len(out), "per_page": per, "current_page": page, "total_pages": pages, "links": M{}}}})
}
func (a *App) clientServerDetail(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "")
	if e != nil {
		fail(w, e)
		return
	}
	u, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	m, e := a.clientServer(r.Context(), u, s)
	if e != nil {
		fail(w, e)
		return
	}
	p, e := a.socketPermissions(r.Context(), u, s)
	if e != nil {
		fail(w, e)
		return
	}
	out := item("server", m)
	out["meta"] = M{"is_server_owner": num(u["id"]) == num(s["owner_id"]), "user_permissions": p}
	writeJSON(w, 200, out)
}
func (a *App) clientResources(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "")
	if e != nil {
		fail(w, e)
		return
	}
	resp, e := a.daemonServer(r.Context(), s, "GET", "", nil)
	if e != nil {
		fail(w, e)
		return
	}
	m, e := opJSON(resp)
	if e != nil {
		fail(w, e)
		return
	}
	u := asMap(m["utilization"])
	n := asMap(u["network"])
	writeJSON(w, 200, item("stats", M{"current_state": opDefault(str(m["state"]), "stopped"), "is_suspended": boolean(m["is_suspended"]), "resources": M{"memory_bytes": num(u["memory_bytes"]), "cpu_absolute": u["cpu_absolute"], "disk_bytes": num(u["disk_bytes"]), "network_rx_bytes": num(n["rx_bytes"]), "network_tx_bytes": num(n["tx_bytes"]), "uptime": num(u["uptime"])}}))
}
func (a *App) clientCommand(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "control.console")
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	if strings.TrimSpace(str(d["command"])) == "" {
		fail(w, bad("command is required"))
		return
	}
	resp, e := a.daemonServer(r.Context(), s, "POST", "/commands", M{"commands": []string{str(d["command"])}})
	if e != nil {
		fail(w, e)
		return
	}
	resp.Body.Close()
	a.opAudit(r, s, "server:console.command", M{"command": str(d["command"])})
	w.WriteHeader(204)
}
func (a *App) clientPower(w http.ResponseWriter, r *http.Request) {
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	signal := str(d["signal"])
	perm := "control." + signal
	if signal == "kill" {
		perm = "control.stop"
	}
	if signal != "start" && signal != "stop" && signal != "restart" && signal != "kill" {
		fail(w, bad("signal must be start, stop, restart or kill"))
		return
	}
	s, e := a.server(r, perm)
	if e != nil {
		fail(w, e)
		return
	}
	a.recordConsolePower(r.Context(), num(s["id"]), signal, "requested")
	resp, e := a.daemonServer(r.Context(), s, "POST", "/power", M{"action": signal})
	if e != nil {
		a.recordConsolePower(r.Context(), num(s["id"]), signal, "failed")
		fail(w, e)
		return
	}
	resp.Body.Close()
	a.recordConsolePower(r.Context(), num(s["id"]), signal, "accepted")
	a.opAudit(r, s, "server:power."+signal, M{})
	w.WriteHeader(204)
}

func opNodeAddress(n M) string {
	scheme := opDefault(str(n["scheme"]), "http")
	host := str(n["fqdn"])
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	return fmt.Sprintf("%s://%s:%d", scheme, host, num(n["daemon_listen"]))
}
func (a *App) nodeJWT(node, user, claims M, scope string, lifetime time.Duration) (string, error) {
	ts := time.Now()
	sum := sha256.Sum256([]byte(fmt.Sprint(num(user["id"])) + str(claims["server_uuid"])))
	id := hex.EncodeToString(sum[:])
	c := jwt.MapClaims{"iss": a.Config.PublicURL, "aud": []string{opNodeAddress(node)}, "jti": id, "iat": ts.Unix(), "nbf": ts.Add(-5 * time.Minute).Unix(), "exp": ts.Add(lifetime).Unix(), "scope": scope, "unique_id": randomToken(24)}
	if user["uuid"] != nil {
		c["user_uuid"] = user["uuid"]
	}
	for k, v := range claims {
		c[k] = v
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	t.Header["jti"] = id
	return t.SignedString([]byte(str(node["daemon_token"])))
}
func (a *App) socketPermissions(ctx context.Context, u, s M) ([]string, error) {
	if boolean(u["root_admin"]) {
		return []string{"*", "admin.websocket.errors", "admin.websocket.install", "admin.websocket.transfer"}, nil
	}
	if num(u["id"]) == num(s["owner_id"]) {
		return []string{"*"}, nil
	}
	m, e := a.one(ctx, `SELECT permissions FROM subusers WHERE user_id=$1 AND server_id=$2`, num(u["id"]), num(s["id"]))
	if e != nil {
		return nil, e
	}
	out := []string{}
	for _, p := range asSlice(m["permissions"]) {
		v := str(p)
		if !strings.HasPrefix(v, "admin.") && v != "*" {
			out = append(out, v)
		}
	}
	return out, nil
}
func (a *App) socketNode(ctx context.Context, u, s M) (M, error) {
	transfers, err := a.query(ctx, `SELECT * FROM server_transfers WHERE server_id=$1 AND successful IS NULL ORDER BY id DESC LIMIT 1`, num(s["id"]))
	if err != nil {
		return nil, err
	}
	nodeID := num(s["node_id"])
	if len(transfers) > 0 {
		if !boolean(u["root_admin"]) {
			return nil, forbidden()
		}
		if boolean(transfers[0]["archived"]) {
			nodeID = num(transfers[0]["new_node"])
		}
	}
	return a.node(ctx, nodeID)
}
func (a *App) clientWebsocket(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "websocket.connect")
	if e != nil {
		fail(w, e)
		return
	}
	u, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	n, e := a.socketNode(r.Context(), u, s)
	if e != nil {
		fail(w, e)
		return
	}
	p, e := a.socketPermissions(r.Context(), u, s)
	if e != nil {
		fail(w, e)
		return
	}
	token, e := a.nodeJWT(n, u, M{"server_uuid": s["uuid"], "permissions": p}, "websocket", 10*time.Minute)
	if e != nil {
		fail(w, e)
		return
	}
	scheme := "ws"
	if r.TLS != nil || strings.HasPrefix(a.panelPublicURL(r.Context()), "https://") {
		scheme = "wss"
	}
	writeJSON(w, 200, M{"data": M{"token": token, "socket": scheme + "://" + r.Host + "/api/client/servers/" + url.PathEscape(str(s["uuid"])) + "/ws"}})
}
func (a *App) clientSocketProxy(w http.ResponseWriter, r *http.Request) {
	s, e := a.server(r, "websocket.connect")
	if e != nil {
		fail(w, e)
		return
	}
	u, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host != r.Host {
			fail(w, forbidden())
			return
		}
	}
	n, e := a.socketNode(r.Context(), u, s)
	if e != nil {
		fail(w, e)
		return
	}
	target := strings.Replace(strings.Replace(opNodeAddress(n), "http://", "ws://", 1), "https://", "wss://", 1) + "/api/servers/" + url.PathEscape(str(s["uuid"])) + "/ws"
	headers := http.Header{}
	headers.Set("Origin", a.consoleUpstreamOrigin(r.Context(), n))
	dialer := *websocket.DefaultDialer
	if str(n["connection_mode"]) == "outbound" {
		dialer.NetDialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			return a.dialNodeConnector(ctx, num(n["id"]))
		}
	}
	up, resp, e := dialer.DialContext(r.Context(), target, headers)
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	if e != nil {
		fail(w, &APIError{Status: 502, Code: "DaemonConnectionException", Detail: "Unable to connect to Wings websocket"})
		return
	}
	defer up.Close()
	upgrade := websocket.Upgrader{CheckOrigin: func(req *http.Request) bool {
		origin := req.Header.Get("Origin")
		if origin == "" {
			return true
		}
		o, err := url.Parse(origin)
		return err == nil && o.Host == req.Host
	}}
	down, e := upgrade.Upgrade(w, r, nil)
	if e != nil {
		return
	}
	defer down.Close()
	done := make(chan struct{}, 2)
	var downWrite sync.Mutex
	copySocket := func(dst, src *websocket.Conn) {
		defer func() { done <- struct{}{} }()
		for {
			t, b, err := src.ReadMessage()
			if err != nil {
				return
			}
			if src == down {
				handled, powerErr := a.steamSocketPower(r.Context(), u, s, b)
				if handled {
					if powerErr != nil {
						downWrite.Lock()
						_ = down.WriteJSON(M{"event": "daemon error", "args": []string{powerErr.Error()}})
						downWrite.Unlock()
					}
					continue
				}
			}
			if dst == down {
				downWrite.Lock()
			}
			if err = dst.WriteMessage(t, b); err != nil {
				if dst == down {
					downWrite.Unlock()
				}
				return
			}
			if dst == down {
				downWrite.Unlock()
			}
		}
	}
	go copySocket(up, down)
	go copySocket(down, up)
	<-done
}

func opFileTransform(m M) M {
	isFile := true
	if v, ok := m["file"]; ok {
		isFile = boolean(v)
	}
	return M{"name": m["name"], "mode": m["mode"], "mode_bits": m["mode_bits"], "size": m["size"], "is_file": isFile, "is_symlink": boolean(m["symlink"]), "mimetype": opDefault(str(m["mime"]), "application/octet-stream"), "created_at": m["created"], "modified_at": m["modified"]}
}
func opFilePermission(op string) string {
	switch op {
	case "list":
		return "file.read"
	case "contents", "download":
		return "file.read-content"
	case "upload", "copy", "create-folder", "pull", "write", "decompress":
		return "file.create"
	case "rename":
		return "file.update"
	case "delete":
		return "file.delete"
	case "compress":
		return "file.archive"
	case "chmod":
		return "file.update"
	}
	return "file.read"
}
func (a *App) clientFiles(w http.ResponseWriter, r *http.Request) {
	op := opLast(r)
	s, e := a.server(r, opFilePermission(op))
	if e != nil {
		fail(w, e)
		return
	}
	if op == "pull" && !a.allowFilePull(w, r, s) {
		return
	}
	if op == "download" || op == "upload" {
		a.clientSignedFile(w, r, s, op)
		return
	}
	q := r.URL.Query()
	path := "/files/" + op
	var body any
	auditEvent := "server:file." + op
	auditProperties := M{}
	method := r.Method
	if op == "list" {
		path = "/files/list-directory?" + url.Values{"directory": {opDefault(q.Get("directory"), "/")}}.Encode()
	} else if op == "contents" || op == "write" {
		if q.Get("file") == "" {
			fail(w, bad("file is required"))
			return
		}
		path += "?" + url.Values{"file": {q.Get("file")}}.Encode()
		auditProperties["file"] = q.Get("file")
		if op == "write" {
			content, err := io.ReadAll(io.LimitReader(r.Body, (16<<20)+1))
			if err != nil {
				fail(w, err)
				return
			}
			if len(content) > 16<<20 {
				fail(w, &APIError{Status: 413, Code: "FileSizeTooLargeException", Detail: "File writes are limited to 16 MiB; use file upload for larger files"})
				return
			}
			body = bytes.NewReader(content)
		}
	} else {
		d, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		if err = opValidateFile(op, d); err != nil {
			fail(w, err)
			return
		}
		if d["root"] == nil {
			d["root"] = "/"
		}
		switch op {
		case "copy":
			auditProperties = M{"file": d["location"]}
		case "create-folder":
			auditEvent = "server:file.create-directory"
			auditProperties = M{"name": d["name"], "directory": d["root"]}
		case "rename", "delete", "compress":
			auditProperties = M{"directory": d["root"], "files": d["files"], "count": len(asSlice(d["files"]))}
		case "decompress":
			auditProperties = M{"directory": d["root"], "files": d["file"]}
		case "pull":
			auditProperties = M{"directory": opDefault(str(d["directory"]), "/"), "url": d["url"]}
		case "chmod":
			auditEvent = ""
		}
		if op == "create-folder" {
			path = "/files/create-directory"
			d["path"] = d["root"]
			delete(d, "root")
		}
		if op == "pull" {
			d["root"] = opDefault(str(d["directory"]), "/")
			delete(d, "directory")
			if v, ok := d["filename"]; ok {
				d["file_name"] = v
				delete(d, "filename")
			}
		}
		body = d
	}
	requestContext := r.Context()
	if op == "compress" || op == "decompress" {
		requestContext = withDaemonTimeout(requestContext, 15*time.Minute)
	}
	resp, e := a.daemonServer(requestContext, s, method, path, body)
	if e != nil {
		fail(w, e)
		return
	}
	defer resp.Body.Close()
	if op == "list" {
		var files []M
		if e = json.NewDecoder(resp.Body).Decode(&files); e != nil {
			fail(w, e)
			return
		}
		out := []M{}
		for _, f := range files {
			out = append(out, opFileTransform(f))
		}
		writeJSON(w, 200, collection("file_object", out))
		return
	}
	if op == "contents" {
		const limit = 4 << 20
		b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
		if err != nil {
			fail(w, err)
			return
		}
		if len(b) > limit {
			fail(w, &APIError{Status: 413, Code: "FileSizeTooLargeException", Detail: "This file is too large to edit; download it instead"})
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(b)
		a.opAudit(r, s, "server:file.read", M{"file": q.Get("file")})
		return
	}
	if op == "compress" {
		var m M
		if e = json.NewDecoder(resp.Body).Decode(&m); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, item("file_object", opFileTransform(m)))
	} else {
		w.WriteHeader(204)
	}
	if auditEvent != "" {
		a.opAudit(r, s, auditEvent, auditProperties)
	}
}
func opValidateFile(op string, d M) error {
	return validateOriginalFileRequest(op, d)
}
func (a *App) clientSignedFile(w http.ResponseWriter, r *http.Request, s M, op string) {
	u, e := a.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	n, e := a.node(r.Context(), num(s["node_id"]))
	if e != nil {
		fail(w, e)
		return
	}
	claims := M{"server_uuid": s["uuid"]}
	scope := "file-upload"
	path := "/upload/file"
	if op == "download" {
		if r.URL.Query().Get("file") == "" {
			fail(w, bad("file is required"))
			return
		}
		claims["file_path"] = r.URL.Query().Get("file")
		scope = "file-download"
		path = "/download/file"
	}
	token, e := a.nodeJWT(n, u, claims, scope, 15*time.Minute)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("signed_url", M{"url": fmt.Sprintf("/api/wings/%d%s?token=%s", num(n["id"]), path, url.QueryEscape(token))}))
	if op == "download" {
		a.opAudit(r, s, "server:file.download", M{"file": claims["file_path"]})
	}
}
func (a *App) signedWingsProxy(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("node"), 10, 64)
	n, e := a.node(r.Context(), id)
	if e != nil {
		fail(w, e)
		return
	}
	token, e := jwt.Parse(r.URL.Query().Get("token"), func(t *jwt.Token) (any, error) { return []byte(str(n["daemon_token"])), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithAudience(opNodeAddress(n)))
	if e != nil || !token.Valid {
		fail(w, forbidden())
		return
	}
	c := token.Claims.(jwt.MapClaims)
	scope := str(c["scope"])
	suffix := "/download/" + r.PathValue("kind")
	if r.Method == "POST" {
		suffix = "/upload/file"
		if scope != "file-upload" {
			fail(w, forbidden())
			return
		}
	} else if (r.PathValue("kind") == "file" && scope != "file-download") || (r.PathValue("kind") == "backup" && scope != "backup-download") || (r.PathValue("kind") != "file" && r.PathValue("kind") != "backup") {
		fail(w, forbidden())
		return
	}
	s, e := a.one(r.Context(), `SELECT * FROM servers WHERE uuid=$1 AND node_id=$2`, str(c["server_uuid"]), id)
	if e != nil {
		fail(w, e)
		return
	}
	_ = s
	target, e := url.Parse(opNodeAddress(n))
	if e != nil {
		fail(w, e)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	if str(n["connection_mode"]) == "outbound" {
		proxy.Transport = a.connectorTransport(n)
	}
	original := proxy.Director
	proxy.Director = func(req *http.Request) {
		original(req)
		req.URL.Path = suffix
		req.URL.RawPath = ""
		req.Host = target.Host
		req.Header.Del("Authorization")
		req.Header.Del("Cookie")
		req.Header.Del("X-Pterodactyl-User")
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		fail(w, &APIError{Status: 502, Code: "DaemonConnectionException", Detail: "Unable to stream file through Wings"})
	}
	proxy.ServeHTTP(w, r)
}

func opBackupTransform(b M) M {
	out := M{}
	for _, k := range []string{"uuid", "is_successful", "is_locked", "name", "ignored_files", "checksum", "bytes", "created_at", "completed_at"} {
		out[k] = b[k]
	}
	return out
}
func (a *App) clientBackups(w http.ResponseWriter, r *http.Request) {
	perm := "backup.read"
	if r.Method == "POST" {
		perm = "backup.create"
	}
	s, e := a.server(r, perm)
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "POST" {
		d, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		u, err := a.user(r)
		if err != nil {
			fail(w, err)
			return
		}
		if !a.can(r.Context(), u, s, "backup.delete") {
			d["is_locked"] = false
		}
		b, err := a.createBackup(r.Context(), s, d)
		if err != nil {
			fail(w, err)
			return
		}
		a.opAudit(r, s, "server:backup.start", M{"backup": b["uuid"], "name": b["name"], "locked": b["is_locked"]})
		writeJSON(w, 200, item("backup", opBackupTransform(b)))
		return
	}
	rows, e := a.query(r.Context(), `SELECT * FROM backups WHERE server_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC`, num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	out := []M{}
	count := 0
	for _, b := range rows {
		out = append(out, opBackupTransform(b))
		if boolean(b["is_successful"]) || b["completed_at"] == nil {
			count++
		}
	}
	per, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if per < 1 {
		per = 20
	}
	if per > 50 {
		per = 50
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	start := (page - 1) * per
	if start > len(out) {
		start = len(out)
	}
	end := start + per
	if end > len(out) {
		end = len(out)
	}
	result := collection("backup", out[start:end])
	pages := (len(out) + per - 1) / per
	if pages < 1 {
		pages = 1
	}
	result["meta"] = M{"backup_count": count, "pagination": M{"total": len(out), "count": end - start, "per_page": per, "current_page": page, "total_pages": pages, "links": M{}}}
	writeJSON(w, 200, result)
}
func (a *App) opSetting(ctx context.Context, key string) any {
	v, e := a.one(ctx, `SELECT value FROM settings WHERE key=$1`, key)
	if e != nil {
		return nil
	}
	return v["value"]
}
func opIgnored(v any) []string {
	var values []string
	switch x := v.(type) {
	case string:
		values = strings.Split(strings.ReplaceAll(x, "\r\n", "\n"), "\n")
	case []string:
		values = x
	case []any:
		for _, s := range x {
			values = append(values, str(s))
		}
	}
	out := []string{}
	for _, s := range values {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// createBackup is shared by client requests and schedule tasks. Its advisory lock
// serializes quota checks without holding row locks during the daemon request.
func (a *App) operationsLock(ctx context.Context, key int64) (pgx.Tx, error) {
	for {
		tx, err := a.DB.Begin(ctx)
		if err != nil {
			return nil, err
		}
		var locked bool
		err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, key).Scan(&locked)
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, err
		}
		if locked {
			return tx, nil
		}
		_ = tx.Rollback(ctx)
		timer := time.NewTimer(20 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
func (a *App) createBackup(ctx context.Context, s, d M) (M, error) {
	tx, e := a.operationsLock(ctx, num(s["id"]))
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	current, e := a.one(ctx, `SELECT * FROM servers WHERE id=$1`, num(s["id"]))
	if e != nil {
		return nil, e
	}
	s = current
	periodValue, limitValue := a.opSetting(ctx, "backups.throttles.period"), a.opSetting(ctx, "backups.throttles.limit")
	period, limit := int64(600), int64(2)
	if periodValue != nil {
		period = num(periodValue)
	}
	if limitValue != nil {
		limit = num(limitValue)
	}
	if period > 0 {
		recent, e := a.one(ctx, `SELECT count(*) AS count FROM backups WHERE server_id=$1 AND (is_successful OR completed_at IS NULL) AND created_at>=now()-($2::bigint*interval '1 second')`, num(s["id"]), period)
		if e != nil {
			return nil, e
		}
		if num(recent["count"]) >= limit {
			return nil, &APIError{Status: 429, Code: "TooManyBackupsException", Detail: fmt.Sprintf("Only %d backups may be created within %d seconds", limit, period)}
		}
	}
	if num(s["backup_limit"]) <= 0 {
		return nil, bad("Backups are disabled for this server")
	}
	c, e := a.one(ctx, `SELECT count(*) AS count FROM backups WHERE server_id=$1 AND deleted_at IS NULL AND (is_successful OR completed_at IS NULL)`, num(s["id"]))
	if e != nil {
		return nil, e
	}
	if num(c["count"]) >= num(s["backup_limit"]) {
		if !boolean(d["truncate"]) {
			return nil, bad("The server backup limit has been reached")
		}
		old, e := a.one(ctx, `SELECT * FROM backups WHERE server_id=$1 AND deleted_at IS NULL AND is_successful AND NOT is_locked AND completed_at IS NOT NULL ORDER BY created_at,id LIMIT 1`, num(s["id"]))
		if e != nil {
			return nil, bad("The backup limit is reached and no unlocked backup can be removed")
		}
		if e = a.deleteBackup(ctx, s, old); e != nil {
			return nil, e
		}
	}
	disk := opDefault(str(a.opSetting(ctx, "backups.default")), "wings")
	if disk != "wings" && disk != "s3" {
		return nil, bad("Unsupported backup adapter")
	}
	if disk == "s3" {
		if _, _, e = a.s3Client(ctx); e != nil {
			return nil, e
		}
	}
	name := strings.TrimSpace(str(d["name"]))
	if name == "" {
		name = "Backup at " + time.Now().Format("2006-01-02 15:04:05")
	}
	if len(name) > 191 {
		return nil, bad("Backup name must be at most 191 characters")
	}
	ignored := opIgnored(d["ignored"])
	b, e := a.insert(ctx, "backups", M{"uuid": newUUID(), "server_id": s["id"], "name": name, "disk": disk, "ignored_files": ignored, "is_locked": boolean(d["is_locked"]), "is_successful": false, "bytes": int64(0)})
	if e != nil {
		return nil, e
	}
	resp, e := a.daemonServer(ctx, s, "POST", "/backup", M{"adapter": disk, "uuid": b["uuid"], "ignore": strings.Join(ignored, "\n")})
	if e != nil {
		_, _ = a.update(ctx, "backups", num(b["id"]), M{"completed_at": now(), "is_successful": false})
		return nil, e
	}
	resp.Body.Close()
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return b, nil
}
func (a *App) deleteBackup(ctx context.Context, s, b M) error {
	if boolean(b["is_locked"]) && boolean(b["is_successful"]) && b["completed_at"] != nil {
		return bad("A locked backup cannot be deleted")
	}
	if str(b["disk"]) == "s3" {
		if e := a.deleteS3Backup(ctx, s, b); e != nil {
			return e
		}
	} else {
		resp, e := a.daemonServer(ctx, s, "DELETE", "/backup/"+url.PathEscape(str(b["uuid"])), nil)
		if e != nil {
			var api *APIError
			if !errors.As(e, &api) || api.Status != 404 {
				return e
			}
		} else {
			resp.Body.Close()
		}
	}
	return a.exec(ctx, `UPDATE backups SET deleted_at=now(),updated_at=now() WHERE id=$1 AND server_id=$2`, num(b["id"]), num(s["id"]))
}
func (a *App) clientBackup(w http.ResponseWriter, r *http.Request) {
	action := opLast(r)
	perm := "backup.read"
	if r.Method == "DELETE" || action == "lock" {
		perm = "backup.delete"
	} else if action == "download" {
		perm = "backup.download"
	} else if action == "restore" {
		perm = "backup.restore"
	}
	s, e := a.server(r, perm)
	if e != nil {
		fail(w, e)
		return
	}
	b, e := a.one(r.Context(), `SELECT * FROM backups WHERE server_id=$1 AND uuid=$2 AND deleted_at IS NULL`, num(s["id"]), r.PathValue("backup"))
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "DELETE" {
		if e = a.deleteBackup(r.Context(), s, b); e != nil {
			fail(w, e)
			return
		}
		a.opAudit(r, s, "server:backup.delete", M{"backup": b["uuid"], "name": b["name"], "failed": !boolean(b["is_successful"])})
		w.WriteHeader(204)
		return
	}
	switch action {
	case "lock":
		b, e = a.update(r.Context(), "backups", num(b["id"]), M{"is_locked": !boolean(b["is_locked"])})
		if e != nil {
			fail(w, e)
			return
		}
		event := "server:backup.unlock"
		if boolean(b["is_locked"]) {
			event = "server:backup.lock"
		}
		a.opAudit(r, s, event, M{"backup": b["uuid"], "name": b["name"]})
	case "download":
		if !boolean(b["is_successful"]) || b["completed_at"] == nil {
			fail(w, bad("This backup has not completed successfully"))
			return
		}
		u, e := a.user(r)
		if e != nil {
			fail(w, e)
			return
		}
		link, e := a.backupDownloadURL(r.Context(), s, b, u)
		if e != nil {
			fail(w, e)
			return
		}
		a.opAudit(r, s, "server:backup.download", M{"backup": b["uuid"], "name": b["name"]})
		writeJSON(w, 200, item("signed_url", M{"url": link}))
		return
	case "restore":
		d, e := decode(r)
		if e != nil {
			fail(w, e)
			return
		}
		if str(s["status"]) != "" || !boolean(b["is_successful"]) || b["completed_at"] == nil {
			fail(w, bad("The server or backup is not in a state that permits restoration"))
			return
		}
		var link string
		if str(b["disk"]) == "s3" {
			link, e = a.s3BackupDownload(r.Context(), s, b, true)
			if e != nil {
				fail(w, e)
				return
			}
		}
		tag, e := a.DB.Exec(r.Context(), `UPDATE servers SET status='restoring_backup',updated_at=now() WHERE id=$1 AND status IS NULL`, num(s["id"]))
		if e != nil {
			fail(w, e)
			return
		}
		if tag.RowsAffected() != 1 {
			fail(w, bad("The server is already busy"))
			return
		}
		resp, e := a.daemonServer(r.Context(), s, "POST", "/backup/"+url.PathEscape(str(b["uuid"]))+"/restore", M{"adapter": b["disk"], "truncate_directory": boolean(d["truncate"]), "download_url": link})
		if e != nil {
			_ = a.exec(r.Context(), `UPDATE servers SET status=NULL WHERE id=$1 AND status='restoring_backup'`, num(s["id"]))
			fail(w, e)
			return
		}
		resp.Body.Close()
		a.opAudit(r, s, "server:backup.restore", M{"backup": b["uuid"], "name": b["name"], "truncate": boolean(d["truncate"])})
		w.WriteHeader(204)
		return
	}
	writeJSON(w, 200, item("backup", opBackupTransform(b)))
}
func (a *App) backupDownloadURL(ctx context.Context, s, b, u M) (string, error) {
	if str(b["disk"]) == "s3" {
		return a.s3BackupURL(ctx, s, b)
	}
	if str(b["disk"]) != "wings" {
		return "", bad("Unknown backup adapter")
	}
	n, e := a.node(ctx, num(s["node_id"]))
	if e != nil {
		return "", e
	}
	token, e := a.nodeJWT(n, u, M{"server_uuid": s["uuid"], "backup_uuid": b["uuid"]}, "backup-download", 15*time.Minute)
	if e != nil {
		return "", e
	}
	return fmt.Sprintf("/api/wings/%d/download/backup?token=%s", num(n["id"]), url.QueryEscape(token)), nil
}

func opAllocation(m, s M) M {
	return M{"id": m["id"], "ip": m["ip"], "ip_alias": m["ip_alias"], "port": m["port"], "notes": m["notes"], "is_default": num(m["id"]) == num(s["allocation_id"])}
}
func (a *App) clientAllocations(w http.ResponseWriter, r *http.Request) {
	action := opLast(r)
	perm := "allocation.read"
	if r.Method == "POST" {
		perm = "allocation.update"
		if r.PathValue("allocation") == "" {
			perm = "allocation.create"
		}
	} else if r.Method == "DELETE" {
		perm = "allocation.delete"
	}
	s, e := a.server(r, perm)
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "GET" {
		rows, e := a.query(r.Context(), `SELECT * FROM allocations WHERE server_id=$1 ORDER BY id`, num(s["id"]))
		if e != nil {
			fail(w, e)
			return
		}
		out := []M{}
		for _, m := range rows {
			out = append(out, opAllocation(m, s))
		}
		writeJSON(w, 200, collection("allocation", out))
		return
	}
	if r.PathValue("allocation") == "" {
		a.clientAssignAllocation(w, r, s)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("allocation"), 10, 64)
	m, e := a.one(r.Context(), `SELECT * FROM allocations WHERE id=$1 AND server_id=$2`, id, num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	if r.Method == "DELETE" {
		if num(s["allocation_limit"]) == 0 || num(s["allocation_id"]) == id {
			fail(w, bad("The primary allocation cannot be removed, and allocation management must be enabled"))
			return
		}
		if e = a.exec(r.Context(), `UPDATE allocations SET server_id=NULL,notes=NULL WHERE id=$1 AND server_id=$2`, id, num(s["id"])); e != nil {
			fail(w, e)
			return
		}
		if e = a.syncServer(r.Context(), s); e != nil {
			_ = a.exec(r.Context(), `UPDATE allocations SET server_id=$1,notes=$2 WHERE id=$3`, num(s["id"]), m["notes"], id)
			fail(w, e)
			return
		}
		a.opAudit(r, s, "server:allocation.delete", M{"allocation": str(m["ip"]) + ":" + str(m["port"])})
		w.WriteHeader(204)
		return
	}
	if action == "primary" {
		old := s["allocation_id"]
		s, e = a.update(r.Context(), "servers", num(s["id"]), M{"allocation_id": id})
		if e != nil {
			fail(w, e)
			return
		}
		if e = a.syncServer(r.Context(), s); e != nil {
			_, _ = a.update(r.Context(), "servers", num(s["id"]), M{"allocation_id": old})
			fail(w, e)
			return
		}
		a.opAudit(r, s, "server:allocation.primary", M{"allocation": str(m["ip"]) + ":" + str(m["port"])})
	} else {
		d, e := decode(r)
		if e != nil {
			fail(w, e)
			return
		}
		if len(str(d["notes"])) > 255 {
			fail(w, bad("notes must be at most 255 characters"))
			return
		}
		old := m["notes"]
		m, e = a.update(r.Context(), "allocations", id, M{"notes": d["notes"]})
		if e != nil {
			fail(w, e)
			return
		}
		if !reflect.DeepEqual(old, m["notes"]) {
			a.opAudit(r, s, "server:allocation.notes", M{"allocation": str(m["ip"]) + ":" + str(m["port"]), "old": old, "new": m["notes"]})
		}
	}
	writeJSON(w, 200, item("allocation", opAllocation(m, s)))
}
func (a *App) clientAssignAllocation(w http.ResponseWriter, r *http.Request, s M) {
	ctx := r.Context()
	if !boolean(a.opSetting(ctx, "pterodactyl:client_features:allocations:enabled")) {
		fail(w, bad("Automatic allocation assignment is disabled"))
		return
	}
	tx, e := a.operationsLock(ctx, -num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	c, e := a.one(ctx, `SELECT count(*) AS count FROM allocations WHERE server_id=$1`, num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	if num(c["count"]) >= num(s["allocation_limit"]) {
		fail(w, bad("The server allocation limit has been reached"))
		return
	}
	primary, e := a.one(ctx, `SELECT ip FROM allocations WHERE id=$1 AND server_id=$2`, num(s["allocation_id"]), num(s["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	rows, e := a.query(ctx, `UPDATE allocations SET server_id=$1 WHERE id=(SELECT id FROM allocations WHERE node_id=$2 AND ip=$3 AND server_id IS NULL ORDER BY random() FOR UPDATE SKIP LOCKED LIMIT 1) AND server_id IS NULL RETURNING *`, num(s["id"]), num(s["node_id"]), str(primary["ip"]))
	if e != nil {
		fail(w, e)
		return
	}
	created := false
	if len(rows) == 0 {
		created = true
		start, end := num(a.opSetting(ctx, "pterodactyl:client_features:allocations:range_start")), num(a.opSetting(ctx, "pterodactyl:client_features:allocations:range_end"))
		if start == 0 {
			start = 25565
		}
		if end == 0 {
			end = 26000
		}
		if start < 1 || end > 65535 || start > end {
			fail(w, bad("Automatic allocation port range is invalid"))
			return
		}
		for attempts := 0; attempts < 3 && len(rows) == 0; attempts++ {
			rows, e = a.query(ctx, `INSERT INTO allocations(node_id,server_id,ip,port) SELECT $1,$2,$3,p FROM generate_series($4::integer,$5::integer) p WHERE NOT EXISTS(SELECT 1 FROM allocations WHERE node_id=$1 AND ip=$3 AND port=p) ORDER BY random() LIMIT 1 ON CONFLICT(node_id,ip,port) DO NOTHING RETURNING *`, num(s["node_id"]), num(s["id"]), str(primary["ip"]), start, end)
			if e != nil {
				fail(w, e)
				return
			}
		}
		if len(rows) == 0 {
			fail(w, bad("No free ports are available in the automatic allocation range"))
			return
		}
	}
	m := rows[0]
	if e = a.syncServer(ctx, s); e != nil {
		if created {
			_ = a.exec(ctx, `DELETE FROM allocations WHERE id=$1`, num(m["id"]))
		} else {
			_ = a.exec(ctx, `UPDATE allocations SET server_id=NULL WHERE id=$1`, num(m["id"]))
		}
		fail(w, e)
		return
	}
	if e = tx.Commit(ctx); e != nil {
		fail(w, e)
		return
	}
	a.opAudit(r, s, "server:allocation.create", M{"allocation": str(m["ip"]) + ":" + str(m["port"])})
	writeJSON(w, 200, item("allocation", opAllocation(m, s)))
}

func opVariable(m M) M {
	out := M{"name": m["name"], "description": m["description"], "env_variable": m["env_variable"], "default_value": m["default_value"], "server_value": m["server_value"], "is_editable": boolean(m["user_editable"]), "rules": m["rules"]}
	if _, secret := m["secret"]; secret {
		out["secret"] = boolean(m["secret"])
		out["configured"] = boolean(m["configured"])
	}
	for _, key := range []string{"secret_configured", "is_overridden", "can_reset"} {
		if v, ok := m[key]; ok {
			out[key] = v
		}
	}
	return out
}
func (a *App) clientStartup(w http.ResponseWriter, r *http.Request) {
	perm := "startup.read"
	if r.Method == "PUT" {
		perm = "startup.update"
	}
	s, e := a.server(r, perm)
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	rows, e := a.query(ctx, `SELECT ev.*,sv.id IS NOT NULL AS is_overridden,COALESCE(sv.variable_value,ev.default_value) AS server_value FROM egg_variables ev LEFT JOIN server_variables sv ON sv.variable_id=ev.id AND sv.server_id=$1 WHERE ev.egg_id=$2 ORDER BY ev.id`, num(s["id"]), num(s["egg_id"]))
	if e != nil {
		fail(w, e)
		return
	}
	var changed M
	if e = a.maskIntegrationVariables(ctx, num(s["id"]), rows); e != nil {
		fail(w, e)
		return
	}
	if e = a.steamCatalogMaskVariables(ctx, s, rows); e != nil {
		fail(w, e)
		return
	}
	if e = a.annotateStartupFields(ctx, s, rows); e != nil {
		fail(w, e)
		return
	}
	if r.Method == "PUT" {
		raw, e := decodeRaw(r)
		if e != nil {
			fail(w, e)
			return
		}
		rawValue := raw["value"]
		d := normalizeInput(raw, "").(M)
		if reset, ok := d["reset"]; ok {
			if _, valid := reset.(bool); !valid {
				fail(w, bad("reset must be a boolean"))
				return
			}
		}
		if _, ok := d["value"]; !ok && !boolean(d["reset"]) {
			fail(w, bad("value must be present"))
			return
		}
		for _, v := range rows {
			if str(v["env_variable"]) == str(d["key"]) && boolean(v["user_viewable"]) {
				changed = v
				break
			}
		}
		if changed == nil {
			fail(w, bad("The environment variable does not exist"))
			return
		}
		if !boolean(changed["user_editable"]) {
			fail(w, bad("The environment variable is read-only"))
			return
		}
		if e = a.validateClusterioStartupChange(ctx, s, changed, rows, d); e != nil {
			fail(w, e)
			return
		}
		if boolean(d["reset"]) || boolean(changed["secret"]) {
			a.saveStartupField(w, r, s, changed, d, rawValue)
			return
		}
		// Laravel validates the field named "value" against the actual request
		// body here. Stored egg variables are not dependency fields in this API.
		validationEnvironment := M{"__egg_validation_data": d, "__egg_variable": "value"}
		if e = a.validateEggValue(ctx, d["value"], true, str(changed["rules"]), validationEnvironment); e != nil {
			fail(w, e)
			return
		}
		old := changed["server_value"]
		value := eggEnvironmentString(d["value"])
		handled, bridgeErr := a.steamCatalogUpdateVariable(ctx, s, changed, value)
		if bridgeErr != nil {
			fail(w, bridgeErr)
			return
		}
		if handled {
			a.opAudit(r, s, "server:startup.edit", M{"variable": d["key"], "configured": value != ""})
		} else {
			if e = a.exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3) ON CONFLICT(server_id,variable_id) DO UPDATE SET variable_value=EXCLUDED.variable_value,updated_at=now()`, num(s["id"]), num(changed["id"]), value); e != nil {
				fail(w, e)
				return
			}
			if e = a.syncServer(ctx, s); e != nil {
				_ = a.exec(ctx, `UPDATE server_variables SET variable_value=$1 WHERE server_id=$2 AND variable_id=$3`, str(old), num(s["id"]), num(changed["id"]))
				fail(w, e)
				return
			}
			changed["server_value"] = value
			if str(old) != value {
				a.opAudit(r, s, "server:startup.edit", M{"variable": d["key"], "old": old, "new": value})
			}
		}
		changed["is_overridden"] = true
		if e = a.annotateStartupFields(ctx, s, []M{changed}); e != nil {
			fail(w, e)
			return
		}
	}
	egg, e := a.serverEffectiveEgg(ctx, s)
	if e != nil {
		fail(w, e)
		return
	}
	baseStartup, javaDisplay := a.javaReadable(ctx, egg, s, true)
	startup := baseStartup
	for _, v := range rows {
		value := str(v["server_value"])
		if !boolean(v["user_viewable"]) || boolean(v["secret"]) {
			value = "[hidden]"
		}
		startup = strings.ReplaceAll(startup, "{{"+str(v["env_variable"])+"}}", value)
	}
	if changed != nil {
		startup = baseStartup
		for _, v := range rows {
			value := str(v["server_value"])
			if num(v["id"]) == num(changed["id"]) {
				value = str(changed["server_value"])
			}
			if !boolean(v["user_viewable"]) || boolean(v["secret"]) {
				value = "[hidden]"
			}
			startup = strings.ReplaceAll(startup, "{{"+str(v["env_variable"])+"}}", value)
		}
	}
	startup = strings.ReplaceAll(startup, "{{SERVER_MEMORY}}", str(s["memory"]))
	if allocation, err := a.one(ctx, `SELECT ip,port FROM allocations WHERE id=$1`, num(s["allocation_id"])); err == nil {
		startup = strings.ReplaceAll(startup, "{{SERVER_IP}}", str(allocation["ip"]))
		startup = strings.ReplaceAll(startup, "{{SERVER_PORT}}", str(allocation["port"]))
	}
	meta := M{"startup_command": maskStartupArguments(startup), "raw_startup_command": maskStartupArguments(str(s["startup"])), "raw_startup_is_template": true, "java_managed": javaDisplay["java_managed"], "java_effective_error": javaDisplay["java_effective_error"], "docker_images": egg["docker_images"], "applies": "next_start"}
	if changed != nil {
		out := item("egg_variable", opVariable(changed))
		out["meta"] = meta
		writeJSON(w, 200, out)
		return
	}
	out := []M{}
	for _, v := range rows {
		if boolean(v["user_viewable"]) {
			out = append(out, opVariable(v))
		}
	}
	result := collection("egg_variable", out)
	result["meta"] = meta
	writeJSON(w, 200, result)
}
func (a *App) clientSettings(w http.ResponseWriter, r *http.Request) {
	op := opLast(r)
	perm := "settings.rename"
	if op == "reinstall" {
		perm = "settings.reinstall"
	} else if op == "docker-image" {
		perm = "startup.docker-image"
	}
	s, e := a.server(r, perm)
	if e != nil {
		fail(w, e)
		return
	}
	if op == "reinstall" {
		if a.managedSteamReinstall(w, r, s, http.StatusAccepted) {
			return
		}
		if (str(s["status"]) != "" && str(s["status"]) != "reinstall_failed") || strings.HasPrefix(str(s["installation_id"]), "pending:") {
			fail(w, bad("The server must finish its current operation before reinstalling"))
			return
		}
		cycle := "pending:reinstall:" + newUUID()
		if _, e = a.one(r.Context(), `UPDATE servers SET status='installing',installation_id=$2,updated_at=NOW() WHERE id=$1 AND (status IS NULL OR status='reinstall_failed') AND installation_id IS NOT DISTINCT FROM $3 AND NOT EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL) RETURNING *`, num(s["id"]), cycle, s["installation_id"]); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				e = &APIError{Status: 409, Code: "ServerStateConflict", Detail: "The server is already processing another operation"}
			}
			fail(w, e)
			return
		}
		resp, e := a.daemonServer(r.Context(), s, "POST", "/reinstall", M{})
		if e != nil {
			_ = a.exec(r.Context(), `UPDATE servers SET status=$2,installation_id=$3,installed_at=$4,updated_at=NOW() WHERE id=$1 AND installation_id=$5 AND status='installing'`, num(s["id"]), s["status"], s["installation_id"], s["installed_at"], cycle)
			fail(w, e)
			return
		}
		resp.Body.Close()
		a.opAudit(r, s, "server:reinstall", M{})
		w.WriteHeader(202)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	update := M{}
	if op == "rename" {
		name := strings.TrimSpace(str(d["name"]))
		if name == "" || len(name) > 191 {
			fail(w, bad("name is required and must be at most 191 characters"))
			return
		}
		update["name"] = name
		if desc, ok := d["description"]; ok {
			update["description"] = str(desc)
		}
	} else {
		javaEgg, err := a.effectiveEgg(r.Context(), num(s["egg_id"]))
		if err != nil {
			fail(w, err)
			return
		}
		if javaEnabled(javaEgg, asMap(s["java_config"])) {
			u, err := a.user(r)
			if err != nil {
				fail(w, err)
				return
			}
			if !a.can(r.Context(), u, s, "startup.update") {
				fail(w, forbidden())
				return
			}
			runtimes, err := a.javaRuntimes(r.Context())
			if err != nil {
				fail(w, err)
				return
			}
			config, err := javaNormalize(asMap(s["java_config"]), false)
			if err != nil {
				fail(w, err)
				return
			}
			if len(config) == 0 {
				config, _ = javaNormalize(M{"enabled": true}, false)
			}
			matched := false
			for _, runtime := range runtimes {
				if boolean(runtime["enabled"]) && runtime["image"] == d["docker_image"] {
					config["runtime_id"] = runtime["id"]
					matched = true
					break
				}
			}
			if !matched {
				fail(w, bad("Select an enabled administrator-approved Java runtime image."))
				return
			}
			effective, err := a.javaResolve(r.Context(), javaEgg, config, num(s["memory"]))
			if err != nil {
				fail(w, err)
				return
			}
			if _, err = a.javaSave(r.Context(), s, javaEgg, config, effective); err != nil {
				fail(w, err)
				return
			}
			a.opAudit(r, s, "server:startup.image", M{"old": s["image"], "new": effective["image"]})
			w.WriteHeader(204)
			return
		}
		egg, e := a.one(r.Context(), `SELECT docker_images FROM eggs WHERE id=$1`, num(s["egg_id"]))
		if e != nil {
			fail(w, e)
			return
		}
		currentAllowed, newAllowed := false, false
		for _, img := range asMap(egg["docker_images"]) {
			if str(img) == str(s["image"]) {
				currentAllowed = true
			}
			if str(img) == str(d["docker_image"]) {
				newAllowed = true
			}
		}
		if !currentAllowed || !newAllowed {
			fail(w, bad("The selected image must be an allowed egg image and the current image must not be an administrator override"))
			return
		}
		update["image"] = str(d["docker_image"])
	}
	updated, e := a.update(r.Context(), "servers", num(s["id"]), update)
	if e != nil {
		fail(w, e)
		return
	}
	if e = a.syncServer(r.Context(), updated); e != nil {
		old := M{}
		for k := range update {
			old[k] = s[k]
		}
		_, _ = a.update(r.Context(), "servers", num(s["id"]), old)
		fail(w, e)
		return
	}
	if op == "rename" {
		if str(s["name"]) != str(updated["name"]) {
			a.opAudit(r, s, "server:settings.rename", M{"old": s["name"], "new": updated["name"]})
		}
		if str(s["description"]) != str(updated["description"]) {
			a.opAudit(r, s, "server:settings.description", M{"old": s["description"], "new": updated["description"]})
		}
	} else if str(s["image"]) != str(updated["image"]) {
		a.opAudit(r, s, "server:startup.image", M{"old": s["image"], "new": updated["image"]})
	}
	w.WriteHeader(204)
}

func (a *App) registerS3Operations(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/remote/backups/{backup}", a.remoteS3Upload)
}

// PruneStaleBackups releases quota consumed by backups whose daemon never
// reported completion. The application worker calls this periodically.
func (a *App) PruneStaleBackups(ctx context.Context) (int, error) {
	ageValue := a.opSetting(ctx, "backups.prune_age")
	age := int64(360)
	if ageValue != nil {
		age = num(ageValue)
	}
	if age <= 0 {
		return 0, nil
	}
	rows, err := a.query(ctx, `UPDATE backups SET is_successful=false,is_locked=false,completed_at=now(),updated_at=now() WHERE deleted_at IS NULL AND completed_at IS NULL AND created_at<=now()-($1::bigint*interval '1 minute') RETURNING uuid,server_id,name`, age)
	if err != nil {
		return 0, err
	}
	for _, b := range rows {
		_ = a.audit(ctx, 0, num(b["server_id"]), "server:backup.fail", M{"backup": b["uuid"], "name": b["name"], "reason": "completion_timeout"})
	}
	return len(rows), nil
}

func (a *App) s3Client(ctx context.Context) (*s3.Client, string, error) {
	m := asMap(a.opSetting(ctx, "backups.s3"))
	bucket := str(m["bucket"])
	if bucket == "" {
		return nil, "", bad("S3 backups require backups.s3 bucket and credentials settings")
	}
	region := opDefault(str(m["region"]), "us-east-1")
	opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if str(m["access_key_id"]) != "" {
		secret := str(m["secret_access_key"])
		if strings.HasPrefix(secret, "enc:v1:") {
			var err error
			secret, err = a.unseal(secret)
			if err != nil {
				return nil, "", err
			}
		}
		session := str(m["session_token"])
		if strings.HasPrefix(session, "enc:v1:") {
			var err error
			session, err = a.unseal(session)
			if err != nil {
				return nil, "", err
			}
		}
		opts = append(opts, awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(str(m["access_key_id"]), secret, session)))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, "", err
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = boolean(m["path_style"])
		o.UseAccelerate = boolean(m["use_accelerate_endpoint"])
		if endpoint := str(m["endpoint"]); endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	})
	return client, bucket, nil
}
func opS3Key(s, b M) string { return str(s["uuid"]) + "/" + str(b["uuid"]) + ".tar.gz" }
func (a *App) remoteS3Upload(w http.ResponseWriter, r *http.Request) {
	n, err := a.remoteNode(r)
	if err != nil {
		fail(w, err)
		return
	}
	size, err := strconv.ParseInt(r.URL.Query().Get("size"), 10, 64)
	if err != nil || size <= 0 {
		fail(w, bad("A positive size query parameter is required"))
		return
	}
	b, err := a.one(r.Context(), `SELECT b.*,s.uuid AS server_uuid,s.node_id FROM backups b JOIN servers s ON s.id=b.server_id WHERE b.uuid=$1 AND b.deleted_at IS NULL`, r.PathValue("backup"))
	if err != nil {
		fail(w, err)
		return
	}
	if num(n["id"]) != num(b["node_id"]) {
		fail(w, forbidden())
		return
	}
	tx, err := a.operationsLock(r.Context(), (int64(1)<<62)+num(b["id"]))
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	current, err := a.one(r.Context(), `SELECT completed_at,upload_id,deleted_at FROM backups WHERE id=$1`, num(b["id"]))
	if err != nil {
		fail(w, err)
		return
	}
	if current["deleted_at"] != nil {
		fail(w, notFound())
		return
	}
	b["completed_at"], b["upload_id"] = current["completed_at"], current["upload_id"]
	if b["completed_at"] != nil || str(b["upload_id"]) != "" {
		fail(w, &APIError{Status: 409, Code: "ConflictException", Detail: "This backup already has an upload or is completed"})
		return
	}
	if str(b["disk"]) != "s3" {
		fail(w, bad("This backup does not use S3 storage"))
		return
	}
	client, bucket, err := a.s3Client(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	key := str(b["server_uuid"]) + "/" + str(b["uuid"]) + ".tar.gz"
	partSize := num(asMap(a.opSetting(r.Context(), "backups.s3"))["part_size"])
	if partSize <= 0 {
		partSize = 5 * 1024 * 1024 * 1024
	}
	if partSize < 5*1024*1024 {
		partSize = 5 * 1024 * 1024
	}
	if size > partSize*10000 {
		partSize = (size + 9999) / 10000
	}
	if partSize > 5*1024*1024*1024 {
		fail(w, bad("Backup exceeds S3 multipart size limits"))
		return
	}
	s3settings := asMap(a.opSetting(r.Context(), "backups.s3"))
	result, err := client.CreateMultipartUpload(r.Context(), &s3.CreateMultipartUploadInput{Bucket: aws.String(bucket), Key: aws.String(key), ContentType: aws.String("application/x-gzip"), StorageClass: types.StorageClass(str(s3settings["storage_class"]))})
	if err != nil {
		fail(w, err)
		return
	}
	parts := []string{}
	signingClient := client
	if endpoint := str(s3settings["daemon_endpoint"]); endpoint != "" {
		options := client.Options()
		options.BaseEndpoint = aws.String(endpoint)
		signingClient = s3.New(options)
	}
	presigner := s3.NewPresignClient(signingClient)
	minutes := num(a.opSetting(r.Context(), "backups.presigned_url_lifespan"))
	if minutes <= 0 {
		minutes = 60
	}
	if minutes > 10080 {
		minutes = 10080
	}
	for i := int64(0); i < (size+partSize-1)/partSize; i++ {
		signed, e := presigner.PresignUploadPart(r.Context(), &s3.UploadPartInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: result.UploadId, PartNumber: aws.Int32(int32(i + 1))}, s3.WithPresignExpires(time.Duration(minutes)*time.Minute))
		if e != nil {
			_, _ = client.AbortMultipartUpload(r.Context(), &s3.AbortMultipartUploadInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: result.UploadId})
			fail(w, e)
			return
		}
		parts = append(parts, signed.URL)
	}
	if _, err = a.update(r.Context(), "backups", num(b["id"]), M{"upload_id": aws.ToString(result.UploadId)}); err != nil {
		_, _ = client.AbortMultipartUpload(r.Context(), &s3.AbortMultipartUploadInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: result.UploadId})
		fail(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, M{"parts": parts, "part_size": partSize})
}
func (a *App) completeS3Backup(ctx context.Context, b M, parts []any, successful bool) error {
	if str(b["disk"]) != "s3" {
		return nil
	}
	if str(b["upload_id"]) == "" {
		if !successful {
			return nil
		}
		return bad("Cannot complete S3 backup without upload_id")
	}
	s, err := a.one(ctx, `SELECT uuid FROM servers WHERE id=$1`, num(b["server_id"]))
	if err != nil {
		return err
	}
	client, bucket, err := a.s3Client(ctx)
	if err != nil {
		return err
	}
	key := opS3Key(s, b)
	if !successful {
		_, err = client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: aws.String(str(b["upload_id"]))})
		return err
	}
	completed := []types.CompletedPart{}
	if len(parts) == 0 {
		pager := s3.NewListPartsPaginator(client, &s3.ListPartsInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: aws.String(str(b["upload_id"]))})
		for pager.HasMorePages() {
			page, e := pager.NextPage(ctx)
			if e != nil {
				return e
			}
			for _, p := range page.Parts {
				completed = append(completed, types.CompletedPart{ETag: p.ETag, PartNumber: p.PartNumber})
			}
		}
	} else {
		for _, p := range parts {
			m := asMap(p)
			if str(m["etag"]) == "" || num(m["part_number"]) <= 0 {
				return bad("S3 parts require etag and part_number")
			}
			completed = append(completed, types.CompletedPart{ETag: aws.String(str(m["etag"])), PartNumber: aws.Int32(int32(num(m["part_number"])))})
		}
	}
	if len(completed) == 0 {
		return bad("S3 upload contains no completed parts")
	}
	sort.Slice(completed, func(i, j int) bool {
		return aws.ToInt32(completed[i].PartNumber) < aws.ToInt32(completed[j].PartNumber)
	})
	_, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: aws.String(str(b["upload_id"])), MultipartUpload: &types.CompletedMultipartUpload{Parts: completed}})
	return err
}
func (a *App) s3BackupURL(ctx context.Context, s, b M) (string, error) {
	return a.s3BackupDownload(ctx, s, b, false)
}
func (a *App) s3BackupDownload(ctx context.Context, s, b M, daemon bool) (string, error) {
	client, bucket, err := a.s3Client(ctx)
	if err != nil {
		return "", err
	}
	if daemon {
		if endpoint := str(asMap(a.opSetting(ctx, "backups.s3"))["daemon_endpoint"]); endpoint != "" {
			options := client.Options()
			options.BaseEndpoint = aws.String(endpoint)
			client = s3.New(options)
		}
	}
	signed, err := s3.NewPresignClient(client).PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(opS3Key(s, b))}, s3.WithPresignExpires(5*time.Minute))
	if err != nil {
		return "", err
	}
	return signed.URL, nil
}
func (a *App) deleteS3Backup(ctx context.Context, s, b M) error {
	client, bucket, err := a.s3Client(ctx)
	if err != nil {
		return err
	}
	key := opS3Key(s, b)
	if b["completed_at"] == nil && str(b["upload_id"]) != "" {
		if _, err = client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{Bucket: aws.String(bucket), Key: aws.String(key), UploadId: aws.String(str(b["upload_id"]))}); err != nil {
			return err
		}
	}
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	return err
}
