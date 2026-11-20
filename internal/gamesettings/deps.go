package gamesettings

import (
	"errors"
	"net/http"

	"voltra/internal/apiutil"
)

// Profile is the part of a panel game template that settings rules read.
type Profile struct {
	Path              string
	Egg               M
	SettingsDocuments DocumentPaths
	// EggUUID is the stable UUID panel gives the template's egg.
	EggUUID string
}

// Deps are process-wide facts owned by other parts of panel: the embedded
// template catalog, Steam and Java game identities, egg parsing and quick
// setup validation. panel calls Configure from an init function, before any
// request; until then the catalog is empty and identities are unknown.
type Deps struct {
	Profiles        func() []Profile
	SteamGameID     func(egg M) string
	PalworldVariant func(game string) bool
	JavaMinecraft   func(egg M) bool
	ParseEgg        func(document M) (M, []M, error)
	QuickConfigPath func(game string) string
	QuickValidate   func(game string, settings M) (map[string]string, error)
}

var deps Deps

func Configure(d Deps) { deps = d }

var errUnconfigured = errors.New("gamesettings: Configure has not been called")

func profiles() []Profile {
	if deps.Profiles == nil {
		return nil
	}
	return deps.Profiles()
}
func steamGameID(egg M) string {
	if deps.SteamGameID == nil {
		return ""
	}
	return deps.SteamGameID(egg)
}
func steamPalworldVariant(game string) bool {
	return deps.PalworldVariant != nil && deps.PalworldVariant(game)
}
func javaMinecraftEgg(egg M) bool { return deps.JavaMinecraft != nil && deps.JavaMinecraft(egg) }
func parseEggDocument(d M) (M, []M, error) {
	if deps.ParseEgg == nil {
		return nil, nil, errUnconfigured
	}
	return deps.ParseEgg(d)
}
func quickConfigPath(game string) string {
	if deps.QuickConfigPath == nil {
		return ""
	}
	return deps.QuickConfigPath(game)
}
func quickValidateSettings(game string, settings M) (map[string]string, error) {
	if deps.QuickValidate == nil {
		return nil, errUnconfigured
	}
	return deps.QuickValidate(game, settings)
}

// Shared API primitives, under the names the moved code already used.
type M = apiutil.M
type APIError = apiutil.APIError

func bad(detail string) error                                { return apiutil.Bad(detail) }
func forbidden() error                                       { return apiutil.Forbidden() }
func notFound() error                                        { return apiutil.NotFound() }
func writeJSON(w http.ResponseWriter, status int, value any) { apiutil.WriteJSON(w, status, value) }
func item(object string, attributes M) M                     { return apiutil.Item(object, attributes) }
func decodeRaw(r *http.Request) (M, error)                   { return apiutil.DecodeRaw(r) }
func num(v any) int64                                        { return apiutil.Num(v) }
func str(v any) string                                       { return apiutil.Str(v) }
func boolean(v any) bool                                     { return apiutil.Boolean(v) }
func asMap(v any) M                                          { return apiutil.AsMap(v) }
func asSlice(v any) []any                                    { return apiutil.AsSlice(v) }
