//go:build !linux

package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"voltra/internal/steamapi"
)

func (*PrivateDirectoryAdmission) AcquireRecovery(context.Context, steamapi.PrivateRequest) (*PrivateRoots, error) {
	return nil, errors.New("private Steam recovery requires Linux")
}
func (*PrivateExecutorAdmission) AcquireRecovery(context.Context, steamapi.PrivateRequest) (*PrivateRoots, error) {
	return nil, errors.New("private Steam recovery requires Linux")
}
func recoverPrivateProcess(PrivateContentProcess, context.Context, PrivateContentRequest) (json.RawMessage, error) {
	return nil, errors.New("private Steam recovery requires Linux")
}
