package panel

import (
	"encoding/json"
	"net/http"
)

func (a *App) clientRemoteTransfers(w http.ResponseWriter, r *http.Request) {
	s, err := a.transferViewServer(r)
	if err != nil {
		fail(w, err)
		return
	}
	res, err := a.daemonServer(r.Context(), s, http.MethodGet, "/files/pull", nil)
	if err != nil {
		fail(w, err)
		return
	}
	defer res.Body.Close()
	var result M
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

// Transfer progress is shared with file viewers; starting or mutating a
// transfer still requires the existing write permissions and ownership.
func (a *App) transferViewServer(r *http.Request) (M, error) {
	s, err := a.server(r, "")
	if err != nil {
		return nil, err
	}
	u, err := a.user(r)
	if err != nil {
		return nil, err
	}
	if !a.can(r.Context(), u, s, "file.read") && !a.can(r.Context(), u, s, "file.create") {
		return nil, forbidden()
	}
	return s, nil
}
