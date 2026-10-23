package panel

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// NodeReleaseVersion is set by versioned Panel builds. Operators can override
// it with NODE_RELEASE_VERSION after both node release workflows finish.
var NodeReleaseVersion string

func nodeInstallCommand(base string, recovery bool) string {
	if recovery {
		return "sudo voltra-node setup --reconnect"
	}
	quote := func(v string) string { return "'" + strings.ReplaceAll(v, "'", "'\\''") + "'" }
	version := os.Getenv("NODE_RELEASE_VERSION")
	if version == "" {
		version = NodeReleaseVersion
	}
	if !regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$`).MatchString(version) {
		return "printf '%s\\n' 'Node release is not configured. Set NODE_RELEASE_VERSION on the Panel to a published vMAJOR.MINOR.PATCH release, then reopen this wizard.'"
	}
	url := "https://github.com/Veky121/voltra/releases/download/" + version
	// A private temp directory avoids predictable /tmp paths. Verify the script
	// before running it. Enrollment credentials never enter this command.
	return "(set -eu; d=$(mktemp -d); trap 'rm -rf -- \"$d\"' EXIT; " +
		"curl -fLsS --proto '=https' --proto-redir '=https' " + quote(url+"/install-node.sh") + " -o \"$d/install-node.sh\"; " +
		"curl -fLsS --proto '=https' --proto-redir '=https' " + quote(url+"/WINGS-SHA256SUMS") + " -o \"$d/WINGS-SHA256SUMS\"; " +
		"cd \"$d\"; awk '$2 == \"install-node.sh\" && length($1) == 64 && $1 !~ /[^0-9a-f]/ { print; n++ } END { if (n != 1) exit 1 }' WINGS-SHA256SUMS > script.sha256; " +
		"sha256sum -c script.sha256; sudo bash ./install-node.sh " + quote(version) + " " + quote(base) + ")"
}
func (a *App) reconnectNode(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	id, e := infraID(r.PathValue("node"))
	if e != nil {
		fail(w, e)
		return
	}
	if r.Body == nil || r.ContentLength == 0 {
		r.Body = io.NopCloser(strings.NewReader("{}"))
	}
	a.createEnrollment(w, r, id)
}
func (a *App) checkNodeConnection(w http.ResponseWriter, r *http.Request) {
	if _, e := a.requireAdmin(r); e != nil {
		fail(w, e)
		return
	}
	status, e := a.nodeReadiness(r.Context(), num(r.PathValue("node")), true)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, status)
}
func (a *App) reportNodeStatus(w http.ResponseWriter, r *http.Request) {
	id, e := a.connectorNode(r.Context(), pairingBearer(r))
	if e != nil {
		fail(w, e)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	d, e := decode(r)
	if e != nil {
		fail(w, e)
		return
	}
	stage := str(d["stage"])
	detail := ""
	switch stage {
	case "starting":
		detail = "Starting node services."
	case "checking":
		detail = "Checking Wings."
	case "error":
		detail = "Node services could not start. Run setup again or check the service status on this machine."
	default:
		fail(w, bad("Unsupported setup stage."))
		return
	}
	_, e = a.DB.Exec(r.Context(), `UPDATE node_connectors SET setup_stage=$2,setup_detail=$3,updated_at=now() WHERE node_id=$1 AND NOT revoked`, id, stage, detail)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, M{"stage": stage})
}

// A connector is a transport, not proof that Wings is working. Health is cached
// per live connection so reconnects cannot inherit a previous Ready result.
func (a *App) nodeReadiness(ctx context.Context, id int64, force bool) (M, error) {
	n, e := a.one(ctx, `SELECT n.id,n.connection_mode,c.revoked,c.setup_stage,c.setup_detail FROM nodes n LEFT JOIN node_connectors c ON c.node_id=n.id WHERE n.id=$1`, id)
	if e != nil {
		return nil, e
	}
	h := a.connectors()
	h.mu.Lock()
	c := h.controls[id]
	out := M{"mode": n["connection_mode"], "connected": c != nil, "ready": false, "stage": "disconnected", "detail": "Node connector is offline.", "revoked": boolean(n["revoked"])}
	if str(n["connection_mode"]) != "outbound" {
		out["detail"] = "This node uses direct Wings access."
		h.mu.Unlock()
		return out, nil
	}
	if c == nil {
		if boolean(n["revoked"]) {
			out["detail"] = "Node access was revoked. Use Reconnect to restore access."
		} else if str(n["setup_stage"]) == "error" {
			out["stage"] = "error"
			out["detail"] = n["setup_detail"]
		} else if str(n["setup_stage"]) == "starting" || str(n["setup_stage"]) == "checking" {
			out["stage"] = n["setup_stage"]
			out["detail"] = n["setup_detail"]
		}
		h.mu.Unlock()
		return out, nil
	}
	if c.health != nil {
		for k, v := range c.health {
			out[k] = v
		}
	} else {
		out["stage"] = "checking"
		out["detail"] = "Checking Wings."
	}
	due := force || time.Since(c.healthAt) > 5*time.Second
	if due && !c.healthChecking {
		c.healthChecking = true
		if force {
			out["ready"] = false
			out["stage"] = "checking"
			out["detail"] = "Checking Wings."
			c.health = M{"ready": false, "stage": "checking", "detail": "Checking Wings."}
		}
		go a.probeWings(c)
	}
	h.mu.Unlock()
	return out, nil
}
func (a *App) probeWings(c *connectorControl) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	health := M{"ready": false, "stage": "error", "detail": "Wings did not respond. Check voltra-wings.service on the node, then retry."}
	node, e := a.node(ctx, c.nodeID)
	if e == nil {
		response, err := a.daemon(ctx, node, http.MethodGet, "/api/system", nil)
		if err == nil {
			var system M
			err = json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&system)
			response.Body.Close()
			// Stock Wings includes version and architecture. An unrelated HTTP endpoint
			// answering 200 must not make a machine Ready.
			architecture := system["architecture"]
			if architecture == nil {
				architecture = asMap(system["system"])["architecture"]
			}
			if err == nil && architecture != nil && system["version"] != nil {
				health = M{"ready": true, "stage": "ready", "detail": "Wings is ready."}
			}
		}
	}
	health["checked_at"] = time.Now().UTC()
	if boolean(health["ready"]) {
		_, _ = a.DB.Exec(ctx, "UPDATE node_connectors SET setup_stage='ready',setup_detail='' WHERE node_id=$1 AND NOT revoked", c.nodeID)
	}
	h := a.connectors()
	h.mu.Lock()
	if h.controls[c.nodeID] == c {
		c.health = health
		c.healthAt = time.Now()
	}
	c.healthChecking = false
	h.mu.Unlock()
}
