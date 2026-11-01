package panel

import (
	"bytes"
	"encoding/json"
	"math/big"
	"reflect"
	"strings"
)

// Explicit configuration edits must remain retryable after a previous daemon
// update failed even though the panel already saved the requested values.
func infraNodeConfigurationSyncRequested(input M) bool {
	for _, key := range []string{"fqdn", "scheme", "behind_proxy", "upload_size", "daemon_listen", "daemon_sftp", "daemon_base", "allowed_origins"} {
		if _, ok := input[key]; ok {
			return true
		}
	}
	return false
}

// infraNodeConfigurationNeedsSync compares the node-row inputs that actually
// affect nodeConfiguration. Panel capacity/name/public/maintenance metadata does
// not belong to Wings, so those edits must not require a daemon config update.
// Mount relations and global remote URL settings have separate mutation paths;
// node identity remains included because it selects that node's allowed mounts.
func infraNodeConfigurationNeedsSync(old, node M) bool {
	if old == nil || node == nil {
		return true
	}
	inputs := func(row M) M {
		outbound := str(row["connection_mode"]) == "outbound"
		projection := M{
			"id": row["id"], "uuid": row["uuid"],
			"token_id": row["daemon_token_id"], "token": str(row["daemon_token"]),
			"port": row["daemon_listen"], "upload_limit": row["upload_size"],
			"data": row["daemon_base"], "sftp_port": row["daemon_sftp"],
			"allowed_origins": row["allowed_origins"], "outbound": outbound,
		}
		if !outbound {
			// Certificate paths are emitted even when TLS is currently disabled.
			projection["certificate_host"] = strings.ToLower(str(row["fqdn"]))
			projection["ssl_enabled"] = !boolean(row["behind_proxy"]) && str(row["scheme"]) == "https"
		}
		return projection
	}
	return !infraNodeConfigurationJSONEqual(inputs(old), inputs(node))
}

// Match JSON wire values rather than Go container/number implementation types.
// Invalid JSON values fail closed and request synchronization.
func infraNodeConfigurationJSONEqual(left, right any) bool {
	decode := func(value any) (any, error) {
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		decoder := json.NewDecoder(bytes.NewReader(encoded))
		decoder.UseNumber()
		var result any
		err = decoder.Decode(&result)
		return result, err
	}
	a, err := decode(left)
	if err != nil {
		return false
	}
	b, err := decode(right)
	if err != nil {
		return false
	}
	var equal func(any, any) bool
	equal = func(a, b any) bool {
		switch value := a.(type) {
		case json.Number:
			other, ok := b.(json.Number)
			if !ok {
				return false
			}
			x, okX := new(big.Rat).SetString(string(value))
			y, okY := new(big.Rat).SetString(string(other))
			return okX && okY && x.Cmp(y) == 0
		case map[string]any:
			other, ok := b.(map[string]any)
			if !ok || len(value) != len(other) {
				return false
			}
			for key, item := range value {
				comparison, exists := other[key]
				if !exists || !equal(item, comparison) {
					return false
				}
			}
			return true
		case []any:
			other, ok := b.([]any)
			if !ok || len(value) != len(other) {
				return false
			}
			for index, item := range value {
				if !equal(item, other[index]) {
					return false
				}
			}
			return true
		default:
			return reflect.DeepEqual(a, b)
		}
	}
	return equal(a, b)
}
