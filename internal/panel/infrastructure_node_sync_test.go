package panel

import (
	"encoding/json"
	"math"
	"testing"
)

func nodeSyncFixture() M {
	return M{
		"id": int64(7), "uuid": "node-fixture", "daemon_token_id": "token-id-fixture", "daemon_token": "token-fixture",
		"fqdn": "Node.Example.Test", "scheme": "https", "behind_proxy": false,
		"daemon_listen": int64(8080), "daemon_sftp": int64(2022), "daemon_base": "/var/lib/voltra/volumes", "upload_size": int64(100),
		"allowed_origins": []any{"https://panel.example.test"}, "connection_mode": "direct",
		"name": "Node", "description": "Operator description", "location_id": int64(1), "public": true,
		"memory": int64(8192), "memory_overallocate": int64(0), "disk": int64(32768), "disk_overallocate": int64(0), "maintenance_mode": false,
	}
}

func nodeSyncCopy(row M) M {
	copy := M{}
	for key, value := range row {
		copy[key] = value
	}
	return copy
}

func TestNodeConfigurationSyncPanelOnlyChanges(t *testing.T) {
	old := nodeSyncFixture()
	if infraNodeConfigurationNeedsSync(old, nodeSyncCopy(old)) {
		t.Fatal("unchanged node requires sync")
	}
	for key, value := range (M{
		"name": "Renamed", "description": "New", "location_id": int64(2), "public": false,
		"memory": int64(16384), "memory_overallocate": int64(50), "disk": int64(65536), "disk_overallocate": int64(-1),
		"maintenance_mode": true, "created_at": "changed", "updated_at": "changed",
	}) {
		next := nodeSyncCopy(old)
		next[key] = value
		if infraNodeConfigurationNeedsSync(old, next) {
			t.Errorf("panel-only %s requires sync", key)
		}
	}
}

func TestNodeConfigurationSyncExplicitRetry(t *testing.T) {
	if infraNodeConfigurationSyncRequested(M{"memory": 16384, "disk": 131072}) {
		t.Fatal("capacity-only request requires daemon update")
	}
	for _, key := range []string{"fqdn", "scheme", "behind_proxy", "upload_size", "daemon_listen", "daemon_sftp", "daemon_base", "allowed_origins"} {
		if !infraNodeConfigurationSyncRequested(M{key: nodeSyncFixture()[key]}) {
			t.Fatalf("identical explicit %s update cannot retry prior failure", key)
		}
	}
}

func TestNodeConfigurationSyncRealInputs(t *testing.T) {
	old := nodeSyncFixture()
	for key, value := range (M{
		"id": int64(8), "uuid": "different-node", "daemon_token_id": "different-token-id", "daemon_token": "different-token",
		"fqdn": "different.example.test", "scheme": "http", "behind_proxy": true,
		"daemon_listen": int64(8081), "daemon_sftp": int64(2023), "daemon_base": "/other/volumes", "upload_size": int64(200),
		"allowed_origins": []any{"https://other.example.test"}, "connection_mode": "outbound",
	}) {
		next := nodeSyncCopy(old)
		next[key] = value
		if !infraNodeConfigurationNeedsSync(old, next) {
			t.Errorf("configuration input %s skipped sync", key)
		}
	}
	if !infraNodeConfigurationNeedsSync(nil, old) || !infraNodeConfigurationNeedsSync(old, nil) {
		t.Fatal("missing row should fail closed")
	}
}

func TestNodeConfigurationSyncEffectiveTLSAndOutbound(t *testing.T) {
	old := nodeSyncFixture()
	next := nodeSyncCopy(old)
	next["fqdn"] = "NODE.EXAMPLE.TEST"
	if infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("certificate case normalization changed configuration")
	}
	old["scheme"] = "http"
	next = nodeSyncCopy(old)
	next["behind_proxy"] = true
	if infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("proxy metadata with TLS already off changed configuration")
	}
	old["connection_mode"] = "outbound"
	next = nodeSyncCopy(old)
	next["fqdn"], next["scheme"], next["behind_proxy"] = "other.example.test", "https", true
	if infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("outbound ignores certificate/TLS fields")
	}
	next["connection_mode"] = "direct"
	if !infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("outbound-to-direct host/SFTP/remote change skipped")
	}
}

func TestNodeConfigurationSyncJSONEquivalence(t *testing.T) {
	old := nodeSyncFixture()
	next := nodeSyncCopy(old)
	next["daemon_listen"] = json.Number("8.080e3")
	next["daemon_sftp"] = float64(2022)
	next["upload_size"] = int(100)
	next["id"] = json.Number("7.0")
	next["allowed_origins"] = []string{"https://panel.example.test"}
	next["behind_proxy"] = "false"
	if infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("equivalent JSON/numeric types caused sync")
	}
	next["allowed_origins"] = json.RawMessage(`["https://panel.example.test"]`)
	if infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("equivalent raw JSON caused sync")
	}
	for _, origins := range []any{`["https://panel.example.test"]`, nil, []any{}, json.RawMessage(`invalid`)} {
		next["allowed_origins"] = origins
		if !infraNodeConfigurationNeedsSync(old, next) {
			t.Fatal("different/invalid JSON was treated as equivalent")
		}
	}
	next = nodeSyncCopy(old)
	next["upload_size"] = math.NaN()
	if !infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("unserializable value should fail closed")
	}
	next["upload_size"] = 100.5
	if !infraNodeConfigurationNeedsSync(old, next) {
		t.Fatal("fractional change should not be truncated")
	}
}
