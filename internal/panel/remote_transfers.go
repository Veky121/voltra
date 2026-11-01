package panel

import (
	"encoding/json"
	"net/http"
)

func (a *App) clientRemoteTransfers(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "file.create")
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
