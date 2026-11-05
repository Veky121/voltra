package panel

import (
	"context"
	"encoding/json"
	"io"
	"time"
)

// Health is informational and never changes container power or readiness.
func (a *App) attachFS25Health(ctx context.Context, server, snapshot M) {
	egg, err := a.one(ctx, "SELECT features FROM eggs WHERE id=$1", num(server["egg_id"]))
	if err != nil || !fs25Egg(egg) {
		return
	}
	state := str(snapshot["state"])
	services := M{"portal": "unknown", "game": "unknown"}
	snapshot["fs25_services"] = services
	if state == "offline" || state == "stopped" {
		services["portal"], services["game"] = "offline", "offline"
		return
	}
	if state != "running" && state != "starting" && state != "stopping" {
		return
	}
	readCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	response, err := a.daemonServer(readCtx, server, "GET", "/files/contents?file=%2F.voltra%2Ffs25%2Fhealth.json", nil)
	if err != nil {
		return
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(data) > 4096 {
		return
	}
	snapshot["fs25_services"] = fs25HealthSnapshot(data, state, num(asMap(snapshot["utilization"])["uptime"]), time.Now())
}

func fs25HealthSnapshot(data []byte, state string, uptime int64, now time.Time) M {
	result := M{"portal": "unknown", "game": "unknown"}
	var report struct {
		Portal  string `json:"portal"`
		Game    string `json:"game"`
		Checked int64  `json:"checked_at"`
		Started int64  `json:"started_at"`
	}
	if json.Unmarshal(data, &report) != nil {
		return result
	}
	age := now.UnixMilli() - report.Checked
	// Reject a previous container session even if its report is still fresh.
	boot := now.UnixMilli() - uptime
	if age < 0 || age > 20000 || uptime <= 0 || report.Started < boot-10000 || report.Started > now.UnixMilli() || report.Checked < report.Started || report.Checked < boot {
		return result
	}
	for key, value := range map[string]string{"portal": report.Portal, "game": report.Game} {
		if value == "online" || value == "offline" || value == "unknown" {
			result[key] = value
		}
	}
	if result["portal"] != "online" {
		result["game"] = "unknown"
	}
	if state == "starting" && result["game"] == "online" {
		result["game"] = "starting"
	}
	if state == "stopping" && result["game"] == "online" {
		result["game"] = "stopping"
	}
	return result
}
