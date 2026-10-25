package steamapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const PrivateVersion = "steam-private-content-v1"
const PrivateProvider = "steamkit-depot-v1"

type PrivateSelection struct {
	App          uint32   `json:"app"`
	Branch       string   `json:"branch"`
	Platform     string   `json:"platform"`
	Architecture string   `json:"architecture"`
	Language     string   `json:"language"`
	DLC          []uint32 `json:"dlc_apps"`
	Protected    []string `json:"protected_roots"`
}
type PrivateRequest struct {
	Previous        *PrivateReceipt  `json:"previous,omitempty"`
	Version         string           `json:"version"`
	Job             string           `json:"job"`
	Server          string           `json:"server"`
	Owner           string           `json:"owner"`
	Nonce           string           `json:"nonce"`
	Selection       PrivateSelection `json:"selection"`
	Username        string           `json:"username,omitempty"`
	Password        string           `json:"password,omitempty"`
	Guard           string           `json:"guard,omitempty"`
	BetaPassword    string           `json:"beta_password,omitempty"`
	ContentBudget   string           `json:"content_budget"`
	RollbackReserve string           `json:"rollback_reserve"`
	CacheQuota      string           `json:"cache_quota"`
	DeadlineSeconds uint32           `json:"deadline_seconds"`
}

func (PrivateRequest) String() string { return "PrivateRequest [private]" }

type PrivateScope struct {
	Server        string `json:"server"`
	Owner         string `json:"owner"`
	Job           string `json:"job"`
	Nonce         string `json:"nonce"`
	RequestDigest string `json:"request_digest"`
}
type PrivateChallenge struct {
	Job         string `json:"job"`
	Nonce       string `json:"nonce"`
	ChallengeID string `json:"challenge_id"`
	Kind        string `json:"kind"`
}
type PrivateReply struct {
	PrivateChallenge
	Code     *string `json:"code,omitempty"`
	Accepted *bool   `json:"accepted,omitempty"`
}

func (PrivateReply) String() string { return "PrivateReply [private]" }

type PrivateEvent struct {
	Version                  string            `json:"version"`
	Type                     string            `json:"type"`
	Stage                    string            `json:"stage,omitempty"`
	Challenge                *PrivateChallenge `json:"challenge,omitempty"`
	Receipt                  json.RawMessage   `json:"receipt,omitempty"`
	Error                    string            `json:"error,omitempty"`
	NativeAcceptanceVerified bool              `json:"native_acceptance_verified"`
}
type PrivateReceipt struct {
	Scope         PrivateScope `json:"scope"`
	Path          string       `json:"path"`
	SHA256        string       `json:"sha256"`
	Files         string       `json:"files"`
	PublisherPlan struct {
		App    uint32 `json:"app"`
		Build  string `json:"build"`
		Depots []struct {
			PublisherApp uint32 `json:"publisher_app"`
			Depot        uint32 `json:"depot"`
			Manifest     string `json:"manifest"`
		} `json:"depots"`
	} `json:"publisher_plan"`
}

var privateHex = regexp.MustCompile(`^[a-f0-9]{64}$`)

func PrivateUint(s string, zero bool) bool {
	n, e := strconv.ParseUint(s, 10, 64)
	return e == nil && (zero || n > 0) && strconv.FormatUint(n, 10) == s
}
func (r PrivateRequest) Validate() error {
	bad := errors.New("invalid private Steam request")
	s := r.Selection
	for _, literal := range []string{r.Username, r.Password, r.Guard, r.BetaPassword} {
		if !utf8.ValidString(literal) {
			return bad
		}
	}

	if r.Version != PrivateVersion || !uuid.MatchString(r.Job) || !uuid.MatchString(r.Server) || !privateHex.MatchString(r.Owner) || !privateHex.MatchString(r.Nonce) || s.App == 0 || s.App > 2147483647 || !branch.MatchString(s.Branch) || (s.Platform != "linux" && s.Platform != "windows") || (s.Architecture != "32" && s.Architecture != "64") || len(s.Language) == 0 || len(s.Language) > 64 || r.DeadlineSeconds == 0 || r.DeadlineSeconds > 7200 || !PrivateUint(r.ContentBudget, false) || !PrivateUint(r.RollbackReserve, true) || !PrivateUint(r.CacheQuota, false) || len(s.DLC) > 128 || len(s.Protected) > 256 {
		return bad
	}
	if len(r.BetaPassword) > 1024 || strings.ContainsAny(r.BetaPassword, "\r\n\x00") || r.BetaPassword != "" && s.Branch == "public" {
		return bad
	}
	seen := map[uint32]bool{}
	for _, v := range s.DLC {
		if v == 0 || seen[v] {
			return bad
		}
		seen[v] = true
	}
	for _, p := range s.Protected {
		if p == "" || strings.ContainsAny(p, "\\:\r\n\x00") || strings.HasPrefix(p, "/") {
			return bad
		}
		for _, c := range strings.Split(p, "/") {
			if c == "" || c == "." || c == ".." {
				return bad
			}
		}
	}
	for _, c := range s.Language {
		if c < 32 || c == 127 {
			return bad
		}
	}
	return r.CheckPrevious()
}
func privateHash(domain, value string) string {
	h := sha256.Sum256([]byte(domain + "\x00" + value))
	return hex.EncodeToString(h[:])
}
func (r PrivateRequest) Scope() PrivateScope {
	data, _ := json.Marshal(struct {
		Version                                    string
		Selection                                  PrivateSelection
		ContentBudget, RollbackReserve, CacheQuota string
		Deadline                                   uint32
		Previous                                   *PrivateReceipt
	}{r.Version, r.Selection, r.ContentBudget, r.RollbackReserve, r.CacheQuota, r.DeadlineSeconds, r.Previous})
	return PrivateScope{privateHash("server", r.Server), privateHash("owner", r.Owner), privateHash("job", r.Job), r.Nonce, privateHash("request", string(data))}
}
func (r PrivateRequest) CheckReceipt(raw json.RawMessage) error {
	var marker map[string]json.RawMessage
	if json.Unmarshal(raw, &marker) != nil || marker["fixture_provider"] != nil {
		return errors.New("private Steam fixture receipt rejected")
	}
	var v PrivateReceipt
	if json.Unmarshal(raw, &v) != nil || v.Scope != r.Scope() || v.Path != v.Scope.Server+"/"+v.Scope.Owner+"/"+v.Scope.Nonce+"/receipt.json" || !privateHex.MatchString(v.SHA256) || !PrivateUint(v.Files, true) || v.PublisherPlan.App != r.Selection.App || !PrivateUint(v.PublisherPlan.Build, false) || len(v.PublisherPlan.Depots) == 0 || len(v.PublisherPlan.Depots) > 128 {
		return errors.New("private Steam receipt policy rejected")
	}
	seen := map[uint32]bool{}
	for _, d := range v.PublisherPlan.Depots {
		if d.PublisherApp == 0 || d.Depot == 0 || seen[d.Depot] || !PrivateUint(d.Manifest, false) {
			return errors.New("private Steam receipt policy rejected")
		}
		seen[d.Depot] = true
	}
	return nil
}

func (r PrivateRequest) CheckPrevious() error {
	if r.Previous == nil {
		return nil
	}
	p := r.Previous
	bad := errors.New("private Steam previous receipt rejected")
	if p.Scope.Server != privateHash("server", r.Server) || p.Scope.Owner != privateHash("owner", r.Owner) || p.Scope.Nonce == r.Nonce || p.Scope.Job == privateHash("job", r.Job) || p.PublisherPlan.App != r.Selection.App {
		return bad
	}
	for _, v := range []string{p.Scope.Server, p.Scope.Owner, p.Scope.Job, p.Scope.Nonce, p.Scope.RequestDigest, p.SHA256} {
		if !privateHex.MatchString(v) {
			return bad
		}
	}
	if p.Path != p.Scope.Server+"/"+p.Scope.Owner+"/"+p.Scope.Nonce+"/receipt.json" || !PrivateUint(p.Files, true) || !PrivateUint(p.PublisherPlan.Build, false) || len(p.PublisherPlan.Depots) == 0 || len(p.PublisherPlan.Depots) > 128 {
		return bad
	}
	seen := map[uint32]bool{}
	for _, d := range p.PublisherPlan.Depots {
		if d.PublisherApp == 0 || d.Depot == 0 || seen[d.Depot] || !PrivateUint(d.Manifest, false) {
			return bad
		}
		seen[d.Depot] = true
	}
	return nil
}
