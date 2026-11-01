package panel

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// sharedProgress publishes only file metadata already visible to file readers.
// It never exposes the owner identity, staging paths, resume URLs or credentials.
// Offset is read from the staging file, not inferred from a browser percentage.
func (m *fileTransferManager) sharedProgress(ctx context.Context, server string, node int64) ([]M, error) {
	entries, err := os.ReadDir(m.store.Path)
	if err != nil {
		return nil, err
	}
	result := []M{}
	seen := map[string]bool{}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if entry.IsDir() || (!strings.HasSuffix(entry.Name(), ".info") && !strings.HasSuffix(entry.Name(), ".done")) {
			continue
		}
		id := strings.TrimSuffix(strings.TrimSuffix(entry.Name(), ".info"), ".done")
		if len(id) != 32 || strings.Trim(id, "0123456789abcdef") != "" || seen[id] {
			continue
		}
		seen[id] = true
		info, receipt, err := m.info(ctx, id)
		if err != nil || info.MetaData["server"] != server || info.MetaData["node"] != strconv.FormatInt(node, 10) {
			continue
		}
		stat, err := entry.Info()
		if err != nil {
			continue
		}
		updated := stat.ModTime()
		// HEAD refreshes metadata expiry even when an upload is paused. Use the
		// staged data file's write time to report actual byte activity.
		if receipt == nil {
			dataStat, statErr := os.Stat(filepath.Join(m.store.Path, id))
			if statErr != nil {
				continue
			}
			updated = dataStat.ModTime()
		}
		state := "uploading"
		received := info.Offset
		if !info.SizeIsDeferred && received == info.Size {
			state = "awaiting_save"
		}
		if receipt != nil {
			if time.Since(receipt.CompletedAt) > 15*time.Minute {
				continue
			}
			state = "complete"
			received = info.Size
			updated = receipt.CompletedAt
		}
		progress := float64(0)
		if info.Size > 0 {
			progress = float64(received) / float64(info.Size)
		}
		if state == "complete" {
			progress = 1
		}
		result = append(result, M{"identifier": "upload-" + id, "kind": "upload", "directory": info.MetaData["directory"], "name": info.MetaData["filename"], "state": state, "received_bytes": received, "total_bytes": info.Size, "size_known": !info.SizeIsDeferred, "progress": progress, "updated": updated.UnixMilli()})
	}
	sort.Slice(result, func(i, j int) bool { return num(result[i]["updated"]) > num(result[j]["updated"]) })
	return result, nil
}
