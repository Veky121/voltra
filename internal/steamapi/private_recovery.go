package steamapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"unicode/utf8"
)

const PrivateRecoveryCapability = "steam-private-receipt-recovery-v1"
const PrivateRecoveryABI = "steamkit-private-receipt-recovery-v1"

// PrivateRecoveryOriginal deliberately has no credential fields. Strict decoding
// rejects credential keys even when their values are empty or null.
type PrivateRecoveryOriginal struct {
	Previous        *PrivateReceipt  `json:"previous,omitempty"`
	Version         string           `json:"version"`
	Job             string           `json:"job"`
	Server          string           `json:"server"`
	Owner           string           `json:"owner"`
	Nonce           string           `json:"nonce"`
	Selection       PrivateSelection `json:"selection"`
	ContentBudget   string           `json:"content_budget"`
	RollbackReserve string           `json:"rollback_reserve"`
	CacheQuota      string           `json:"cache_quota"`
	DeadlineSeconds uint32           `json:"deadline_seconds"`
}
type PrivateReceiptRecoveryRequest struct {
	Version    string                  `json:"version"`
	RecoveryID string                  `json:"recovery_id"`
	Original   PrivateRecoveryOriginal `json:"original"`
}

func (r PrivateRecoveryOriginal) Request() PrivateRequest {
	return PrivateRequest{Previous: r.Previous, Version: r.Version, Job: r.Job, Server: r.Server, Owner: r.Owner, Nonce: r.Nonce, Selection: r.Selection, ContentBudget: r.ContentBudget, RollbackReserve: r.RollbackReserve, CacheQuota: r.CacheQuota, DeadlineSeconds: r.DeadlineSeconds}
}
func PrivateRecoveryOriginalFromRequest(r PrivateRequest) (PrivateRecoveryOriginal, error) {
	if r.Username != "" || r.Password != "" || r.Guard != "" || r.BetaPassword != "" || r.Validate() != nil {
		return PrivateRecoveryOriginal{}, errors.New("invalid private Steam recovery original")
	}
	return PrivateRecoveryOriginal{r.Previous, r.Version, r.Job, r.Server, r.Owner, r.Nonce, r.Selection, r.ContentBudget, r.RollbackReserve, r.CacheQuota, r.DeadlineSeconds}, nil
}
func (r PrivateReceiptRecoveryRequest) Validate() error {
	if r.Version != PrivateRecoveryCapability || !uuid.MatchString(r.RecoveryID) || r.Original.Request().Validate() != nil {
		return errors.New("invalid private Steam recovery request")
	}
	return nil
}
func PrivateRecoveryAppCapability(app uint32) string {
	return "steam-private-recovery-app:" + strconv.FormatUint(uint64(app), 10)
}

func (r *PrivateRecoveryOriginal) UnmarshalJSON(raw []byte) error {
	type plain PrivateRecoveryOriginal
	var v plain
	if !utf8.Valid(raw) {
		return errors.New("invalid private Steam recovery original")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(&v); e != nil {
		return errors.New("invalid private Steam recovery original")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid private Steam recovery original")
	}
	*r = PrivateRecoveryOriginal(v)
	return nil
}

func (r *PrivateReceiptRecoveryRequest) UnmarshalJSON(raw []byte) error {
	type plain PrivateReceiptRecoveryRequest
	var v plain
	if !utf8.Valid(raw) {
		return errors.New("invalid private Steam recovery request")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(&v); e != nil {
		return errors.New("invalid private Steam recovery request")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid private Steam recovery request")
	}
	*r = PrivateReceiptRecoveryRequest(v)
	return nil
}
