package nodeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

// PrivateSteamReleaseIdentity describes verified installed bytes, not authority
// to execute them. The offline installer's approval never supplies that authority.
type PrivateSteamReleaseIdentity struct {
	ManifestSHA256, Provider, RID, WorkerTarSHA256, SourceTarSHA256, InputsSHA256 string
}

// PrivateSteamReviewedAppPolicy is an independent reviewed preservation/platform
// policy. ProfileSHA256 binds the exact current PrivateProfile, not merely AppID.
type PrivateSteamReviewedAppPolicy struct {
	App                     uint32
	Revision, ProfileSHA256 string
}

// PrivateSteamProductionReleaseApproval must be returned by local ROOT-trusted
// authority. No concrete authority or approval is shipped by this composition.
// New release or app-policy revisions require a newly composed connector config.
type PrivateSteamReviewedReceiptRecovery struct {
	ABI, ManifestSHA256, EntrypointSHA256 string
	AppPolicies                           []PrivateSteamReviewedAppPolicy
}
type PrivateSteamProductionReleaseApproval struct {
	ReceiptRecovery                         *PrivateSteamReviewedReceiptRecovery `json:",omitempty"`
	ManifestSHA256, Revision, Provider, RID string
	ValidUntil                              time.Time
	AppPolicies                             []PrivateSteamReviewedAppPolicy
}

// Implementations must honor context cancellation/deadlines; this package ships
// none. Each authority query has a two-second deadline.
type PrivateSteamReleaseAuthority interface {
	CurrentPrivateSteamRelease(context.Context, PrivateSteamReleaseIdentity) (PrivateSteamProductionReleaseApproval, error)
}

var errPrivateRelease = errors.New("private Steam reviewed production release unavailable")

// PrivateSteamAppPolicySHA256 computes review input only; it grants no approval.
func PrivateSteamAppPolicySHA256(app uint32) (string, bool) {
	profile, ok := steamapi.PrivateProfile(app)
	if !ok {
		return "", false
	}
	raw, err := json.Marshal(profile)
	if err != nil {
		return "", false
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), true
}

// NewInstalledPrivateSteamConnectorConfig is local composition only. Neither
// installation paths, admission authority nor release approval come from a wire
// request. nil authority/admission is OFF. This does not install, grant approval,
// advertise capabilities, or change a service; the caller must supply the existing
// stopped-server/lifecycle-serialized trusted admission.
func NewInstalledPrivateSteamConnectorConfig(ctx context.Context, installedRoot, manifestSHA256 string, admission steamexec.PrivateAdmission, authority PrivateSteamReleaseAuthority) (*PrivateSteamConnectorConfig, error) {
	if ctx == nil || ctx.Err() != nil || admission == nil || authority == nil {
		return nil, errPrivateRelease
	}
	return composeInstalledPrivateSteamRelease(ctx, installedRoot, manifestSHA256, admission, authority)
}
