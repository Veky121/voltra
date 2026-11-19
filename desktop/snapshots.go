package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// The page keeps a copy of what the linked account last saw (its server list,
// its sidebar and the Game Library catalog) so it can draw before the panel
// answers. The copy holds no
// credential, but it does name the account's servers, so it lives here with
// the connection instead of in the WebView's own storage: unlinking removes
// it whichever port the app happens to be running on.
//
// The page allows each of its few entries half a million characters; this
// leaves room for all of them after encoding.
const snapshotLimit = 4 << 20

// How long a request for the saved pages waits for the panel's first answer.
const snapshotPatience = 10 * time.Second

func snapshotFile(s session) string {
	sum := sha256.Sum256([]byte("pages\x00" + s.PanelURL + "\x00" + s.DeviceID))
	return "pages-" + hex.EncodeToString(sum[:]) + ".json"
}

// removeSnapshots deletes every saved copy. The app has one connection at a
// time, so whatever is on disk belongs to the connection being ended, or to an
// earlier one whose record could no longer be read.
func removeSnapshots(dir string) error {
	// The directory is taken as it is named, and only the file names are
	// matched: a profile path may itself contain characters a pattern would
	// read as wildcards.
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		// The second pattern is a save that was interrupted before it was renamed.
		saved, _ := filepath.Match("pages-*.json", entry.Name())
		interrupted, _ := filepath.Match(snapshotTemporary, entry.Name())
		if !saved && !interrupted {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// Saved pages are written through their own temporary name, so that removing
// them never touches another preference being saved at the same moment.
const snapshotTemporary = ".pages-*"

// The page decides what the entries mean. The host only requires a JSON
// object whose values are text, which is what the page's store holds.
func validSnapshots(data []byte) bool {
	var entries map[string]string
	return json.Unmarshal(data, &entries) == nil && entries != nil
}

// snapshotID names what a page's copies were read for: the connection, and how
// many times its saved pages have since been thrown away.
func (h *desktopHost) snapshotID(conn connection) string {
	return conn.id + "." + strconv.FormatUint(h.snapshotTurn, 10)
}

// snapshotsRejected marks, on disk, that the saved pages must go although the
// connection stays. It is written before the pages are deleted and removed
// after, so a deletion that fails is finished at the next request or start.
const snapshotsRejected = "pages.rejected"

// rejectSnapshots deletes the saved pages of a connection the panel has just
// refused, and makes every save the page started before that unacceptable, so
// that one already on its way cannot put them back. It is called wherever the
// host itself hears the panel say 401, whether or not a page is there to hear it.
func (h *desktopHost) rejectSnapshots(conn connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.scope == nil || h.scope.id != conn.id {
		return
	}
	h.snapshotTurn++
	h.snapshotCleanup = true
	h.scope.accepted, h.scope.refused = false, true
	// Answers the host fetched for this launch before it heard the refusal
	// were given to a connection the panel no longer accepts. None is replayed.
	h.boot.forget()
	_ = os.WriteFile(filepath.Join(h.dir, snapshotsRejected), nil, 0600)
	h.finishSnapshotCleanupLocked()
}

// finishSnapshotCleanupLocked deletes saved pages that were rejected, if any
// still are. It reports whether none remain; until then they are neither read
// nor replaced. The caller holds h.mu, or is the only one that knows h yet.
func (h *desktopHost) finishSnapshotCleanupLocked() bool {
	if !h.snapshotCleanup {
		return true
	}
	if removeSnapshots(h.dir) != nil {
		return false
	}
	// While the marker cannot be removed the next start would delete whatever
	// was saved meanwhile, so the cleanup is not yet finished.
	if err := os.Remove(filepath.Join(h.dir, snapshotsRejected)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return false
	}
	h.snapshotCleanup = false
	return true
}

// The page reads its copies and writes them back a little later. Each answer
// names what it was read for, and a write is accepted only under that same
// name: a late write from before a relink, or from before the panel rejected
// the session, cannot put the pages back.
//
// Until the panel has accepted the connection in this launch the answer is
// Pending instead: no entries and no name to save under. The file may hold
// pages the page has not been shown, and a save, which replaces all of them,
// must not be possible before they have been handed over. The page asks again
// once it has identified its account.
type snapshotExchange struct {
	Connection string            `json:"connection,omitempty"`
	Pending    bool              `json:"pending,omitempty"`
	Entries    map[string]string `json:"entries"`
}

func (h *desktopHost) serveSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		desktopError(w, 405, "Method not allowed.")
		return
	}
	// The body is read before the lock is taken: every proxied request needs
	// that lock for a moment, and none of them should wait on this upload.
	var input snapshotExchange
	if r.Method == http.MethodPost {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, snapshotLimit))
		if err != nil || json.Unmarshal(body, &input) != nil || input.Entries == nil {
			desktopError(w, 422, "Invalid saved pages.")
			return
		}
	}
	if r.Method == http.MethodGet && !h.isAccepted() {
		// The saved pages are handed over only once the panel has accepted this
		// connection in this launch. The launch's account read is usually back
		// before the page asks; if the panel has not answered yet, the page
		// could not draw anything in any case, so it waits a little for it.
		h.boot.awaitAccount(r.Context(), h.current(), snapshotPatience)
	}
	// Holding the session lock prevents an unlink/relink from saving into another profile.
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.session.Token == "" {
		desktopError(w, 401, "Link your account first.")
		return
	}
	name := snapshotFile(h.session)
	conn := h.connectionLocked()
	if !conn.loadedFor(r) {
		connectionChanged(w)
		return
	}
	// Pages the panel rejected, and that could not be deleted then, are not
	// read while they remain and are not written over.
	clean := h.finishSnapshotCleanupLocked()
	switch r.Method {
	case http.MethodGet:
		// A connection the panel has not yet accepted in this launch may have
		// been rejected since its pages were saved, without this host having
		// been able to record it. Its pages are not read until it is.
		if !h.scope.accepted {
			desktopJSON(w, 200, snapshotExchange{Pending: true, Entries: map[string]string{}})
			return
		}
		answer := snapshotExchange{Connection: h.snapshotID(conn), Entries: map[string]string{}}
		// Missing or unreadable copies only cost the head start.
		if data, err := os.ReadFile(filepath.Join(h.dir, name)); clean && err == nil && len(data) <= snapshotLimit && validSnapshots(data) {
			_ = json.Unmarshal(data, &answer.Entries)
		}
		desktopJSON(w, 200, answer)
	case http.MethodPost:
		if !h.scope.accepted || input.Connection != h.snapshotID(conn) {
			connectionChanged(w)
			return
		}
		data, err := json.Marshal(input.Entries)
		if err != nil {
			desktopError(w, 422, "Invalid saved pages.")
			return
		}
		if !clean {
			desktopError(w, 500, "Could not save pages on this device.")
			return
		}
		if writeAtomically(h.dir, snapshotTemporary, name, data) != nil {
			desktopError(w, 500, "Could not save pages on this device.")
			return
		}
		desktopJSON(w, 200, map[string]bool{"saved": true})
	}
}
