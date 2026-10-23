// Release tooling uses only the standard library. Never print signing keys.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var tagPattern = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(beta)\.([1-9][0-9]*)|-(nightly)\.([0-9]{8})\.([1-9][0-9]*))?$`)

type plan struct {
	Tag     string `json:"tag"`
	Version string `json:"version"`
	Channel string `json:"channel"`
}

func parseTag(tag string) (plan, error) {
	m := tagPattern.FindStringSubmatch(tag)
	if m == nil {
		return plan{}, errors.New("use vX.Y.Z, vX.Y.Z-beta.N, or vX.Y.Z-nightly.YYYYMMDD.RUN")
	}
	channel := "stable"
	if m[4] != "" {
		channel = "beta"
	}
	if m[6] != "" {
		channel = "nightly"
		if _, err := time.Parse("20060102", m[7]); err != nil {
			return plan{}, err
		}
	}
	return plan{tag, strings.TrimPrefix(tag, "v"), channel}, nil
}
func exclusive(path string, b []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func keygen(dir string) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	if err = exclusive(filepath.Join(dir, "private-key.b64"), []byte(base64.StdEncoding.EncodeToString(priv))); err != nil {
		return err
	}
	if err = exclusive(filepath.Join(dir, "public-key.b64"), []byte(base64.StdEncoding.EncodeToString(pub))); err != nil {
		return err
	}
	fmt.Println("Key files created. Keep the private file secret; do not commit it.")
	return nil
}

type artifact struct {
	URL           string `json:"url"`
	Filename      string `json:"filename"`
	Filetype      string `json:"filetype"`
	Size          int64  `json:"size"`
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	DigestAlgo    string `json:"digestAlgo"`
	Digest        string `json:"digest"`
	SignatureAlgo string `json:"signatureAlgo"`
	Signature     string `json:"signature"`
}
type manifest struct {
	SchemaVersion int        `json:"schemaVersion"`
	Version       string     `json:"version"`
	Channel       string     `json:"channel"`
	Name          string     `json:"name"`
	PublishedAt   string     `json:"publishedAt"`
	Artifacts     []artifact `json:"artifacts"`
}

func makeManifest(p plan, filename string, b []byte, priv ed25519.PrivateKey) manifest {
	sum := sha256.Sum256(b)
	return manifest{1, p.Version, p.Channel, "Voltra " + p.Version, time.Now().UTC().Format(time.RFC3339), []artifact{{"https://github.com/Veky121/voltra/releases/download/" + p.Tag + "/" + filename, filename, "exe", int64(len(b)), "windows", "amd64", "sha256", base64.StdEncoding.EncodeToString(sum[:]), "ed25519", base64.StdEncoding.EncodeToString(ed25519.Sign(priv, sum[:]))}}}
}
func run(args []string) error {
	if len(args) == 0 {
		return errors.New("commands: keygen DIR | plan TAG | manifest TAG EXE OUT | checksums OUT FILE...")
	}
	switch args[0] {
	case "keygen":
		if len(args) != 2 {
			return errors.New("keygen DIR")
		}
		return keygen(args[1])
	case "plan":
		if len(args) != 2 {
			return errors.New("plan TAG")
		}
		p, err := parseTag(args[1])
		if err != nil {
			return err
		}
		if out := os.Getenv("GITHUB_OUTPUT"); out != "" {
			f, err := os.OpenFile(out, os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			defer f.Close()
			fmt.Fprintf(f, "tag=%s\nversion=%s\nchannel=%s\n", p.Tag, p.Version, p.Channel)
		}
		return json.NewEncoder(os.Stdout).Encode(p)
	case "nightly":
		if len(args) != 4 {
			return errors.New("nightly VERSION_FILE YYYYMMDD RUN")
		}
		b, err := os.ReadFile(args[1])
		if err != nil {
			return err
		}
		base := strings.TrimSpace(string(b))
		stable, err := parseTag("v" + base)
		if err != nil || stable.Channel != "stable" {
			return errors.New("VERSION must contain a stable X.Y.Z base")
		}
		return run([]string{"plan", "v" + base + "-nightly." + args[2] + "." + args[3]})
	case "manifest":
		if len(args) != 4 {
			return errors.New("manifest TAG EXE OUT")
		}
		p, err := parseTag(args[1])
		if err != nil {
			return err
		}
		priv, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("VOLTRA_UPDATER_PRIVATE_KEY")))
		if err != nil || len(priv) != ed25519.PrivateKeySize {
			return errors.New("private key must be base64 of 64 raw Ed25519 bytes")
		}
		pub, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("VOLTRA_UPDATER_PUBLIC_KEY")))
		if err != nil || len(pub) != 32 || !ed25519.PublicKey(pub).Equal(ed25519.PrivateKey(priv).Public()) {
			return errors.New("public key does not match private key")
		}
		b, err := os.ReadFile(args[2])
		if err != nil {
			return err
		}
		m := makeManifest(p, filepath.Base(args[2]), b, priv)
		out, err := json.MarshalIndent(m, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(args[3], append(out, '\n'), 0644)
	case "checksums":
		if len(args) < 3 {
			return errors.New("checksums OUT FILE...")
		}
		var out strings.Builder
		for _, path := range args[2:] {
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(b)
			fmt.Fprintf(&out, "%s  %s\n", hex.EncodeToString(sum[:]), filepath.Base(path))
		}
		return os.WriteFile(args[1], []byte(out.String()), 0644)
	}
	return errors.New("unknown command")
}
func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
