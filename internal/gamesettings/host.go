// Package gamesettings reads and edits the native settings files of game
// servers: it finds a server's settings documents, parses each game's format
// into editable fields, validates changes and writes the patched bytes back.
//
// The package owns no HTTP routes, database or Wings client. Package panel
// registers the routes and passes a Host (per-request services such as file
// access through Wings, identity and the database) to NewService, and calls
// Configure once with Deps (process-wide catalog facts that panel owns).
//
// Per-game recipe paths, settings paths and parsers are exported because
// panel's integration tests, which need panel's database and Wings fixtures,
// exercise them directly.
package gamesettings

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// Host is what game settings needs from the panel that serves it.
type Host interface {
	// Server files, read and written through Wings.
	QuickSetupRead(ctx context.Context, server M, file string) ([]byte, bool, error)
	QuickSetupWrite(ctx context.Context, server M, file string, data []byte) error
	QuickSetupStopped(ctx context.Context, server M) error
	QuickSetupList(ctx context.Context, server M, folder string) ([]M, bool, error)
	QuickSetupListExisting(ctx context.Context, server M, folder string) ([]M, error)
	QuickSetupFolderExists(ctx context.Context, server M, folder string) (bool, error)
	QuickSetupFolders(ctx context.Context, server M, game string, values map[string]string) ([]M, error)

	// Request identity and permissions.
	Server(r *http.Request, permission string) (M, error)
	User(r *http.Request) (M, error)
	Can(ctx context.Context, user, server M, permission string) bool

	// Server state and storage.
	ServerConfig(ctx context.Context, server M) (M, error)
	ServerEffectiveEgg(ctx context.Context, server M) (M, error)
	Query(ctx context.Context, sql string, args ...any) ([]M, error)
	Begin(ctx context.Context) (pgx.Tx, error)
	Audit(ctx context.Context, userID, serverID int64, event string, properties M) error

	// Satisfactory's managed player limit lives in panel's managed-players code.
	SatisfactoryPlayersAuthority(ctx context.Context, server, egg M, file string) (string, error)
	CheckSatisfactoryPlayersAuthority(ctx context.Context, server, egg M, file, before string) error
	PersistSatisfactoryPlayers(ctx context.Context, tx pgx.Tx, server, egg M, file string, patch map[string]string) error

	// Fail writes err as panel's structured error response.
	Fail(w http.ResponseWriter, err error)
}

// Service serves game settings for one panel.
type Service struct{ host Host }

func NewService(host Host) *Service { return &Service{host: host} }

// The moved handlers call these with their original panel names.
func (a *Service) quickSetupRead(ctx context.Context, s M, file string) ([]byte, bool, error) {
	return a.host.QuickSetupRead(ctx, s, file)
}
func (a *Service) quickSetupWrite(ctx context.Context, s M, file string, data []byte) error {
	return a.host.QuickSetupWrite(ctx, s, file, data)
}
func (a *Service) quickSetupStopped(ctx context.Context, s M) error {
	return a.host.QuickSetupStopped(ctx, s)
}
func (a *Service) quickSetupList(ctx context.Context, s M, folder string) ([]M, bool, error) {
	return a.host.QuickSetupList(ctx, s, folder)
}
func (a *Service) quickSetupListExisting(ctx context.Context, s M, folder string) ([]M, error) {
	return a.host.QuickSetupListExisting(ctx, s, folder)
}
func (a *Service) quickSetupFolderExists(ctx context.Context, s M, folder string) (bool, error) {
	return a.host.QuickSetupFolderExists(ctx, s, folder)
}
func (a *Service) quickSetupFolders(ctx context.Context, s M, game string, values map[string]string) ([]M, error) {
	return a.host.QuickSetupFolders(ctx, s, game, values)
}
func (a *Service) server(r *http.Request, permission string) (M, error) {
	return a.host.Server(r, permission)
}
func (a *Service) user(r *http.Request) (M, error) { return a.host.User(r) }
func (a *Service) can(ctx context.Context, user, server M, permission string) bool {
	return a.host.Can(ctx, user, server, permission)
}
func (a *Service) serverConfig(ctx context.Context, server M) (M, error) {
	return a.host.ServerConfig(ctx, server)
}
func (a *Service) serverEffectiveEgg(ctx context.Context, server M) (M, error) {
	return a.host.ServerEffectiveEgg(ctx, server)
}
func (a *Service) query(ctx context.Context, sql string, args ...any) ([]M, error) {
	return a.host.Query(ctx, sql, args...)
}
func (a *Service) begin(ctx context.Context) (pgx.Tx, error) { return a.host.Begin(ctx) }
func (a *Service) audit(ctx context.Context, userID, serverID int64, event string, properties M) error {
	return a.host.Audit(ctx, userID, serverID, event, properties)
}
func (a *Service) satisfactoryPlayersAuthority(ctx context.Context, server, egg M, file string) (string, error) {
	return a.host.SatisfactoryPlayersAuthority(ctx, server, egg, file)
}
func (a *Service) checkSatisfactoryPlayersAuthority(ctx context.Context, server, egg M, file, before string) error {
	return a.host.CheckSatisfactoryPlayersAuthority(ctx, server, egg, file, before)
}
func (a *Service) persistSatisfactoryPlayers(ctx context.Context, tx pgx.Tx, server, egg M, file string, patch map[string]string) error {
	return a.host.PersistSatisfactoryPlayers(ctx, tx, server, egg, file, patch)
}
func (a *Service) fail(w http.ResponseWriter, err error) { a.host.Fail(w, err) }
