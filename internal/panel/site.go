package panel

import "net/http"

// clientSiteSettings exposes only the settings supplied to the native client
// shell. Operational settings and credentials stay in the admin API.
func (a *App) clientSiteSettings(w http.ResponseWriter, r *http.Request) {
	if _, err := a.user(r); err != nil {
		fail(w, err)
		return
	}
	settings, err := a.infraLoadSettings(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("site_settings", M{"name": settings["app:name"], "locale": settings["app:locale"], "timezone": settings["app:timezone"]}))
}
