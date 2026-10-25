package steamexec

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
)

// PrivateContentRequest is sent exclusively over an inherited private pipe.
// Callers own account policy, encryption-at-rest and server/owner authorization.
type PrivateContentRequest struct {
	Operation             string         `json:"operation"`
	Username              string         `json:"username,omitempty"`
	Password              string         `json:"password,omitempty"`
	Guard                 string         `json:"guard,omitempty"`
	Branch                string         `json:"branch"`
	BetaPassword          string         `json:"beta_password,omitempty"`
	AppID                 uint32         `json:"app_id"`
	ParentFieldsValidated bool           `json:"parent_fields_validated"`
	Content               map[string]any `json:"content"`
}

func (PrivateContentRequest) String() string { return "PrivateContentRequest [private]" }

type PrivateGuardChallenge struct {
	Type        string `json:"type"`
	ChallengeID string `json:"challenge_id"`
	Kind        string `json:"kind"`
}
type PrivateGuardReply struct {
	ChallengeID string  `json:"challenge_id"`
	Kind        string  `json:"kind"`
	Code        *string `json:"code,omitempty"`
	Accepted    *bool   `json:"accepted,omitempty"`
}

func (PrivateGuardReply) String() string { return "PrivateGuardReply [private]" }

type PrivateContentEvent struct {
	Type                     string          `json:"type"`
	Status                   string          `json:"status"`
	Code                     string          `json:"code"`
	ChallengeID              string          `json:"challenge_id"`
	Kind                     string          `json:"kind"`
	Receipt                  json.RawMessage `json:"receipt"`
	NativeAcceptanceVerified *bool           `json:"native_acceptance_verified"`
}

// PrivateContentProcess remains opt-in and is not wired into node capabilities.
// A second worker process independently reopens and hashes publication from the
// same FDs. Validate optionally adds caller policy after that mandatory check.
type PrivateContentProcess struct {
	Executable string
	// RuntimeRoot is an optional absolute pinned .NET installation directory.
	RuntimeRoot         string
	Target, Work, Cache *os.File
	Guard               func(context.Context, PrivateGuardChallenge) (PrivateGuardReply, error)
	Validate            func(context.Context, json.RawMessage) error
	// Progress receives fixed lifecycle labels only, never worker text/secrets.
	Progress func(string)
}

const privateFrameLimit = 65536

var errPrivateProtocol = errors.New("private Steam worker protocol rejected")

func privateWriteFrame(w io.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return errPrivateProtocol
	}
	defer clear(data)
	if len(data) == 0 || len(data) > privateFrameLimit {
		return errPrivateProtocol
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(data)))
	if err = privateWriteAll(w, header[:]); err != nil {
		return errPrivateProtocol
	}
	if privateWriteAll(w, data) != nil {
		return errPrivateProtocol
	}
	return nil
}
func privateWriteAll(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}
func privateReadFrame(r io.Reader, value any) error {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return errPrivateProtocol
	}
	n := binary.LittleEndian.Uint32(header[:])
	if n == 0 || n > privateFrameLimit {
		return errPrivateProtocol
	}
	data := make([]byte, n)
	defer clear(data)
	if _, err := io.ReadFull(r, data); err != nil {
		return errPrivateProtocol
	}
	if json.Unmarshal(data, value) != nil {
		return errPrivateProtocol
	}
	return nil
}
