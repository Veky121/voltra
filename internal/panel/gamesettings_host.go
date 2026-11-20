package panel

import (
	"context"
	"net/http"
	"sync"

	"github.com/jackc/pgx/v5"

	"voltra/internal/gamesettings"
)

// Game settings live in package gamesettings. Panel serves its routes,
// supplies the per-request services through gameSettingsHost and the
// catalog facts it owns through Deps.

func init() {
	gamesettings.Configure(gamesettings.Deps{
		Profiles:        gameSettingsProfiles,
		SteamGameID:     steamGameID,
		PalworldVariant: steamPalworldVariant,
		JavaMinecraft:   javaMinecraftEgg,
		ParseEgg:        parseEggDocument,
		QuickConfigPath: quickConfigPath,
		QuickValidate:   quickValidateSettings,
	})
}

func (a *App) gameSettingsService() *gamesettings.Service {
	return gamesettings.NewService(gameSettingsHost{a})
}

func (a *App) gameSettings(w http.ResponseWriter, r *http.Request) {
	a.gameSettingsService().Settings(w, r)
}

func (a *App) gameSettingsFolders(w http.ResponseWriter, r *http.Request) {
	a.gameSettingsService().Folders(w, r)
}

// The template catalog is immutable in production. Tests append to or replace
// templates.Entries, so the converted list is rebuilt whenever the slice
// changes.
var gameSettingsProfileCache struct {
	sync.Mutex
	first    *gameTemplate
	count    int
	profiles []gamesettings.Profile
}

func gameSettingsProfiles() []gamesettings.Profile {
	entries := gameTemplates().Entries
	var first *gameTemplate
	if len(entries) > 0 {
		first = &entries[0]
	}
	c := &gameSettingsProfileCache
	c.Lock()
	defer c.Unlock()
	if c.profiles == nil || c.first != first || c.count != len(entries) {
		c.profiles, c.first, c.count = gameSettingsProfilesOf(entries), first, len(entries)
	}
	return c.profiles
}

func gameSettingsProfilesOf(entries []gameTemplate) []gamesettings.Profile {
	profiles := make([]gamesettings.Profile, len(entries))
	for i, entry := range entries {
		profiles[i] = gameSettingsProfileOf(entry)
	}
	return profiles
}

func gameSettingsProfileOf(entry gameTemplate) gamesettings.Profile {
	return gamesettings.Profile{Path: entry.Path, Egg: entry.Egg, SettingsDocuments: entry.SettingsDocuments, EggUUID: gameTemplateEggUUID(entry)}
}

type gameSettingsHost struct{ a *App }

func (h gameSettingsHost) QuickSetupRead(ctx context.Context, s M, file string) ([]byte, bool, error) {
	return h.a.quickSetupRead(ctx, s, file)
}
func (h gameSettingsHost) QuickSetupWrite(ctx context.Context, s M, file string, data []byte) error {
	return h.a.quickSetupWrite(ctx, s, file, data)
}
func (h gameSettingsHost) QuickSetupStopped(ctx context.Context, s M) error {
	return h.a.quickSetupStopped(ctx, s)
}
func (h gameSettingsHost) QuickSetupList(ctx context.Context, s M, folder string) ([]M, bool, error) {
	return h.a.quickSetupList(ctx, s, folder)
}
func (h gameSettingsHost) QuickSetupListExisting(ctx context.Context, s M, folder string) ([]M, error) {
	return h.a.quickSetupListExisting(ctx, s, folder)
}
func (h gameSettingsHost) QuickSetupFolderExists(ctx context.Context, s M, folder string) (bool, error) {
	return h.a.quickSetupFolderExists(ctx, s, folder)
}
func (h gameSettingsHost) QuickSetupFolders(ctx context.Context, s M, game string, values map[string]string) ([]M, error) {
	return h.a.quickSetupFolders(ctx, s, game, values)
}
func (h gameSettingsHost) Server(r *http.Request, permission string) (M, error) {
	return h.a.server(r, permission)
}
func (h gameSettingsHost) User(r *http.Request) (M, error) { return h.a.user(r) }
func (h gameSettingsHost) Can(ctx context.Context, user, server M, permission string) bool {
	return h.a.can(ctx, user, server, permission)
}
func (h gameSettingsHost) ServerConfig(ctx context.Context, server M) (M, error) {
	return h.a.serverConfig(ctx, server)
}
func (h gameSettingsHost) ServerEffectiveEgg(ctx context.Context, server M) (M, error) {
	return h.a.serverEffectiveEgg(ctx, server)
}
func (h gameSettingsHost) Query(ctx context.Context, sql string, args ...any) ([]M, error) {
	return h.a.query(ctx, sql, args...)
}
func (h gameSettingsHost) Begin(ctx context.Context) (pgx.Tx, error) { return h.a.DB.Begin(ctx) }
func (h gameSettingsHost) Audit(ctx context.Context, userID, serverID int64, event string, properties M) error {
	return h.a.audit(ctx, userID, serverID, event, properties)
}
func (h gameSettingsHost) SatisfactoryPlayersAuthority(ctx context.Context, server, egg M, file string) (string, error) {
	return h.a.satisfactoryPlayersAuthority(ctx, server, egg, file)
}
func (h gameSettingsHost) CheckSatisfactoryPlayersAuthority(ctx context.Context, server, egg M, file, before string) error {
	return h.a.checkSatisfactoryPlayersAuthority(ctx, server, egg, file, before)
}
func (h gameSettingsHost) PersistSatisfactoryPlayers(ctx context.Context, tx pgx.Tx, server, egg M, file string, patch map[string]string) error {
	return h.a.persistSatisfactoryPlayers(ctx, tx, server, egg, file, patch)
}
func (h gameSettingsHost) Fail(w http.ResponseWriter, err error) { fail(w, err) }
