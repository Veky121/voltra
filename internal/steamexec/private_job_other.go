//go:build !linux

package steamexec

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"voltra/internal/steamapi"
)

type PrivateDirectorySet struct{ Target, Work, Cache string }
type PrivateDirectoryAdmission struct {
	Roots map[string]PrivateDirectorySet
}

func (*PrivateDirectoryAdmission) Acquire(context.Context, steamapi.PrivateRequest) (*PrivateRoots, error) {
	return nil, errors.New("private Steam requires Linux")
}
func verifyPrivateWorker(string, string) error { return errors.New("private Steam requires Linux") }
func validatePrivateProvider(*os.File, json.RawMessage) error {
	return errors.New("private Steam requires Linux")
}

type PrivateExecutorAdmission struct {
	Executor *Executor
	Storage  *PrivateDirectoryAdmission
}

func (*PrivateExecutorAdmission) Acquire(context.Context, steamapi.PrivateRequest) (*PrivateRoots, error) {
	return nil, errors.New("private Steam requires Linux")
}
func validatePrivatePrior(PrivateContentProcess, context.Context, PrivateContentRequest) (json.RawMessage, error) {
	return nil, errors.New("private Steam requires Linux")
}
