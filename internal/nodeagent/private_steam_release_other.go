//go:build !linux

package nodeagent

import (
	"context"
	"voltra/internal/steamexec"
)

func composeInstalledPrivateSteamRelease(context.Context, string, string, steamexec.PrivateAdmission, PrivateSteamReleaseAuthority) (*PrivateSteamConnectorConfig, error) {
	return nil, errPrivateRelease
}
