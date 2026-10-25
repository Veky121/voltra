//go:build !linux

package nodeagent

import (
	"context"
	"errors"
	"io"
)

func installPrivateCandidate(context.Context, string, []byte, string, io.Reader, io.Reader, func(string) error) (*PrivateCandidateInstallation, error) {
	return nil, errors.New("private Steam provisioning requires Linux")
}
