// devseed creates ordinary local panel records. It never contacts production.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"voltra/internal/panel"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if os.Getenv("VOLTRA_LOCAL_DEV") != "true" {
		return fmt.Errorf("devseed requires VOLTRA_LOCAL_DEV=true")
	}
	// libpq-compatible environment values such as PGOPTIONS must not redirect
	// the schema or add connection settings to this dedicated runtime.
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(strings.ToUpper(key), "PG") {
			if err := os.Unsetenv(key); err != nil {
				return err
			}
		}
	}
	databaseURL := os.Getenv("DATABASE_URL")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := panel.CheckLocalDevelopmentDatabase(ctx, databaseURL); err != nil {
		return err
	}
	if len(os.Getenv("ENCRYPTION_KEY")) < 32 {
		return fmt.Errorf("a dedicated local encryption key is required")
	}
	cfg := panel.Config{DatabaseURL: databaseURL, EncryptionKey: os.Getenv("ENCRYPTION_KEY"), Listen: "127.0.0.1:18089", PublicURL: "http://127.0.0.1:5181", DaemonURL: "http://host.docker.internal:18089", Timezone: "UTC"}
	app, err := panel.New(ctx, cfg)
	if err != nil {
		return err
	}
	defer app.Close()
	inventory, wings, err := app.SeedLocalDevelopment(ctx, panel.LocalDevelopmentOptions{AdminPassword: os.Getenv("VOLTRA_DEV_ADMIN_PASSWORD"), MemberPassword: os.Getenv("VOLTRA_DEV_MEMBER_PASSWORD"), WingsTokenID: os.Getenv("VOLTRA_DEV_WINGS_TOKEN_ID"), WingsToken: os.Getenv("VOLTRA_DEV_WINGS_TOKEN")})
	if err != nil {
		return err
	}
	if err := ensureToolingKey(ctx, app); err != nil {
		return err
	}
	for name, value := range map[string]any{"wings.json": wings, "seed.json": inventory} {
		data, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		directory := filepath.Join(".local", "dev")
		if err = os.MkdirAll(directory, 0700); err != nil {
			return err
		}
		temporary := filepath.Join(directory, name+".tmp")
		if err = os.WriteFile(temporary, append(data, '\n'), 0600); err != nil {
			return err
		}
		if err = os.Rename(temporary, filepath.Join(directory, name)); err != nil {
			return err
		}
	}
	return json.NewEncoder(os.Stdout).Encode(inventory)
}

// The tooling credential uses ordinary client API authentication. Keep browser
// sign-in rate limits intact and reuse this key for repeated agent operations.
func ensureToolingKey(ctx context.Context, app *panel.App) error {
	path := filepath.Join(".local", "dev", "tooling-key.json")
	const memo = "Local workspace tooling"
	var saved struct {
		Identifier string `json:"identifier"`
		Token      string `json:"token"`
	}
	data, err := os.ReadFile(path)
	if err == nil {
		if err = json.Unmarshal(data, &saved); err != nil || saved.Identifier == "" || saved.Token == "" {
			return errors.New("invalid local tooling credential file")
		}
		hash := sha256.Sum256([]byte(saved.Token))
		var valid bool
		err = app.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.identifier=$1 AND k.token_hash=$2 AND k.type='client' AND u.username='admin' AND u.root_admin AND NOT u.disabled AND (k.expires_at IS NULL OR k.expires_at>now()))`, saved.Identifier, hex.EncodeToString(hash[:])).Scan(&valid)
		if err != nil {
			return err
		}
		if !valid {
			return errors.New("local tooling key was revoked or changed; create a replacement deliberately instead of restoring it on startup")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var exists bool
	if err = app.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM api_keys WHERE memo=$1)", memo).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return errors.New("local tooling key file is missing; recover or explicitly rotate the existing credential")
	}
	bytes := make([]byte, 32)
	if _, err = rand.Read(bytes); err != nil {
		return err
	}
	saved.Identifier = hex.EncodeToString(bytes[:8])
	saved.Token = "ptlc_" + saved.Identifier + hex.EncodeToString(bytes[8:])
	hash := sha256.Sum256([]byte(saved.Token))
	var id int64
	err = app.DB.QueryRow(ctx, `INSERT INTO api_keys(user_id,identifier,token_hash,type,memo,allowed_ips,permissions) SELECT id,$1,$2,'client',$3,'["127.0.0.1"]','{}' FROM users WHERE username='admin' AND root_admin AND NOT disabled RETURNING id`, saved.Identifier, hex.EncodeToString(hash[:]), memo).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("local administrator is unavailable")
	}
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err == nil {
		var file *os.File
		file, err = os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			err = json.NewEncoder(file).Encode(saved)
			closeErr := file.Close()
			if err == nil {
				err = closeErr
			}
		}
	}
	if err != nil {
		_, _ = app.DB.Exec(ctx, "DELETE FROM api_keys WHERE id=$1 AND token_hash=$2", id, hex.EncodeToString(hash[:]))
		return err
	}
	return nil
}
