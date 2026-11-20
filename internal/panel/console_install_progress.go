package panel

import (
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Installer output is untrusted. Only literal stage metadata and validated
// numeric measurements can leave the classifier.
type installProgressStage struct {
	ID       string              `json:"id"`
	Label    string              `json:"label"`
	State    string              `json:"state"`
	Progress *installMeasurement `json:"progress,omitempty"`
}

type installMeasurement struct {
	Value     float64 `json:"value"`
	Completed *int64  `json:"completed,omitempty"`
	Total     int64   `json:"total,omitempty"`
	Unit      string  `json:"unit,omitempty"`
}

type installProgressModel struct {
	stages           []installProgressStage
	marked           bool
	outcome, runtime string
}

var installStageLabels = map[string]string{
	"prepare":         "Setting up environment",
	"download":        "Downloading server",
	"loader-download": "Downloading loader",
	"pack-download":   "Downloading modpack",
	"pack-extract":    "Extracting modpack files",
	"verify":          "Verifying files",
	"extract":         "Extracting files",
	"loader":          "Installing loader",
	"content":         "Installing mods and plugins",
	"configure":       "Configuring server",
	"install":         "Installing server",
	"start":           "Starting server",
}

// Keep the rules in step with installProgress.ts. Both reducers run the same
// fixtures in testdata/console-install-progress.json.
var installStageRules = []struct {
	id      string
	pattern *regexp.Regexp
}{
	{"prepare", regexp.MustCompile(`(?i)^(?:reading package lists|building dependency tree|(?:get|hit|ign):\d+\s|fetch https?://\S+/APKINDEX|\(\d+/\d+\) installing|setting up\s|collecting\s|installing collected packages|downloading \S+\.whl\b|last metadata expiration check|dependencies resolved|determining projects to restore|wine: created the configuration directory)|\b(?:apt(?:-get)?|apk|dnf|yum|pip3?|npm|dotnet)\s+(?:install|add|update|restore|ci)\b|\b(?:wineboot|(?:wine|proton)\s+prefix)\b`)},
	{"content", regexp.MustCompile(`(?i)\b(?:workshop_download_item|downloading workshop item)\b|\b(?:installing|downloading|updating|copying|extracting)\s+(?:(?:the|server)\s+)?(?:mods?\b|plug-?ins?\b|mod\s*pack\b|workshop\b)`)},
	{"loader", regexp.MustCompile(`(?i)\b(?:java\s+.*(?:forge|fabric|quilt).*installer.*\.jar|--installServer|(?:installing|running)\s+(?:the\s+)?(?:neo\s?forge|forge|fabric|quilt|bepinex|oxide|txadmin)\b|minecraftforge installer)\b`)},
	{"verify", regexp.MustCompile(`(?i)\b(?:verifying|validating|checking)\s+(?:install|files|update|download|checksum|sha\d+)|\b(?:sha\d+sum|md5sum)\s+(?:-c|--check)\b`)},
	{"extract", regexp.MustCompile(`(?i)^(?:archive:|inflating:|extracting(?:\s|:)|creating:\s+.*/)|\b(?:unzip\s|tar\s+(?:-[a-z]*x|x[a-z]*)|7z\s+[ex]\s)`)},
	{"configure", regexp.MustCompile(`(?i)\b(?:writing|generating|creating|updating|copying)\s+(?:the\s+)?(?:server config(?:uration)?|config(?:uration| files?)?|server\.properties|eula(?:\.txt)?)\b|\beula=true\b`)},
	{"download", regexp.MustCompile(`(?i)^(?:downloading\b|--\d{4}-\d\d-\d\d\s.*https?://|saving to:|% total\s+% received)|\b(?:curl|wget)\s+(?:-\S+\s+)*https?://|https?://github\.com/\S+/releases/download/`)},
}

var (
	installSteamPattern    = regexp.MustCompile(`(?i)^update state \(0x[\da-f]+\)\s+(downloading|verifying|validating|preallocating|reconfiguring|committing)\b(?:[^,]*,\s*progress:\s*(\d+(?:\.\d+)?))?`)
	installDownloadPattern = regexp.MustCompile(`^(?:[#= >]+\s*(\d+(?:\.\d+)?)%|(?:\d+[KMGT]?\s+)?(?:\[[<>=+ .-]+\]|\.{2,}[ .]*)\s*(\d+)%|\d{1,3}\s+\S+\s+(\d{1,3})\s+\S+\s+\d{1,3}\s+\S+\s+\S+\s+\S+\s+(?:--:--:--|\d+:\d+:\d+)|\S+\s+(\d+)%\[[<>=+ .-]+\])`)
	installPackagesPattern = regexp.MustCompile(`(?i)^(?:\S+\s+)?[━╸╺─]+\s+(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)\s*([kMGT]?B)\b`)
	installNpmPattern      = regexp.MustCompile(`(?i)^\[(?:[=.#> -]+)\]\s*(\d+)%\s+\b(?:npm|reify|idealTree|buildDeps)\b`)
	installFailedPattern   = regexp.MustCompile(`(?i)^(?:\w+\s+)?install(?:ation)?\s+(?:has\s+)?failed\b|^installer exited (?:with )?(?:code|status) [1-9]`)
	installCompletePattern = regexp.MustCompile(`(?i)^(?:server )?install(?:ation)? (?:complete[d.]?|finished)(?:[!.]|$)|^success!\s+app '\d+' fully installed\.`)
)

var (
	installConsoleControls = regexp.MustCompile(`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]`)
	installMarkerPattern   = regexp.MustCompile(`^\[voltra:(?:install|stage|progress)\](?:\s|$)`)
	installProgressPattern = regexp.MustCompile(`^\[voltra:progress\] (\d+(?:\.\d+)?)(?: (\d+)/(\d+)( bytes)?)?$`)
)

func newInstallStage(id, state string) installProgressStage {
	return installProgressStage{ID: id, Label: installStageLabels[id], State: state}
}

func (m *installProgressModel) currentStage() *installProgressStage {
	if len(m.stages) == 0 {
		return nil
	}
	return &m.stages[len(m.stages)-1]
}

func (m *installProgressModel) selectStage(id string) {
	if current := m.currentStage(); current != nil && current.ID == id {
		return
	}
	for i := range m.stages {
		if m.stages[i].State == "running" {
			m.stages[i].State = "done"
		}
	}
	m.stages = slices.DeleteFunc(m.stages, func(stage installProgressStage) bool { return stage.ID == id })
	m.stages = append(m.stages, newInstallStage(id, "running"))
}

func installPercentage(raw string) *installMeasurement {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || !(value >= 0 && value <= 100) {
		return nil
	}
	return &installMeasurement{Value: value}
}

func installMarkerProgress(line string) *installMeasurement {
	match := installProgressPattern.FindStringSubmatch(line)
	if match == nil {
		return nil
	}
	progress := installPercentage(match[1])
	if progress == nil || match[2] == "" {
		return progress
	}
	completed, errDone := strconv.ParseInt(match[2], 10, 64)
	total, errTotal := strconv.ParseInt(match[3], 10, 64)
	if errDone != nil || errTotal != nil || total <= 0 || completed > total || total > 1<<53-1 {
		return nil
	}
	progress.Completed, progress.Total = &completed, total
	if match[4] != "" {
		progress.Unit = "bytes"
	}
	return progress
}

func installToolProgress(line string) (string, *installMeasurement) {
	if match := installSteamPattern.FindStringSubmatch(line); match != nil {
		id := "prepare"
		switch strings.ToLower(match[1]) {
		case "downloading":
			id = "download"
		case "verifying", "validating":
			id = "verify"
		}
		return id, installPercentage(match[2])
	}
	if match := installNpmPattern.FindStringSubmatch(line); match != nil {
		if progress := installPercentage(match[1]); progress != nil {
			return "prepare", progress
		}
	}
	if match := installDownloadPattern.FindStringSubmatch(line); match != nil {
		return "download", installPercentage(strings.Join(match[1:], ""))
	}
	if match := installPackagesPattern.FindStringSubmatch(line); match != nil {
		done, _ := strconv.ParseFloat(match[1], 64)
		total, _ := strconv.ParseFloat(match[2], 64)
		value := done / total * 100
		if value >= 0 && value <= 100 {
			return "prepare", &installMeasurement{Value: value}
		}
		return "prepare", nil
	}
	return "", nil
}

func (m *installProgressModel) readOutput(line string) {
	if line == "[voltra:install] begin" {
		*m = installProgressModel{marked: true}
		return
	}
	if m.runtime == "running" {
		*m = installProgressModel{}
	}
	if installMarkerPattern.MatchString(line) {
		switch {
		case line == "[voltra:install] complete":
			m.outcome = "complete"
		case line == "[voltra:install] failed":
			m.outcome = "failed"
		case strings.HasPrefix(line, "[voltra:stage] "):
			id := strings.TrimPrefix(line, "[voltra:stage] ")
			if installStageLabels[id] != "" && id != "start" && id != "install" {
				m.marked = true
				m.selectStage(id)
			}
		case m.marked && len(line) <= 64:
			if progress, current := installMarkerProgress(line), m.currentStage(); progress != nil && current != nil {
				current.Progress = progress
			}
		}
		return
	}
	if installFailedPattern.MatchString(line) {
		m.outcome = "failed"
		return
	}
	if !m.marked && installCompletePattern.MatchString(line) {
		if strings.HasPrefix(strings.ToLower(line), "success!") {
			if m.currentStage() == nil {
				m.selectStage("download")
			}
			m.currentStage().Progress = &installMeasurement{Value: 100}
		} else {
			m.outcome = "complete"
		}
		return
	}
	if m.marked {
		return
	}
	id, progress := installToolProgress(line)
	if id == "" {
		for _, rule := range installStageRules {
			if rule.pattern.MatchString(line) {
				id = rule.id
				break
			}
		}
	}
	current := m.currentStage()
	if id != "" && !(id == "download" && current != nil && (current.ID == "loader" || current.ID == "content")) {
		m.selectStage(id)
	}
	if current = m.currentStage(); current != nil && progress != nil {
		current.Progress = progress
	}
}

func (m *installProgressModel) readHistory(event, line string) {
	line = installConsoleControls.ReplaceAllString(line, "")
	switch event {
	case "install output":
		for _, frame := range strings.FieldsFunc(line, func(r rune) bool { return r == '\r' || r == '\n' }) {
			if text := strings.TrimSpace(frame); text != "" {
				m.readOutput(text)
			}
		}
	case "panel message":
		if line == consoleInstallBoundary {
			*m = installProgressModel{}
		}
		if m.runtime == "running" {
			return
		}
		switch {
		case strings.HasSuffix(line, "[Voltra]: Server entered the running state."),
			strings.HasSuffix(line, "[Voltra]: Current server state: running."):
			m.runtime = "running"
		case strings.HasSuffix(line, "[Voltra]: Server is starting. Preparing the container and launching the process."),
			strings.HasSuffix(line, "[Voltra]: Current server state: starting."):
			m.runtime = "starting"
		case strings.HasSuffix(line, "[Voltra]: Server went offline during startup. Check the output above."):
			m.runtime = "failed"
		}
	}
}

func (m installProgressModel) view(phase, runtime string) []installProgressStage {
	failed := phase == "failed"
	complete := phase == "installed"
	stages := append([]installProgressStage(nil), m.stages...)
	if len(stages) == 0 {
		stages = []installProgressStage{newInstallStage("install", "running")}
	}
	if failed {
		stages[len(stages)-1].State = "failed"
		return stages
	}
	start := newInstallStage("start", "waiting")
	if complete {
		stages[len(stages)-1].State = "done"
		switch {
		case runtime == "starting":
			start.State = "running"
		case m.runtime == "failed":
			start.State = "failed"
		default:
			start.Label = "Ready to start"
		}
	}
	return append(stages, start)
}

func (a *App) clientInstallProgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	server, err := a.server(r, "websocket.connect")
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	scope, status, err := readConsoleInstallScope(ctx, tx, server["id"])
	if err != nil {
		fail(w, err)
		return
	}
	rows, err := tx.Query(ctx, `SELECT event,line FROM console_log_entries
 WHERE server_id=$1 AND id>$2 AND id<$3 AND event IN ('install output','panel message')
 AND (NOT $4 OR event<>'panel message' OR line<>$5) ORDER BY id`,
		server["id"], scope.start, scope.end, scope.marked, consoleInstallBoundary)
	if err != nil {
		fail(w, err)
		return
	}
	var model installProgressModel
	var event, line string
	_, err = pgx.ForEachRow(rows, []any{&event, &line}, func() error {
		model.readHistory(event, line)
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	phase := "installed"
	switch status {
	case "installing":
		phase = "installing"
	case "install_failed", "reinstall_failed":
		phase = "failed"
	}
	stages := []installProgressStage{}
	if phase != "installed" || model.runtime != "running" && (len(model.stages) > 0 || model.marked || model.outcome != "") {
		stages = model.view(phase, model.runtime)
	}
	writeJSON(w, http.StatusOK, M{"stages": stages})
}
