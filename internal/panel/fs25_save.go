package panel

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

var fs25SaveLocks sync.Map

func (a *App) fs25SaveEnabled(ctx context.Context, s M) (bool, error) {
	row, err := a.one(ctx, `SELECT EXISTS(SELECT 1 FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id JOIN eggs e ON e.id=ev.egg_id WHERE sv.server_id=$1 AND ev.env_variable='VOLTRA_FS25_SAVE' AND sv.variable_value='true' AND e.features @> '["voltra_fs25"]'::jsonb) AS enabled`, num(s["id"]))
	return boolean(row["enabled"]), err
}

func (a *App) clientFS25Save(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "control.console")
	if err != nil {
		fail(w, err)
		return
	}
	enabled, err := a.fs25SaveEnabled(r.Context(), s)
	if err != nil {
		fail(w, err)
		return
	}
	if !enabled {
		fail(w, bad("Enable the experimental FS25 server save bridge in Runtime and prepare/start it first."))
		return
	}
	if err = a.fs25Save(r.Context(), s); err != nil {
		fail(w, err)
		return
	}
	a.opAudit(r, s, "server:fs25.save", M{})
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) fs25SaveRead(ctx context.Context, s M, name string, out any) error {
	response, err := a.daemonServer(ctx, s, "GET", "/files/contents?"+url.Values{"file": {"/data/modSettings/VoltraSave/" + name}}.Encode(), nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	return json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(out)
}

func (a *App) fs25Save(ctx context.Context, s M, stop ...bool) error {
	lock, _ := fs25SaveLocks.LoadOrStore(str(s["uuid"]), &sync.Mutex{})
	mu := lock.(*sync.Mutex)
	if !mu.TryLock() {
		return bad("An FS25 save is already running. Wait for it to finish.")
	}
	defer mu.Unlock()
	action := "save"
	if len(stop) > 0 && stop[0] {
		action = "save-and-stop"
	}
	return fs25RunSave(ctx, func(ctx context.Context, name string, out any) error { return a.fs25SaveRead(ctx, s, name, out) }, func(ctx context.Context, body []byte) error {
		return a.quickSetupWrite(ctx, s, "/data/modSettings/VoltraSave/control.json", body)
	}, action)
}

func fs25RunSave(ctx context.Context, read func(context.Context, string, any) error, write func(context.Context, []byte) error, actions ...string) error {
	action := "save"
	if len(actions) > 0 {
		action = actions[0]
	}
	ctx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()
	var state struct {
		Protocol int    `json:"protocol"`
		Session  string `json:"session"`
		Updated  int64  `json:"updated_at"`
		Busy     bool   `json:"busy"`
	}
	if err := read(ctx, "state.json", &state); err != nil {
		return bad("FS25 save bridge is unavailable; no stop was sent.")
	}
	age := time.Now().UnixMilli() - state.Updated
	if state.Protocol != 1 || state.Session == "" || age > 10000 || age < -10000 || state.Busy {
		return bad("FS25 save bridge is stale or busy; no stop was sent.")
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return err
	}
	id := hex.EncodeToString(token)
	body, _ := json.Marshal(M{"id": id, "session": state.Session, "action": action, "expires_at": time.Now().Add(95 * time.Second).UnixMilli()})
	if err := write(ctx, body); err != nil {
		return err
	}
	timer := time.NewTicker(250 * time.Millisecond)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return bad("FS25 save was not confirmed; no stop was sent. Check the game log before retrying.")
		case <-timer.C:
			var result struct {
				ID      string `json:"id"`
				Session string `json:"session"`
				Success bool   `json:"success"`
				Stopped bool   `json:"stopped"`
			}
			if read(ctx, "result.json", &result) != nil || result.ID != id || result.Session != state.Session {
				continue
			}
			if !result.Success || (action == "save-and-stop" && !result.Stopped) {
				return bad("FS25 save failed. No stop was sent. Check the game log.")
			}
			return nil
		}
	}
}
