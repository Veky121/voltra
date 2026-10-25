package nodeagent

import (
	"context"
	"io"
	"voltra/internal/steamexec"
)

type PrivateCandidateFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
	Mode   uint32 `json:"mode"`
}
type PrivateCandidateManifest struct {
	Version           int                    `json:"version"`
	Provider          string                 `json:"provider"`
	RID               string                 `json:"rid"`
	Entrypoint        string                 `json:"entrypoint"`
	RuntimeRoot       string                 `json:"runtime_root"`
	RuntimeVersion    string                 `json:"runtime_version"`
	SDK               string                 `json:"sdk"`
	InputsSHA256      string                 `json:"source_inputs_sha256"`
	WorkerTarSHA256   string                 `json:"worker_tar_sha256"`
	SourceTarSHA256   string                 `json:"source_tar_sha256"`
	Files             []PrivateCandidateFile `json:"files"`
	SourceFiles       []PrivateCandidateFile `json:"source_files"`
	ProductionEnabled bool                   `json:"production_enabled"`
}
type PrivateCandidateInstallation struct {
	Root, Digest string
	Bundle       *steamexec.PrivateWorkerBundle
}

// InstallPrivateCandidate never downloads, activates services or enables a node
// capability. trustedSHA256 must come from separately approved root-owned config.
func InstallPrivateCandidate(ctx context.Context, base string, manifest []byte, trustedSHA256 string, binaryTar, sourceTar io.Reader) (*PrivateCandidateInstallation, error) {
	return installPrivateCandidate(ctx, base, manifest, trustedSHA256, binaryTar, sourceTar, nil)
}
