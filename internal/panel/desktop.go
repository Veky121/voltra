package panel

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const desktopTokenPrefix = "vdt_"

func (a *App) registerDesktop(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/client/account/desktop/pairing", a.createDesktopPairing)
	mux.HandleFunc("GET /api/client/account/desktop/devices", a.desktopDevices)
	mux.HandleFunc("DELETE /api/client/account/desktop/devices/{device}", a.revokeDesktopDevice)
	mux.HandleFunc("POST /api/desktop/exchange", a.exchangeDesktopPairing)
}

// Desktop sessions are account sessions, distinct from scoped API keys. Never
// fall back to development identity when a supplied session is invalid.
func (a *App) authenticateDesktop(r *http.Request) (*http.Request, error) {
	token := pairingBearer(r)
	if !strings.HasPrefix(token, desktopTokenPrefix) || len(token) != len(desktopTokenPrefix)+64 {
		return r, unauthorizedKey()
	}
	device, err := a.one(r.Context(), `UPDATE desktop_devices SET last_used_at=now()
 WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()
 RETURNING user_id`, pairingHash(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return r, unauthorizedKey()
	}
	if err != nil {
		return r, err
	}
	r = WithUser(r, num(device["user_id"]))
	_, err = a.user(r)
	return r, err
}

func (a *App) desktopAccount(r *http.Request) (M, error) {
	// API keys must not turn a scoped machine credential into a full session.
	if _, ok := r.Context().Value(apiKeyContextKey{}).(M); ok {
		return nil, forbidden()
	}
	return a.user(r)
}

func (a *App) createDesktopPairing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user, err := a.desktopAccount(r)
	if err != nil {
		fail(w, err)
		return
	}
	panelURL, err := a.desktopPairingPublicURL(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	// 128 bits makes the unauthenticated exchange unguessable, without relying
	// on an IP limiter that can break behind a shared reverse proxy.
	var entropy [16]byte
	if _, err = rand.Read(entropy[:]); err != nil {
		fail(w, err)
		return
	}
	code := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(entropy[:])
	expires := time.Now().UTC().Add(10 * time.Minute)
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialise generation per account and replace its previous pending code.
	if _, err = tx.Exec(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", user["id"]); err == nil {
		_, err = tx.Exec(r.Context(), "DELETE FROM desktop_pairings WHERE user_id=$1 OR expires_at<now()", user["id"])
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), "INSERT INTO desktop_pairings(code_hash,user_id,expires_at) VALUES($1,$2,$3)", pairingHash(code), user["id"], expires)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 201, item("desktop_pairing", M{"code": code, "panel_url": panelURL, "expires_at": expires}))
}

func (a *App) exchangeDesktopPairing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	code := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(str(d["code"])), "-", ""))
	if len(code) != 26 {
		fail(w, unauthorizedKey())
		return
	}
	name := strings.TrimSpace(str(d["name"]))
	if name == "" || len(name) > 100 {
		fail(w, bad("Enter a device name of 1 to 100 characters."))
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var userID int64
	// DELETE RETURNING consumes exactly once even for concurrent exchanges.
	err = tx.QueryRow(r.Context(), `DELETE FROM desktop_pairings p USING users u
 WHERE p.code_hash=$1 AND p.expires_at>now() AND u.id=p.user_id AND NOT u.disabled
 RETURNING p.user_id`, pairingHash(code)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, unauthorizedKey())
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	token, id := desktopTokenPrefix+randomToken(32), newUUID()
	expires := time.Now().UTC().Add(90 * 24 * time.Hour)
	_, err = tx.Exec(r.Context(), `INSERT INTO desktop_devices(id,user_id,name,token_hash,expires_at)
 VALUES($1,$2,$3,$4,$5)`, id, userID, name, pairingHash(token), expires)
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 201, item("desktop_session", M{"device_id": id, "token": token, "expires_at": expires}))
}

func (a *App) desktopDevices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	user, err := a.desktopAccount(r)
	if err != nil {
		fail(w, err)
		return
	}
	devices, err := a.query(r.Context(), `SELECT id,name,created_at,last_used_at,expires_at,revoked_at
 FROM desktop_devices WHERE user_id=$1 ORDER BY created_at DESC`, user["id"])
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, collection("desktop_device", devices))
}

func (a *App) revokeDesktopDevice(w http.ResponseWriter, r *http.Request) {
	user, err := a.desktopAccount(r)
	if err != nil {
		fail(w, err)
		return
	}
	result, err := a.DB.Exec(r.Context(), "UPDATE desktop_devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2", r.PathValue("device"), user["id"])
	if err != nil {
		fail(w, err)
		return
	}
	if result.RowsAffected() == 0 {
		fail(w, notFound())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
