package panel

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type M = map[string]any
type Config struct {
	ArtworkDirectory                                                                       string
	Listen, DatabaseURL, PublicURL, DaemonURL, WebDir, LocalesDir, EncryptionKey, Timezone string
	DevMode                                                                                bool
	DevUserID                                                                              int64
	ConsoleHistoryLines                                                                    int
}
type App struct {
	DB                 *pgxpool.Pool
	Config             Config
	HTTP               *http.Client
	connectorHub       *connectorHub
	privateSteam       *privateSteamHub
	managedHTTPS       *managedHTTPS
	artworkCache       serverArtworkCache
	artworkLibraryOnce sync.Once
	artworkLibrary     *panelArtworkLibrary
}
type APIError struct {
	Status       int
	Code, Detail string
}

func (e APIError) Error() string { return e.Detail }
func bad(detail string) error    { return APIError{422, "ValidationException", detail} }
func forbidden() error {
	return APIError{403, "ForbiddenException", "You do not have permission to perform this action."}
}
func notFound() error {
	return APIError{404, "NotFoundException", "The requested resource was not found."}
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(value)
	}
}
func fail(w http.ResponseWriter, err error) {
	status, code, detail := 500, "InternalServerError", "The request could not be completed."
	var api APIError
	var apiPointer *APIError
	if errors.As(err, &api) {
		status, code, detail = api.Status, api.Code, api.Detail
	} else if errors.As(err, &apiPointer) {
		status, code, detail = apiPointer.Status, apiPointer.Code, apiPointer.Detail
	} else if errors.Is(err, pgx.ErrNoRows) {
		status, code, detail = 404, "NotFoundException", "The requested resource was not found."
	} else {
		var pg *pgconn.PgError
		if errors.As(err, &pg) {
			switch pg.Code {
			case "23505":
				status, code, detail = 409, "ConflictException", "A resource with these unique fields already exists."
			case "23503":
				status, code, detail = 409, "ConflictException", "This resource is referenced by another resource or references a missing resource."
			case "23514", "23502", "22P02":
				status, code, detail = 422, "ValidationException", "One or more field values are invalid."
			}
		}
	}
	if status >= 500 {
		slog.Error("request failed", "error", err)
	}
	writeJSON(w, status, M{"errors": []M{{"code": code, "status": strconv.Itoa(status), "detail": detail}}})
}
func item(object string, attributes M) M { return M{"object": object, "attributes": attributes} }
func collection(object string, rows []M) M {
	data := make([]M, 0, len(rows))
	for _, r := range rows {
		data = append(data, item(object, r))
	}
	return M{"object": "list", "data": data}
}
func decode(r *http.Request) (M, error) {
	m, err := decodeRaw(r)
	if err != nil {
		return nil, err
	}
	return normalizeInput(m, "").(M), nil
}
func decodeRaw(r *http.Request) (M, error) {
	var m M
	dec := json.NewDecoder(io.LimitReader(r.Body, 4<<20+1))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, bad("A valid JSON object is required.")
	}
	if m == nil {
		return nil, bad("A JSON object is required.")
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, bad("Only one JSON object is allowed.")
	}
	return m, nil
}
func num(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int32:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}
func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
func boolean(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return b == "true" || b == "1"
	default:
		return num(v) != 0
	}
}
func asMap(v any) M {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return M{}
}
func asSlice(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	if a, ok := v.([]string); ok {
		r := make([]any, len(a))
		for i, s := range a {
			r[i] = s
		}
		return r
	}
	return []any{}
}
func now() string     { return time.Now().UTC().Format(time.RFC3339Nano) }
func newUUID() string { return uuid.NewString() }
func randomToken(bytes int) string {
	data := make([]byte, bytes)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	return hex.EncodeToString(data)
}
func (a *App) seal(plaintext string) (string, error) {
	if a.Config.EncryptionKey == "" {
		return "", fmt.Errorf("ENCRYPTION_KEY is required for secrets")
	}
	key := sha256.Sum256([]byte(a.Config.EncryptionKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), []byte("pteroclone:v1"))
	return "enc:v1:" + base64.RawURLEncoding.EncodeToString(sealed), nil
}
func (a *App) unseal(value string) (string, error) {
	if !strings.HasPrefix(value, "enc:v1:") {
		return "", fmt.Errorf("invalid encrypted secret format")
	}
	if a.Config.EncryptionKey == "" {
		return "", fmt.Errorf("ENCRYPTION_KEY is required for secrets")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "enc:v1:"))
	if err != nil {
		return "", err
	}
	key := sha256.Sum256([]byte(a.Config.EncryptionKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("invalid encrypted secret length")
	}
	plaintext, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte("pteroclone:v1"))
	return string(plaintext), err
}

func (a *App) query(ctx context.Context, sql string, args ...any) ([]M, error) {
	rs, err := a.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	out := []M{}
	names := rs.FieldDescriptions()
	for rs.Next() {
		values, err := rs.Values()
		if err != nil {
			return nil, err
		}
		row := M{}
		for i, v := range values {
			if n, ok := v.(int32); ok {
				v = int64(n)
			}
			row[names[i].Name] = v
		}
		out = append(out, row)
	}
	return out, rs.Err()
}
func (a *App) one(ctx context.Context, sql string, args ...any) (M, error) {
	rows, err := a.query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, pgx.ErrNoRows
	}
	return rows[0], nil
}
func (a *App) exec(ctx context.Context, sql string, args ...any) error {
	_, err := a.DB.Exec(ctx, sql, args...)
	return err
}

var identifierRE = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

func quoted(s string) (string, error) {
	if !identifierRE.MatchString(s) {
		return "", fmt.Errorf("invalid SQL identifier")
	}
	return `"` + s + `"`, nil
}
func (a *App) insert(ctx context.Context, table string, data M) (M, error) {
	t, err := quoted(table)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	cols, slots := []string{}, []string{}
	args := []any{}
	for _, k := range keys {
		c, err := quoted(k)
		if err != nil {
			return nil, err
		}
		cols = append(cols, c)
		args = append(args, data[k])
		slots = append(slots, fmt.Sprintf("$%d", len(args)))
	}
	if len(keys) == 0 {
		return a.one(ctx, "INSERT INTO "+t+" DEFAULT VALUES RETURNING *")
	}
	return a.one(ctx, "INSERT INTO "+t+" ("+strings.Join(cols, ",")+") VALUES ("+strings.Join(slots, ",")+") RETURNING *", args...)
}
func (a *App) update(ctx context.Context, table string, id int64, data M) (M, error) {
	t, err := quoted(table)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return a.one(ctx, "SELECT * FROM "+t+" WHERE id=$1", id)
	}
	keys := []string{}
	for k := range data {
		if k == "id" {
			return nil, bad("Resource IDs cannot be changed.")
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	sets := []string{}
	args := []any{}
	for _, k := range keys {
		c, err := quoted(k)
		if err != nil {
			return nil, err
		}
		args = append(args, data[k])
		sets = append(sets, fmt.Sprintf("%s=$%d", c, len(args)))
	}
	args = append(args, id)
	if _, ok := data["updated_at"]; !ok {
		sets = append(sets, "updated_at=now()")
	}
	return a.one(ctx, "UPDATE "+t+" SET "+strings.Join(sets, ",")+fmt.Sprintf(" WHERE id=$%d RETURNING *", len(args)), args...)
}
func (a *App) audit(ctx context.Context, userID, serverID int64, event string, properties M) error {
	var u, s any
	if userID > 0 {
		u = userID
	}
	if serverID > 0 {
		s = serverID
	}
	if properties == nil {
		properties = M{}
	}
	return a.exec(ctx, "INSERT INTO activity_logs(actor_id,server_id,event,properties) VALUES($1,$2,$3,$4)", u, s, event, properties)
}

type userContextKey struct{}

func UserID(r *http.Request) int64 { id, _ := r.Context().Value(userContextKey{}).(int64); return id }
func WithUser(r *http.Request, id int64) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userContextKey{}, id))
}
func loopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func developmentHost(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.ToLower(strings.Trim(host, "[]")), ".")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

//go:embed schema.sql
var schema string

func New(ctx context.Context, cfg Config) (*App, error) {
	if _, err := (&App{Config: cfg}).timezone(ctx); err != nil {
		return nil, err
	}
	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	// The operational CLI can apply an additive schema migration while the
	// server remains online. Describe per execution avoids stale SELECT * plans.
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	a := &App{DB: pool, Config: cfg, HTTP: &http.Client{Timeout: 90 * time.Second}}
	if err = a.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	return a, nil
}
func (a *App) migrate(ctx context.Context) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||'pteroclone-schema',0))"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS panel_schema_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(schema))
	version := hex.EncodeToString(digest[:])
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM panel_schema_versions WHERE version=$1)", version).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err = tx.Exec(ctx, schema); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO panel_schema_versions(version) VALUES($1)", version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (a *App) Close() {
	a.closePrivateSteam()
	a.closeHTTPS()
	a.connectors().close()
	a.DB.Close()
}
func (a *App) SeedDevelopment(ctx context.Context) error {
	if !a.Config.DevMode {
		return nil
	}
	_, err := a.DB.Exec(ctx, `INSERT INTO users(uuid,username,email,name_first,name_last,root_admin) VALUES($1,'admin','admin@local.invalid','Local','Admin',true) ON CONFLICT(username) DO NOTHING`, newUUID())
	return err
}
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /locales/locale.json", a.localeJSON)
	mux.HandleFunc("GET /api/client/settings", a.clientSiteSettings)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := a.DB.Ping(r.Context()); err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 200, M{"status": "ok", "database": "postgresql", "identity_mode": map[bool]string{true: "local-development", false: "cloudflare-required"}[a.Config.DevMode]})
	})
	a.registerArtworkLibrary(mux)
	a.registerAccounts(mux)
	a.registerServerNavigation(mux)
	a.registerServerConfiguration(mux)
	a.registerDesktop(mux)
	a.registerSetup(mux)
	a.registerEggs(mux)
	a.registerInfrastructure(mux)
	a.registerNodePairing(mux)
	a.registerIntegrations(mux)
	a.registerProxyGateways(mux)
	a.registerGameLibrary(mux)
	a.registerSteam(mux)
	a.registerPrivateSteam(mux)
	a.registerSteamGames(mux)
	a.registerGameQuickSetup(mux)
	a.registerJava(mux)
	a.registerMinecraftRuntimeRules(mux)
	a.registerMinecraftContent(mux)
	a.registerLifecycle(mux)
	a.registerOperations(mux)
	a.registerCollaboration(mux)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, notFound()) })
	mux.HandleFunc("/", a.serveWeb)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				slog.Error("handler panic", "panic", p)
				fail(w, fmt.Errorf("panic: %v", p))
			}
		}()
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		normalizeQuery(r)
		setup, setupErr := a.setupState(r.Context())
		if setupErr != nil {
			fail(w, setupErr)
			return
		}
		localOnly := a.Config.DevMode && !setup.Completed || setup.Completed && setup.AccessMode == "local"
		if localOnly && !strings.HasPrefix(r.URL.Path, "/api/remote/") && !strings.HasPrefix(r.URL.Path, "/api/setup/probe/") && !developmentHost(r) {
			fail(w, forbidden())
			return
		}
		if r.URL.Path != "/healthz" && !strings.HasPrefix(r.URL.Path, "/api/remote/") {
			var maintenance bool
			err := a.DB.QueryRow(r.Context(), "SELECT COALESCE(value::text,'false')::boolean FROM settings WHERE key='app.maintenance'").Scan(&maintenance)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				fail(w, err)
				return
			}
			if maintenance {
				w.Header().Set("Retry-After", "60")
				fail(w, APIError{503, "MaintenanceException", "The panel is temporarily under maintenance."})
				return
			}
		}
		if !strings.HasPrefix(r.URL.Path, "/api/remote/") && r.URL.Path != "/healthz" {
			var err error
			if r.URL.Path == "/api/desktop/exchange" && r.Method == http.MethodPost {
				// The single-use pairing code authenticates this request.
			} else if strings.HasPrefix(pairingBearer(r), desktopTokenPrefix) {
				r, err = a.authenticateDesktop(r)
				if err != nil {
					fail(w, err)
					return
				}
			} else if r.Header.Get("Authorization") != "" {
				r, err = a.AuthenticateAPIKey(r)
				if err != nil {
					fail(w, err)
					return
				}
			} else if id, sessionErr := a.sessionUser(r); sessionErr != nil {
				fail(w, sessionErr)
				return
			} else if id > 0 {
				r = WithUser(r, id)
			} else if a.Config.DevMode && !setup.Completed && loopbackRequest(r) {
				id := a.Config.DevUserID
				if id == 0 {
					id = 1
				}
				if header := r.Header.Get("X-Dev-User-ID"); header != "" {
					n, e := strconv.ParseInt(header, 10, 64)
					if e != nil || n < 1 {
						fail(w, bad("Invalid development user ID."))
						return
					}
					id = n
				}
				r = WithUser(r, id)
			} else if strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/api/setup/") && !strings.HasPrefix(r.URL.Path, "/api/auth/") {
				fail(w, APIError{401, "AuthenticationException", "Sign in to continue."})
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
				if !a.browserOrigin(r, setup) {
					fail(w, forbidden())
					return
				}
				if origin := r.Header.Get("Origin"); origin != "" && !setup.Completed && !strings.HasPrefix(r.URL.Path, "/api/setup/") && !strings.HasPrefix(r.URL.Path, "/api/auth/") {
					localOrigin := a.Config.DevMode && loopbackRequest(r) && (origin == "http://localhost:5180" || origin == "http://127.0.0.1:5180" || origin == "http://localhost:8088" || origin == "http://127.0.0.1:8088")
					if origin != a.Config.PublicURL && !localOrigin {
						fail(w, forbidden())
						return
					}
				}
			}
		}
		// Go's ServeMux cannot represent the native external-ID lookup beside
		// /servers/{server}/databases. Dispatch this literal prefix first.
		if r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/application/servers/external/") {
			external := strings.TrimPrefix(r.URL.Path, "/api/application/servers/external/")
			if external == "" || strings.Contains(external, "/") {
				fail(w, notFound())
				return
			}
			r.SetPathValue("external", external)
			a.lifecycleExternal(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (a *App) serveWeb(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, notFound())
		return
	}
	root, err := filepath.Abs(a.Config.WebDir)
	if err != nil {
		fail(w, err)
		return
	}
	name := filepath.Join(root, filepath.FromSlash(r.URL.Path))
	rel, err := filepath.Rel(root, name)
	if err != nil || strings.HasPrefix(rel, "..") {
		fail(w, notFound())
		return
	}
	if info, e := os.Stat(name); e == nil && !info.IsDir() {
		if strings.EqualFold(filepath.Ext(name), ".html") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFile(w, r, name)
		return
	}
	// A stale lazy-import URL must not receive the SPA HTML shell as JavaScript.
	// Keep extensionless browser routes working, but return real asset failures.
	if strings.HasPrefix(r.URL.Path, "/assets/") || strings.HasPrefix(r.URL.Path, "/artwork/") || strings.HasPrefix(r.URL.Path, "/fonts/") || filepath.Ext(name) != "" {
		w.Header().Set("Cache-Control", "no-store")
		http.NotFound(w, r)
		return
	}
	if _, err = os.Stat(filepath.Join(root, "index.html")); err != nil {
		http.Error(w, "Frontend is not built. Run npm install and npm run build in web/.", 503)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(root, "index.html"))
}
