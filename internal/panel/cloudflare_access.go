package panel

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

type cloudflareAccessState struct {
	once     sync.Once
	verifier *cloudflareVerifier
	err      error
}

type cloudflareVerifier struct {
	issuer, audience string
	client           *http.Client
	mu               sync.Mutex
	keys             map[string]*rsa.PublicKey
	fetched, expires time.Time
}

type cloudflareClaims struct {
	jwt.RegisteredClaims
	Email         string `json:"email"`
	Type          string `json:"type"`
	CommonName    string `json:"common_name"`
	EmailVerified *bool  `json:"email_verified,omitempty"`
}

type cloudflareIdentity struct{ Subject, Email string }
type cloudflareIdentityKey struct{}

var cloudflareTeamPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$`)
var cloudflareAudiencePattern = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
var cloudflareUsernameCharacters = regexp.MustCompile(`[^a-z0-9]+`)

func cloudflareSettings(cfg Config) (string, string, error) {
	team := strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(strings.TrimSpace(cfg.CloudflareAccessTeamDomain)), "https://"), "/")
	audience := strings.TrimSpace(cfg.CloudflareAccessAudience)
	if team == "" && audience == "" && len(cfg.CloudflareAccessLinkAdminEmails) == 0 {
		return "", "", nil
	}
	if !cloudflareTeamPattern.MatchString(team) || !cloudflareAudiencePattern.MatchString(audience) {
		return "", "", fmt.Errorf("Cloudflare Access requires a valid *.cloudflareaccess.com team domain and 64-character application AUD")
	}
	for _, email := range cfg.CloudflareAccessLinkAdminEmails {
		if _, err := cloudflareEmail(email); err != nil {
			return "", "", fmt.Errorf("invalid Cloudflare administrator linking email")
		}
	}
	return "https://" + team, audience, nil
}

func cloudflareEmail(email string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(email))
	address, err := mail.ParseAddress(value)
	if err != nil || len(value) > 254 || address.Address != value || !strings.Contains(value, "@") {
		return "", errors.New("invalid identity email")
	}
	return value, nil
}

func (a *App) cloudflareEnabled() bool {
	return a.Config.CloudflareAccessTeamDomain != "" || a.Config.CloudflareAccessAudience != ""
}

func (a *App) cloudflareBrowserRequest(r *http.Request) bool {
	if !a.cloudflareEnabled() || !strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	if r.Header.Get("Cf-Access-Jwt-Assertion") != "" || !loopbackRequest(r) || !developmentHost(r) {
		return true
	}
	// A tunnel can connect over loopback and override Host. Forwarded traffic
	// still must not inherit the direct local password-recovery exception.
	for _, header := range []string{"Cf-Ray", "Cf-Connecting-Ip", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host"} {
		if r.Header.Get(header) != "" {
			return true
		}
	}
	return false
}

func (a *App) accessVerifier() (*cloudflareVerifier, error) {
	a.cloudflare.once.Do(func() {
		issuer, audience, err := cloudflareSettings(a.Config)
		if err != nil {
			a.cloudflare.err = err
			return
		}
		if issuer == "" {
			a.cloudflare.err = errors.New("Cloudflare Access is not configured")
			return
		}
		client := http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		if a.HTTP != nil {
			client.Transport = a.HTTP.Transport
		}
		a.cloudflare.verifier = &cloudflareVerifier{issuer: issuer, audience: audience, client: &client}
	})
	return a.cloudflare.verifier, a.cloudflare.err
}

func (v *cloudflareVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now()
	if key := v.keys[kid]; key != nil && now.Before(v.expires) {
		return key, nil
	}
	// A random kid must not trigger an unbounded number of network requests.
	if !v.fetched.IsZero() && now.Sub(v.fetched) < time.Minute {
		return nil, errors.New("Access signing key unavailable")
	}
	v.fetched = now
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.issuer+"/cdn-cgi/access/certs", nil)
	if err != nil {
		return nil, err
	}
	response, err := v.client.Do(req)
	if err != nil {
		return nil, errors.New("Access signing keys could not be fetched")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("Access signing keys unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, errors.New("invalid Access signing key response")
	}
	var document struct {
		Keys []struct{ Kty, Kid, Use, Alg, N, E string }
	}
	if json.Unmarshal(data, &document) != nil || len(document.Keys) > 32 {
		return nil, errors.New("invalid Access signing keys")
	}
	keys := map[string]*rsa.PublicKey{}
	for _, key := range document.Keys {
		if key.Kty != "RSA" || key.Kid == "" || len(key.Kid) > 256 || (key.Use != "" && key.Use != "sig") || (key.Alg != "" && key.Alg != "RS256") {
			continue
		}
		n, ne := base64.RawURLEncoding.DecodeString(key.N)
		e, ee := base64.RawURLEncoding.DecodeString(key.E)
		if ne != nil || ee != nil || len(n) < 256 || len(n) > 1024 || len(e) < 1 || len(e) > 4 {
			continue
		}
		exponent := new(big.Int).SetBytes(e).Int64()
		if exponent < 3 || exponent > 2147483647 || exponent%2 == 0 {
			continue
		}
		keys[key.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exponent)}
	}
	if len(keys) == 0 {
		return nil, errors.New("Access has no usable signing keys")
	}
	v.keys = keys
	v.expires = now.Add(time.Hour)
	if key := keys[kid]; key != nil {
		return key, nil
	}
	return nil, errors.New("unknown Access signing key")
}

func (v *cloudflareVerifier) verify(ctx context.Context, raw string) (cloudflareIdentity, error) {
	var identity cloudflareIdentity
	if raw == "" || len(raw) > 16384 {
		return identity, errors.New("missing or oversized Access assertion")
	}
	claims := &cloudflareClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok || kid == "" || len(kid) > 256 {
			return nil, errors.New("invalid Access key ID")
		}
		return v.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !token.Valid {
		return identity, errors.New("invalid Cloudflare Access assertion")
	}
	email, err := cloudflareEmail(claims.Email)
	if err != nil || claims.Type != "app" || claims.Subject == "" || len(claims.Subject) > 512 || claims.CommonName != "" || claims.IssuedAt == nil || claims.EmailVerified != nil && !*claims.EmailVerified {
		return identity, errors.New("Access assertion does not identify a verified user")
	}
	return cloudflareIdentity{Subject: v.issuer + "|" + claims.Subject, Email: email}, nil
}

func (a *App) authenticateCloudflare(r *http.Request) (*http.Request, error) {
	verifier, err := a.accessVerifier()
	if err != nil {
		return r, APIError{503, "AccessConfigurationException", "Cloudflare Access login is not configured correctly."}
	}
	headers := r.Header.Values("Cf-Access-Jwt-Assertion")
	if len(headers) != 1 {
		return r, APIError{401, "AuthenticationException", "Sign in through Cloudflare Access."}
	}
	identity, err := verifier.verify(r.Context(), headers[0])
	if err != nil {
		return r, APIError{401, "AuthenticationException", "Cloudflare Access could not verify this login. Sign in again."}
	}
	id, err := a.cloudflareUser(r.Context(), identity)
	if err != nil {
		return r, err
	}
	r = WithUser(r, id)
	return r.WithContext(context.WithValue(r.Context(), cloudflareIdentityKey{}, true)), nil
}

func (a *App) cloudflareUser(ctx context.Context, identity cloudflareIdentity) (int64, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	// Serialize first-use provisioning, including simultaneous browser API calls.
	for _, lock := range []string{"voltra-access-subject:" + identity.Subject, "voltra-access-email:" + identity.Email} {
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", lock); err != nil {
			return 0, err
		}
	}
	var id int64
	var disabled bool
	err = tx.QueryRow(ctx, "SELECT id,disabled FROM users WHERE access_subject=$1 FOR UPDATE", identity.Subject).Scan(&id, &disabled)
	if err == nil {
		if disabled {
			return 0, forbidden()
		}
		return id, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	rows, err := tx.Query(ctx, "SELECT id,COALESCE(access_subject,''),root_admin,disabled FROM users WHERE lower(email)=$1 ORDER BY id FOR UPDATE", identity.Email)
	if err != nil {
		return 0, err
	}
	var subject string
	var admin bool
	count := 0
	for rows.Next() {
		count++
		if err = rows.Scan(&id, &subject, &admin, &disabled); err != nil {
			rows.Close()
			return 0, err
		}
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return 0, err
	}
	if count > 1 {
		return 0, APIError{403, "AccessIdentityException", "Multiple panel accounts match this identity. Contact the panel administrator."}
	}
	if count == 1 {
		if disabled || subject != "" {
			return 0, forbidden()
		}
		if admin {
			allowed := false
			for _, email := range a.Config.CloudflareAccessLinkAdminEmails {
				if strings.EqualFold(strings.TrimSpace(email), identity.Email) {
					allowed = true
				}
			}
			if !allowed {
				return 0, APIError{403, "AccessIdentityException", "This administrator account requires explicit Cloudflare linking by the panel operator."}
			}
		}
		if _, err = tx.Exec(ctx, "UPDATE users SET access_subject=$1,updated_at=now() WHERE id=$2", identity.Subject, id); err != nil {
			return 0, err
		}
	} else {
		prefix := strings.Trim(cloudflareUsernameCharacters.ReplaceAllString(strings.SplitN(identity.Email, "@", 2)[0], "-"), "-")
		if len(prefix) > 24 {
			prefix = prefix[:24]
		}
		if prefix == "" {
			prefix = "player"
		}
		for attempt := 0; attempt < 3; attempt++ {
			err = tx.QueryRow(ctx, `INSERT INTO users(uuid,username,email,name_first,access_subject,root_admin) VALUES($1,$2,$3,$4,$5,false) ON CONFLICT(username) DO NOTHING RETURNING id`, newUUID(), prefix+"-"+randomToken(4), identity.Email, prefix, identity.Subject).Scan(&id)
			if !errors.Is(err, pgx.ErrNoRows) {
				break
			}
		}
		if err != nil {
			return 0, err
		}
	}
	event := "auth:cloudflare:linked"
	if count == 0 {
		event = "auth:cloudflare:created"
	}
	if _, err = tx.Exec(ctx, "INSERT INTO activity_logs(actor_id,event,properties) VALUES($1,$2,'{}'::jsonb)", id, event); err != nil {
		return 0, err
	}
	return id, tx.Commit(ctx)
}
