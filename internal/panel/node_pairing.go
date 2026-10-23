package panel

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func pairingHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func pairingBearer(r *http.Request) string {
	fields := strings.Fields(r.Header.Get("Authorization"))
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") || len(fields[1]) > 512 {
		return ""
	}
	return fields[1]
}
func (a *App) registerNodePairing(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/admin/node-enrollments", a.createNodeEnrollment)
	mux.HandleFunc("GET /api/admin/node-enrollments", a.listNodeEnrollments)
	mux.HandleFunc("POST /api/admin/node-enrollments/{session}/close", a.closeNodeEnrollment)
	mux.HandleFunc("POST /api/admin/node-requests/{request}/approve", a.approveNodeRequest)
	mux.HandleFunc("POST /api/admin/node-requests/{request}/reject", a.rejectNodeRequest)
	mux.HandleFunc("POST /api/admin/nodes/{node}/disconnect", a.disconnectNodeConnector)
	mux.HandleFunc("GET /api/admin/nodes/{node}/connection", a.nodeConnectionStatus)
	mux.HandleFunc("POST /api/admin/nodes/{node}/check", a.checkNodeConnection)
	mux.HandleFunc("POST /api/admin/nodes/{node}/reconnect", a.reconnectNode)
	mux.HandleFunc("POST /api/remote/connector/status", a.reportNodeStatus)
	mux.HandleFunc("POST /api/remote/enroll", a.requestNodeEnrollment)
	mux.HandleFunc("GET /api/remote/enroll/{request}", a.pollNodeEnrollment)
	mux.HandleFunc("POST /api/remote/enroll/{request}/complete", a.completeNodeEnrollment)
	mux.HandleFunc("GET /api/remote/connector", a.connectNodeConnector)
	mux.HandleFunc("GET /api/remote/connector/streams/{stream}", a.connectNodeStream)
	mux.HandleFunc("GET /install/node.sh", a.nodeInstaller)
	mux.HandleFunc("GET /downloads/{file}", a.nodeDownload)
}

func pairingPanelURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", bad("Use a Panel base URL without a path, credentials, query, or fragment.")
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if u.Scheme != "https" && !(u.Scheme == "http" && (host == "localhost" || ip != nil && ip.IsLoopback())) {
		return "", bad("Node pairing requires HTTPS. HTTP is allowed only for loopback development.")
	}
	return strings.TrimRight(u.String(), "/"), nil
}
func (a *App) createNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	a.createEnrollment(w, r, 0)
}
func (a *App) createEnrollment(w http.ResponseWriter, r *http.Request, recoveryID int64) {
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	maximum, minutes := num(d["max_nodes"]), num(d["expires_minutes"])
	var recovery any
	var recoveryName string
	if recoveryID > 0 {
		node, err := a.one(r.Context(), "SELECT * FROM nodes WHERE id=$1 AND connection_mode='outbound'", recoveryID)
		if err != nil {
			fail(w, err)
			return
		}
		maximum, recovery, recoveryName = 1, recoveryID, str(node["name"])
		d["location_id"] = node["location_id"]
	}
	if minutes == 0 {
		minutes = 30
	}
	if maximum < 0 || minutes < 1 || minutes > 1440 {
		fail(w, bad("Choose a nonnegative node limit and an expiry from 1 to 1440 minutes."))
		return
	}
	base, e := pairingPanelURL(a.panelPublicURL(r.Context()))
	if e != nil {
		fail(w, e)
		return
	}
	external := base
	if v, err := pairingPanelURL(a.Config.DaemonURL); err == nil {
		external = v
	}
	var location any
	if num(d["location_id"]) > 0 {
		location = num(d["location_id"])
		if _, e = a.one(r.Context(), "SELECT id FROM locations WHERE id=$1", location); e != nil {
			fail(w, bad("Choose an existing location."))
			return
		}
	}
	token := randomToken(32)
	id := newUUID()
	expires := time.Now().Add(time.Duration(minutes) * time.Minute)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if recoveryID > 0 {
		var locked int64
		_, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||'node-recovery:'||$1::text,0))", str(recoveryID))
		if e == nil {
			e = tx.QueryRow(r.Context(), "SELECT id FROM nodes WHERE id=$1 FOR UPDATE", recoveryID).Scan(&locked)
		}
		if e == nil {
			_, e = tx.Exec(r.Context(), "UPDATE node_enrollments SET closed=true WHERE recovery_node_id=$1 AND NOT closed", recoveryID)
		}
		if e == nil {
			_, e = tx.Exec(r.Context(), "UPDATE node_requests SET status='expired' WHERE session_id IN (SELECT id FROM node_enrollments WHERE recovery_node_id=$1) AND status='pending'", recoveryID)
		}
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), `INSERT INTO node_enrollments(id,token_hash,location_id,max_nodes,expires_at,recovery_node_id) VALUES($1,$2,$3,$4,$5,$6)`, id, pairingHash(token), location, maximum, expires, recovery)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 201, M{"id": id, "expires_at": expires, "max_nodes": maximum, "approved_count": 0, "closed": false, "recovery_node_id": recovery, "recovery_node_name": recoveryName, "connection_strings": M{"local": base + "#" + token, "external": external + "#" + token}, "install_command": nodeInstallCommand(base, recoveryID > 0), "install_commands": M{"local": nodeInstallCommand(base, recoveryID > 0), "external": nodeInstallCommand(external, recoveryID > 0)}, "start_command": "sudo voltra-node setup", "release_url": os.Getenv("NODE_RELEASE_URL")})
}
func (a *App) listNodeEnrollments(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	// Expired and closed enrollment requests cannot later become approved.
	_, e := a.DB.Exec(r.Context(), `UPDATE node_requests SET status='expired',connector_secret=NULL WHERE expires_at<=now() AND status IN ('pending','approved')`)
	if e != nil {
		fail(w, e)
		return
	}
	sessions, e := a.query(r.Context(), `SELECT e.id,e.expires_at,e.max_nodes,e.approved_count,e.closed OR e.expires_at<=now() AS closed,e.recovery_node_id,n.name AS recovery_node_name FROM node_enrollments e LEFT JOIN nodes n ON n.id=e.recovery_node_id ORDER BY e.created_at DESC LIMIT 100`)
	if e != nil {
		fail(w, e)
		return
	}
	requests, e := a.query(r.Context(), `SELECT r.id,r.session_id,r.hostname,r.platform,r.architecture,r.memory_mib,r.disk_mib,r.verification_code,r.remote_ip,r.status,r.node_id,r.created_at,e.recovery_node_id,n.name AS recovery_node_name FROM node_requests r JOIN node_enrollments e ON e.id=r.session_id LEFT JOIN nodes n ON n.id=e.recovery_node_id WHERE r.created_at>now()-interval '7 days' ORDER BY r.created_at DESC LIMIT 1000`)
	if e != nil {
		fail(w, e)
		return
	}
	for _, v := range requests {
		v["connected"] = a.connectors().connected(num(v["node_id"]))
		if num(v["node_id"]) > 0 {
			status, err := a.nodeReadiness(r.Context(), num(v["node_id"]), false)
			if err == nil {
				for _, key := range []string{"ready", "stage", "detail"} {
					v[key] = status[key]
				}
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, M{"sessions": sessions, "requests": requests})
}
func (a *App) closeNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	// Lock in the same order as enrollment and approval to serialize closing.
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	e = tx.QueryRow(r.Context(), `UPDATE node_enrollments SET closed=true,updated_at=now() WHERE id=$1 RETURNING id`, r.PathValue("session")).Scan(&id)
	if e == nil {
		_, e = tx.Exec(r.Context(), `UPDATE node_requests SET status='expired' WHERE session_id=$1 AND status='pending'`, id)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, M{"closed": true})
}
func (a *App) requestNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	token := str(d["token"])
	host := strings.TrimSpace(str(d["hostname"]))
	platform, arch := str(d["platform"]), str(d["architecture"])
	memory, disk := num(d["memory_mib"]), num(d["disk_mib"])
	if len(token) != 64 || host == "" || len(host) > 253 || (platform != "linux" && platform != "windows" && platform != "darwin") || (arch != "amd64" && arch != "arm64") || memory < 1 || memory > 1<<40 || disk < 1 || disk > 1<<50 {
		fail(w, bad("Provide a valid pairing token, hostname, platform, architecture and resource capacities."))
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var session string
	var expires time.Time
	var maximum, approved int64
	var recoveryID *int64
	e = tx.QueryRow(r.Context(), `SELECT id,expires_at,max_nodes,approved_count,recovery_node_id FROM node_enrollments WHERE token_hash=$1 AND NOT closed AND expires_at>now() FOR UPDATE`, pairingHash(token)).Scan(&session, &expires, &maximum, &approved, &recoveryID)
	if errors.Is(e, pgx.ErrNoRows) {
		fail(w, APIError{401, "InvalidPairingToken", "This pairing session is invalid, closed, or expired."})
		return
	}
	if e != nil {
		fail(w, e)
		return
	}
	if maximum > 0 && approved >= maximum {
		fail(w, bad("This pairing session has reached its node limit."))
		return
	}
	var pending int
	e = tx.QueryRow(r.Context(), `SELECT count(*) FROM node_requests WHERE session_id=$1 AND status='pending' AND expires_at>now()`, session).Scan(&pending)
	if e != nil {
		fail(w, e)
		return
	}
	if pending >= 128 {
		fail(w, APIError{429, "EnrollmentQueueFull", "Approve or reject waiting nodes before adding more."})
		return
	}
	requestToken, id, code := randomToken(32), newUUID(), strings.ToUpper(randomToken(4))
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	_, e = tx.Exec(r.Context(), `INSERT INTO node_requests(id,session_id,request_token_hash,hostname,platform,architecture,memory_mib,disk_mib,verification_code,remote_ip,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, session, pairingHash(requestToken), host, platform, arch, memory, disk, code, ip, expires)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 201, M{"id": id, "request_token": requestToken, "verification_code": code, "expires_at": expires, "recovery": recoveryID != nil})
}
func (a *App) authenticatedNodeRequest(r *http.Request) (M, error) {
	token := pairingBearer(r)
	if len(token) != 64 {
		return nil, unauthorizedKey()
	}
	row, e := a.one(r.Context(), `SELECT * FROM node_requests WHERE id=$1 AND request_token_hash=$2`, r.PathValue("request"), pairingHash(token))
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, unauthorizedKey()
	}
	return row, e
}
func (a *App) pollNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	row, e := a.authenticatedNodeRequest(r)
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	expires, ok := row["expires_at"].(time.Time)
	if !ok || !expires.After(time.Now()) {
		writeJSON(w, 200, M{"status": "expired"})
		return
	}
	out := M{"status": row["status"]}
	if str(row["status"]) == "approved" {
		session, err := a.one(r.Context(), "SELECT recovery_node_id FROM node_enrollments WHERE id=$1", row["session_id"])
		if err != nil {
			fail(w, err)
			return
		}
		out["recovery"] = num(session["recovery_node_id"]) > 0
		n, err := a.node(r.Context(), num(row["node_id"]))
		if err != nil {
			fail(w, err)
			return
		}
		credential, err := a.unseal(str(row["connector_secret"]))
		if err != nil {
			fail(w, err)
			return
		}
		config, err := a.nodeConfiguration(r.Context(), n)
		if err != nil {
			fail(w, err)
			return
		}
		// Wings only listens privately. Browser console/files are proxied by Panel.
		config["api"] = M{"host": "127.0.0.1", "port": 8080, "ssl": M{"enabled": false}, "upload_limit": n["upload_size"]}
		config["remote"] = strings.TrimRight(a.panelPublicURL(r.Context()), "/")
		out["node_id"], out["connector_token"], out["configuration"], out["panel_url"] = n["id"], credential, config, config["remote"]
	}
	writeJSON(w, 200, out)
}
func (a *App) completeNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	row, e := a.authenticatedNodeRequest(r)
	if e != nil {
		fail(w, e)
		return
	}
	if str(row["status"]) != "approved" && str(row["status"]) != "completed" {
		fail(w, bad("Only approved nodes can complete setup."))
		return
	}
	_, e = a.DB.Exec(r.Context(), `UPDATE node_requests SET status='completed',connector_secret=NULL,updated_at=now() WHERE id=$1`, row["id"])
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, M{"status": "completed"})
}
func (a *App) approveNodeRequest(w http.ResponseWriter, r *http.Request) {
	u, e := a.requireAdmin(r)
	if e != nil {
		fail(w, e)
		return
	}
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	ctx := r.Context()
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(ctx)
	// Session lock protects capacity against concurrent approvals and enrollment.
	var session string
	var preRecovery *int64
	e = tx.QueryRow(ctx, `SELECT r.session_id,e.recovery_node_id FROM node_requests r JOIN node_enrollments e ON e.id=r.session_id WHERE r.id=$1`, r.PathValue("request")).Scan(&session, &preRecovery)
	if e == nil && preRecovery != nil {
		_, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||'node-recovery:'||$1::text,0))", str(*preRecovery))
	}
	if e != nil {
		fail(w, e)
		return
	}
	var maximum, approved int64
	var closed bool
	var expiry time.Time
	var location *int64
	var recoveryID *int64
	e = tx.QueryRow(ctx, `SELECT max_nodes,approved_count,closed,expires_at,location_id,recovery_node_id FROM node_enrollments WHERE id=$1 FOR UPDATE`, session).Scan(&maximum, &approved, &closed, &expiry, &location, &recoveryID)
	if e != nil {
		fail(w, e)
		return
	}
	if closed || !expiry.After(time.Now()) || maximum > 0 && approved >= maximum {
		fail(w, bad("Enrollment is closed, expired, or full."))
		return
	}
	var status, hostname string
	var memory, disk int64
	var requestExpiry time.Time
	e = tx.QueryRow(ctx, `SELECT status,hostname,memory_mib,disk_mib,expires_at FROM node_requests WHERE id=$1 FOR UPDATE`, r.PathValue("request")).Scan(&status, &hostname, &memory, &disk, &requestExpiry)
	if e != nil {
		fail(w, e)
		return
	}
	if status != "pending" || !requestExpiry.After(time.Now()) {
		fail(w, bad("This node is no longer waiting for approval."))
		return
	}
	name := strings.TrimSpace(str(d["name"]))
	if name == "" {
		name = hostname
	}
	if len(name) > 253 {
		fail(w, bad("Node name is too long."))
		return
	}
	if location == nil {
		var loc int64
		e = tx.QueryRow(ctx, `INSERT INTO locations(short,long) VALUES('paired','Automatically paired nodes') ON CONFLICT(short) DO UPDATE SET short=EXCLUDED.short RETURNING id`).Scan(&loc)
		if e != nil {
			fail(w, e)
			return
		}
		location = &loc
	}
	daemonSecret, e := a.seal(randomToken(32))
	if e != nil {
		fail(w, e)
		return
	}
	connectorToken := randomToken(32)
	sealed, e := a.seal(connectorToken)
	if e != nil {
		fail(w, e)
		return
	}
	var nodeID int64
	if recoveryID != nil {
		nodeID = *recoveryID
		e = tx.QueryRow(ctx, `UPDATE nodes SET daemon_token_id=$2,daemon_token=$3,maintenance_mode=CASE WHEN (SELECT revoked FROM node_connectors WHERE node_id=nodes.id) THEN COALESCE((SELECT maintenance_before_revoke FROM node_connectors WHERE node_id=nodes.id),false) ELSE maintenance_mode END,updated_at=now() WHERE id=$1 AND connection_mode='outbound' RETURNING id`, nodeID, randomToken(8), daemonSecret).Scan(&nodeID)
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE node_requests SET status='revoked',connector_secret=NULL WHERE node_id=$1 AND status='approved'`, nodeID)
		}
	} else {
		e = tx.QueryRow(ctx, `INSERT INTO nodes(uuid,name,location_id,fqdn,scheme,memory,disk,daemon_token_id,daemon_token,connection_mode) VALUES($1,$2,$3,'127.0.0.1','http',$4,$5,$6,$7,'outbound') RETURNING id`, newUUID(), name, *location, memory, disk, randomToken(8), daemonSecret).Scan(&nodeID)
	}
	if e == nil {
		_, e = tx.Exec(ctx, `INSERT INTO node_connectors(node_id,token_hash) VALUES($1,$2) ON CONFLICT(node_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,revoked=false,setup_stage='starting',setup_detail='',updated_at=now()`, nodeID, pairingHash(connectorToken))
	}
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE node_requests SET status='approved',node_id=$2,connector_secret=$3,updated_at=now(),expires_at=now()+interval '1 day' WHERE id=$1`, r.PathValue("request"), nodeID, sealed)
	}
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE node_enrollments SET approved_count=approved_count+1,closed=(max_nodes>0 AND approved_count+1>=max_nodes),updated_at=now() WHERE id=$1`, session)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		fail(w, e)
		return
	}
	_ = a.audit(ctx, num(u["id"]), 0, "node:pairing.approved", M{"node_id": nodeID, "request_id": r.PathValue("request")})
	if recoveryID != nil {
		a.connectors().disconnect(nodeID)
	}
	writeJSON(w, 200, M{"status": "approved", "node_id": nodeID})
}
func (a *App) rejectNodeRequest(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	result, e := a.DB.Exec(r.Context(), `UPDATE node_requests SET status='rejected',connector_secret=NULL,updated_at=now() WHERE id=$1 AND status='pending'`, r.PathValue("request"))
	if e != nil {
		fail(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		fail(w, bad("This node is no longer waiting for approval."))
		return
	}
	writeJSON(w, 200, M{"status": "rejected"})
}
func (a *App) disconnectNodeConnector(w http.ResponseWriter, r *http.Request) {
	u, e := a.requireAdmin(r)
	if e != nil {
		fail(w, e)
		return
	}
	id := num(r.PathValue("node"))
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	result, e := tx.Exec(r.Context(), `UPDATE node_connectors SET maintenance_before_revoke=CASE WHEN revoked THEN maintenance_before_revoke ELSE (SELECT maintenance_mode FROM nodes WHERE id=$1) END,revoked=true,updated_at=now() WHERE node_id=$1`, id)
	if e != nil {
		fail(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		fail(w, notFound())
		return
	}
	// Also revoke native Wings callbacks and signed browser capabilities.
	sealed, e := a.seal(randomToken(32))
	if e == nil {
		_, e = tx.Exec(r.Context(), `UPDATE nodes SET daemon_token=$2,daemon_token_id=$3,maintenance_mode=true,updated_at=now() WHERE id=$1`, id, sealed, randomToken(8))
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), `UPDATE node_requests SET connector_secret=NULL,status='revoked' WHERE node_id=$1`, id)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.connectors().disconnect(id)
	_ = a.audit(r.Context(), num(u["id"]), 0, "node:pairing.revoked", M{"node_id": id})
	writeJSON(w, 200, M{"connected": false, "revoked": true})
}
func (a *App) nodeConnectionStatus(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	status, e := a.nodeReadiness(r.Context(), num(r.PathValue("node")), false)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, status)
}
func (a *App) connectorNode(ctx context.Context, token string) (int64, error) {
	if len(token) != 64 {
		return 0, unauthorizedKey()
	}
	var id int64
	e := a.DB.QueryRow(ctx, `SELECT node_id FROM node_connectors WHERE token_hash=$1 AND NOT revoked`, pairingHash(token)).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		return 0, unauthorizedKey()
	}
	return id, e
}
func (a *App) validConnector(ctx context.Context, id int64, token string) bool {
	var hash string
	e := a.DB.QueryRow(ctx, `SELECT token_hash FROM node_connectors WHERE node_id=$1 AND NOT revoked`, id).Scan(&hash)
	return e == nil && subtle.ConstantTimeCompare([]byte(hash), []byte(pairingHash(token))) == 1
}
func (a *App) nodeInstaller(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, filepath.Join("tools", "install", "node.sh"))
}
func (a *App) nodeDownload(w http.ResponseWriter, r *http.Request) {
	file := r.PathValue("file")
	switch file {
	case "voltra-node-linux-amd64", "voltra-node-linux-arm64", "SHA256SUMS":
	default:
		fail(w, notFound())
		return
	}
	root := os.Getenv("NODE_DOWNLOAD_DIR")
	if root == "" {
		root = filepath.Join("artifacts", "node")
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, filepath.Join(root, file))
}
