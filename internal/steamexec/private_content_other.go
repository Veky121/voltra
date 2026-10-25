//go:build !linux

package steamexec

import (
	"context"
	"encoding/json"
	"errors"
)

func (p PrivateContentProcess) Run(ctx context.Context, request PrivateContentRequest) (json.RawMessage, error) {
	return nil, errors.New("private Steam worker requires Linux descriptors")
}
