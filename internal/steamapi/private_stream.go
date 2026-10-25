package steamapi

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

const PrivateStreamService = "steam-private-v1"
const PrivateCapability = PrivateVersion

// PrivateStreamGrant is authenticated control-channel metadata, never an HTTP
// header or a user-supplied identity. Each newly opened stream has one action.
type PrivateStreamGrant struct {
	Server        string `json:"server"`
	Owner         string `json:"owner"`
	Job           string `json:"job"`
	Nonce         string `json:"nonce"`
	Action        string `json:"action"`
	RecoveryID    string `json:"recovery_id,omitempty"`
	RequestDigest string `json:"request_digest,omitempty"`
}

func (g PrivateStreamGrant) Validate() error {
	if !uuid.MatchString(g.Server) || !uuid.MatchString(g.Job) || !privateHex.MatchString(g.Owner) || !privateHex.MatchString(g.Nonce) || (g.Action != "run" && g.Action != "reply" && g.Action != "recover") {
		return errors.New("invalid private Steam stream grant")
	}
	if g.Action == "recover" {
		if !uuid.MatchString(g.RecoveryID) || !privateHex.MatchString(g.RequestDigest) {
			return errors.New("invalid private Steam recovery grant")
		}
	} else if g.RecoveryID != "" || g.RequestDigest != "" {
		return errors.New("unexpected private Steam recovery grant")
	}
	return nil
}

func PrivateAppCapability(app uint32) string {
	return "steam-private-app:" + strconv.FormatUint(uint64(app), 10)
}

// RegisteredPrivateApps exposes only actual registered preservation profiles.
// Registration is an allowlist, not production readiness or capability activation.
func RegisteredPrivateApps() []uint32 {
	apps := []uint32{}
	for _, p := range appProfiles {
		if p.AppID > 0 && p.AppID <= 2147483647 {
			apps = append(apps, uint32(p.AppID))
		}
	}
	for _, p := range privateCatalogProfiles {
		apps = append(apps, p.AppID)
	}
	return apps
}

func KnownPrivateCapability(value string) bool {
	if value == PrivateCapability || value == PrivateRecoveryCapability {
		return true
	}
	for _, app := range RegisteredPrivateApps() {
		if value == PrivateRecoveryAppCapability(app) {
			return true
		}
	}
	if !strings.HasPrefix(value, "steam-private-app:") {
		return false
	}
	for _, app := range RegisteredPrivateApps() {
		if value == PrivateAppCapability(app) {
			return true
		}
	}
	return false
}

func (g *PrivateStreamGrant) UnmarshalJSON(raw []byte) error {
	type plain PrivateStreamGrant
	var v plain
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &v) != nil || json.Unmarshal(raw, &fields) != nil {
		return errors.New("invalid private Steam stream grant")
	}
	if v.Action != "recover" {
		if _, ok := fields["recovery_id"]; ok {
			return errors.New("unexpected private Steam recovery grant")
		}
		if _, ok := fields["request_digest"]; ok {
			return errors.New("unexpected private Steam recovery grant")
		}
	}
	value := PrivateStreamGrant(v)
	if e := value.Validate(); e != nil {
		return e
	}
	*g = value
	return nil
}
