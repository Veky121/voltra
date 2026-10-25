package panel

import (
	"context"
	"net/http"
	"strconv"

	"golang.org/x/crypto/bcrypt"
)

func hashSFTPPassword(password any) (string, error) {
	p, ok := password.(string)
	if !ok || len(p) < 12 || len(p) > 72 {
		return "", bad("SFTP passwords must contain between 12 and 72 bytes.")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p), 12)
	return string(hash), err
}

func validSFTPPassword(hash, password string) bool {
	return hash != "" && len(password) <= 72 && bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Share persistent attempt limits across panel processes. Buckets contain hashes,
// never credentials. Successful attempts do not reset the counter.
func (a *App) sftpPasswordAttempt(ctx context.Context, bucket string) error {
	var attempts int
	err := a.DB.QueryRow(ctx, `INSERT INTO login_attempts(bucket,attempts) VALUES($1,1)
		ON CONFLICT(bucket) DO UPDATE SET
		attempts=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
		window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END
		RETURNING attempts`, pairingHash("sftp:"+bucket)).Scan(&attempts)
	if err != nil {
		return err
	}
	if attempts > 20 {
		return APIError{429, "SFTPPasswordRateLimited", "Too many password attempts. Try again in 15 minutes."}
	}
	return nil
}

func (a *App) accountSFTPPassword(w http.ResponseWriter, r *http.Request) {
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	// API keys cannot establish or replace a user's interactive credential.
	if _, ok := r.Context().Value(apiKeyContextKey{}).(M); ok {
		fail(w, forbidden())
		return
	}
	a.saveSFTPPassword(w, r, num(u["id"]), num(u["id"]), false)
}

func (a *App) adminSFTPPassword(w http.ResponseWriter, r *http.Request) {
	actor, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("user"), 10, 64)
	if err != nil || id <= 0 {
		fail(w, notFound())
		return
	}
	a.saveSFTPPassword(w, r, id, num(actor["id"]), true)
}

func (a *App) saveSFTPPassword(w http.ResponseWriter, r *http.Request, id, actor int64, admin bool) {
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	if err = a.sftpPasswordAttempt(r.Context(), "manage:"+str(actor)); err != nil {
		fail(w, err)
		return
	}
	hash, err := hashSFTPPassword(d["password"])
	if err != nil {
		fail(w, err)
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var current string
	err = tx.QueryRow(r.Context(), "SELECT COALESCE(sftp_password_hash,'') FROM users WHERE id=$1 FOR UPDATE", id).Scan(&current)
	if err != nil {
		fail(w, err)
		return
	}
	if !admin && current != "" && !validSFTPPassword(current, str(d["current_password"])) {
		fail(w, APIError{403, "InvalidSFTPPassword", "The current SFTP password is incorrect."})
		return
	}
	if _, err = tx.Exec(r.Context(), "UPDATE users SET sftp_password_hash=$1,updated_at=now() WHERE id=$2", hash, id); err != nil {
		fail(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, err)
		return
	}
	_ = a.audit(r.Context(), actor, 0, "user:sftp-password.update", M{"user_id": id, "administrator_reset": admin})
	writeJSON(w, http.StatusNoContent, nil)
}
