// Package steamapi defines the versioned, Panel-independent Steam stream protocol.
package steamapi

import (
	"errors"
	"regexp"
	"strings"
)

const Capability = "steam-v1"
const OptionsCapability = "steam-options-v1"

// Reserved but deliberately not advertised until native password parsing is
// proven for every supported character. Validation alone remains available.
const PrivateBranchCapability = "steam-private-branch-v1"

type Request struct {
	JobID        string `json:"job_id"`
	Operation    string `json:"operation"`
	ServerUUID   string `json:"server_uuid"`
	AppID        int64  `json:"app_id"`
	Branch       string `json:"branch"`
	BetaPassword string `json:"beta_password,omitempty"`
	Validate     bool   `json:"validate,omitempty"`
}

type Event struct {
	Type            string `json:"type"`
	Stage           string `json:"stage"`
	Detail          string `json:"detail"`
	InstalledBuild  string `json:"installed_build,omitempty"`
	LatestBuild     string `json:"latest_build,omitempty"`
	UpdateAvailable bool   `json:"update_available"`
	FilesChanged    bool   `json:"files_changed"`
	Error           string `json:"error,omitempty"`
}

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var branch = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)

// Normalize validates all inputs before any Docker or filesystem access.
func (r *Request) Normalize() error {
	if !uuid.MatchString(r.JobID) || !uuid.MatchString(r.ServerUUID) {
		return errors.New("job_id and server_uuid must be canonical lowercase UUIDs")
	}
	if r.AppID <= 0 || r.AppID > 2147483647 {
		return errors.New("invalid Steam app ID")
	}
	if r.Branch == "" {
		r.Branch = "public"
	}
	if !branch.MatchString(r.Branch) {
		return errors.New("invalid Steam branch")
	}
	if len(r.BetaPassword) > 1024 || strings.ContainsAny(r.BetaPassword, "\r\n\x00") || r.BetaPassword != "" && r.Branch == "public" {
		return errors.New("invalid private branch credential")
	}
	switch r.Operation {
	case "install", "check", "update", "verify":
		return nil
	}
	return errors.New("unsupported Steam operation")
}

// Credentials are transient transport values, never durable replay identity.
func (r Request) WithoutCredentials() Request { r.BetaPassword = ""; return r }
