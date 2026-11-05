package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Administration stays behind panel authorization; neither a browser nor a
// server owner receives the daemon credential or access to its Docker socket.
func (a *App) registerRuntimeManagement(mux *http.ServeMux) {
	for _, method := range []string{"GET", "POST"} {
		mux.HandleFunc(method+" /api/admin/nodes/{node}/runtime/{kind}", a.adminRuntimeManagement)
	}
}

type runtimeAction struct {
	Action     string `json:"action"`
	Reference  string `json:"reference,omitempty"`
	ExpectedID string `json:"expected_id,omitempty"`
	Enabled    *bool  `json:"enabled,omitempty"`
}

var runtimeReference = regexp.MustCompile(`^~?[A-Za-z0-9][A-Za-z0-9_./:@-]{0,510}$`)
var runtimeImageID = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func decodeRuntimeAction(r io.Reader, kind string) (runtimeAction, error) {
	var q runtimeAction
	d := json.NewDecoder(r)
	d.DisallowUnknownFields()
	var extra any
	if d.Decode(&q) != nil || d.Decode(&extra) != io.EOF {
		return q, bad("Provide one runtime action object with supported fields.")
	}
	if kind == "steamcmd" {
		if (q.Action != "check" && q.Action != "schedule") || q.Reference != "" || q.ExpectedID != "" || (q.Action == "schedule") != (q.Enabled != nil) {
			return q, bad("Choose a SteamCMD check or schedule action with its supported fields.")
		}
		return q, nil
	}
	if kind != "images" || !validRuntimeReference(q.Reference) {
		return q, bad("Choose a registered container image.")
	}
	switch q.Action {
	case "schedule":
		if q.Enabled == nil || q.ExpectedID != "" {
			return q, bad("A schedule requires enabled to be true or false.")
		}
	case "check":
		if q.ExpectedID != "" || q.Enabled != nil {
			return q, bad("An image check does not accept an expected image ID.")
		}
	case "approve", "rollback":
		if !runtimeImageID.MatchString(q.ExpectedID) || q.Enabled != nil {
			return q, bad("Refresh the image list before choosing a version.")
		}
	default:
		return q, bad("Unsupported image action.")
	}
	return q, nil
}

func validRuntimeReference(ref string) bool {
	if !runtimeReference.MatchString(ref) || strings.Contains(ref, "//") {
		return false
	}
	if name, digest, ok := strings.Cut(ref, "@"); ok {
		return name != "" && runtimeImageID.MatchString(digest)
	}
	return true
}

func (a *App) adminRuntimeManagement(w http.ResponseWriter, r *http.Request) {
	u, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	kind := r.PathValue("kind")
	if (kind != "images" && kind != "steamcmd") || r.URL.RawQuery != "" {
		fail(w, notFound())
		return
	}
	id, err := infraID(r.PathValue("node"))
	if err != nil {
		fail(w, err)
		return
	}
	node, err := a.node(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	var action runtimeAction
	var body any
	if r.Method == http.MethodPost {
		action, err = decodeRuntimeAction(http.MaxBytesReader(w, r.Body, 4096), kind)
		if err != nil {
			fail(w, err)
			return
		}
		if boolean(node["maintenance_mode"]) {
			fail(w, APIError{409, "NodeMaintenance", "Leave node maintenance mode before changing its runtime tools."})
			return
		}
		body = action
		// Record intent before dispatch. Network timeouts can leave the remote
		// outcome uncertain, so this is deliberately not a completion receipt.
		if err = a.audit(r.Context(), num(u["id"]), 0, "admin:runtime:requested", M{"node_id": id, "kind": kind, "action": action.Action, "reference": action.Reference, "expected_id": action.ExpectedID, "enabled": action.Enabled}); err != nil {
			fail(w, err)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	var response *http.Response
	if kind == "images" {
		response, err = a.daemon(ctx, node, r.Method, "/api/runtime-images", body)
		var remote *APIError
		if errors.As(err, &remote) && remote.Status == 404 {
			err = APIError{503, "RuntimeManagerUnavailable", "Update this node to the Wings build with runtime image management, then retry."}
		}
	} else {
		response, err = a.steamClientAdminRequest(ctx, id, r.Method, action)
	}
	if err != nil {
		fail(w, err)
		return
	}
	defer response.Body.Close()
	data, err := readRuntimeResponse(response)
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == http.MethodGet && !validRuntimeStatus(kind, data) {
		fail(w, APIError{502, "InvalidRuntimeStatus", "The node returned an incompatible runtime status. Update the node and refresh before making changes."})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, response.StatusCode, data)
}

func validRuntimeStatus(kind string, data M) bool {
	if kind == "steamcmd" {
		for _, key := range []string{"supported", "busy", "initialized", "schedule_enabled", "recovery_required"} {
			if _, ok := data[key].(bool); !ok {
				return false
			}
		}
		for _, key := range []string{"version", "helper_image", "last_error"} {
			if _, ok := data[key].(string); !ok {
				return false
			}
		}
		return str(data["scope"]) == "metadata" && validRuntimeTimes(data, "last_attempt_at", "last_checked_at", "next_check_at", "version_observed_at")
	}
	images, ok := data["images"].([]any)
	if !ok || num(data["version"]) != 1 || len(images) > 4096 {
		return false
	}
	seen := map[string]bool{}
	for _, raw := range images {
		row := asMap(raw)
		ref := str(row["reference"])
		if !validRuntimeReference(ref) || seen[ref] {
			return false
		}
		seen[ref] = true
		if _, ok := row["busy"].(bool); !ok {
			return false
		}
		if _, ok := row["schedule_enabled"].(bool); !ok {
			return false
		}
		if _, ok := row["error"].(string); !ok {
			return false
		}
		if !validRuntimeTimes(row, "last_checked_at", "next_check_at") {
			return false
		}
		for _, key := range []string{"approved_id", "candidate_id", "previous_id"} {
			id, ok := row[key].(string)
			if !ok {
				return false
			}
			if id != "" && !runtimeImageID.MatchString(id) {
				return false
			}
		}
	}
	return true
}

func validRuntimeTimes(data M, keys ...string) bool {
	for _, key := range keys {
		if data[key] == nil {
			continue
		}
		value, ok := data[key].(string)
		if !ok {
			return false
		}
		if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
			return false
		}
	}
	return true
}

func (a *App) steamClientAdminRequest(ctx context.Context, nodeID int64, method string, action runtimeAction) (*http.Response, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableKeepAlives = true
	transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return a.dialNodeService(ctx, nodeID, "runtime")
	}
	defer transport.CloseIdleConnections()
	path := "/steamcmd"
	requestBody := []byte("{}")
	if method == http.MethodPost {
		if action.Action == "schedule" {
			path += "/schedule"
			requestBody, _ = json.Marshal(M{"enabled": action.Enabled})
		} else {
			path += "/check"
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://node-runtime"+path, bytes.NewReader(requestBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: transport, Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, APIError{503, "RuntimeConnectorUnavailable", "SteamCMD management needs a connected Linux amd64 node with runtime maintenance support. Update or reconnect the node and retry."}
	}
	return res, nil
}

func readRuntimeResponse(res *http.Response) (M, error) {
	const limit = 2 << 20
	raw, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	var result M
	if err != nil || len(raw) > limit || json.Unmarshal(raw, &result) != nil || result == nil {
		return nil, APIError{502, "InvalidRuntimeResponse", "The node returned an invalid runtime status. Refresh before retrying an action."}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		status := 502
		if res.StatusCode == 409 || res.StatusCode == 400 || res.StatusCode == 503 {
			status = res.StatusCode
		}
		// Do not reflect untrusted node output, paths or credentials into errors.
		return nil, APIError{status, "RuntimeActionRejected", "The node could not accept this runtime request. Refresh its status; an operation may already be running or the node may need an update."}
	}
	return result, nil
}
