package nodeagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const DefaultConfigPath = "/etc/voltra/node.json"
const DefaultWingsConfigPath = "/etc/voltra/wings.yml"

// SetupOptions permits isolated setup verification without importing Panel.
// Empty paths select production paths. StartServices requires Linux/systemd.
type SetupOptions struct {
	In                                      io.Reader
	Out                                     io.Writer
	ReadConnection                          func() (string, error)
	ConfigPath, WingsConfigPath, SystemdDir string
	PollInterval                            time.Duration
	StartServices                           bool
	SteamJournalPath                        string // Test seam; empty selects /var/lib/voltra/steam-jobs.
	Reconnect                               bool
}

// SavedConfig retains a bootstrap token only until complete is acknowledged.
// This makes interrupted persistence/ACK sequences recoverable with setup or run.
type SavedConfig struct {
	Config
	EnrollmentID       string `json:"enrollment_id,omitempty"`
	RequestToken       string `json:"request_token,omitempty"`
	EnrollmentPanelURL string `json:"enrollment_panel_url,omitempty"`
	PendingWings       []byte `json:"pending_wings_configuration,omitempty"`
	WingsConfigPath    string `json:"wings_config_path,omitempty"`
	PreviousWings      []byte `json:"previous_wings_configuration,omitempty"`
	Recovery           bool   `json:"recovery,omitempty"`
	NodeUUID           string `json:"node_uuid,omitempty"`
	RestartWings       bool   `json:"restart_wings,omitempty"`
}

type enrollment struct {
	ID               string    `json:"id"`
	RequestToken     string    `json:"request_token"`
	VerificationCode string    `json:"verification_code"`
	ExpiresAt        time.Time `json:"expires_at"`
	Recovery         bool      `json:"recovery"`
}

type approval struct {
	Status         string         `json:"status"`
	ConnectorToken string         `json:"connector_token"`
	PanelURL       string         `json:"panel_url"`
	Configuration  map[string]any `json:"configuration"`
	Recovery       bool           `json:"recovery"`
}

// ParseConnectionString keeps the pairing token out of URLs sent over HTTP.
func ParseConnectionString(raw string) (*url.URL, string, error) {
	panel, token, ok := strings.Cut(strings.TrimSpace(raw), "#")
	if !ok || token == "" || len(token) > 4096 || strings.ContainsAny(token, "#\r\n\t ") {
		return nil, "", errors.New("connection string must be PANEL_URL#PAIRING_TOKEN")
	}
	u, err := ValidatePanelURL(panel)
	if err != nil {
		return nil, "", err
	}
	return u, token, nil
}

func request(ctx context.Context, method, target, bearer string, body any, result any) error {
	var data io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return errors.New("invalid enrollment request")
		}
		data = bytes.NewReader(b)
	}
	r, err := http.NewRequestWithContext(ctx, method, target, data)
	if err != nil {
		return errors.New("invalid enrollment endpoint")
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(r)
	if err != nil {
		return errors.New("Panel enrollment request failed; check connectivity and TLS certificate")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		hint := "check the Panel address and reverse proxy"
		switch resp.StatusCode {
		case 401, 403:
			hint = "credential expired or revoked; request a new connection string in the Panel"
		case 404:
			hint = "check the Panel base URL and that node enrollment is enabled"
		case 409:
			hint = "request conflicts with the Panel state; review the node request in the Panel"
		case 429:
			hint = "Panel rate limit reached; wait before retrying"
		case 502, 503, 504:
			hint = "Panel is unavailable; check its service and reverse proxy, then retry"
		}
		return fmt.Errorf("Panel request returned HTTP %d; %s", resp.StatusCode, hint)
	}
	if result == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(result); err != nil {
		return errors.New("Panel returned invalid enrollment JSON")
	}
	return nil
}

// Setup requests approval, prints a human verification code, saves private files
// before acknowledging credential delivery, then installs/starts systemd units.
// Existing Wings configuration is never replaced by a new pairing.
func Setup(ctx context.Context, o SetupOptions) error {
	if o.In == nil {
		o.In = os.Stdin
	}
	if o.Out == nil {
		o.Out = os.Stdout
	}
	if o.ConfigPath == "" {
		o.ConfigPath = DefaultConfigPath
	}
	if o.WingsConfigPath == "" {
		o.WingsConfigPath = DefaultWingsConfigPath
	}
	if o.SystemdDir == "" {
		o.SystemdDir = "/etc/systemd/system"
	}
	if o.PollInterval <= 0 {
		o.PollInterval = 2 * time.Second
	}
	var previousWings []byte
	var savedUUID string
	if _, err := os.Lstat(o.ConfigPath); err == nil {
		saved, err := LoadConfig(o.ConfigPath)
		if err != nil {
			return err
		}
		savedUUID = saved.NodeUUID
		if saved.WingsConfigPath != "" {
			o.WingsConfigPath = saved.WingsConfigPath
		}
		if saved.RequestToken != "" || saved.RestartWings || !o.Reconnect {
			fmt.Fprintln(o.Out, "[Recovery] Existing private configuration found; completing setup.")
			if err := persistWings(o.WingsConfigPath, saved); err != nil {
				return err
			}
			if err := complete(ctx, o.ConfigPath, &saved); err != nil {
				return err
			}
			return finishSavedSetup(ctx, o, saved)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if o.Reconnect {
		var err error
		previousWings, err = readPrivateWings(o.WingsConfigPath)
		if err != nil {
			return fmt.Errorf("reconnect requires the existing private Wings configuration: %w", err)
		}
		if _, err := reconnectWings(previousWings, nil, ""); err != nil {
			return err
		}
		if savedUUID != "" {
			var existing map[string]any
			_ = yaml.Unmarshal(previousWings, &existing)
			if stringValue(existing["uuid"]) != savedUUID {
				return errors.New("saved node UUID does not match Wings configuration; restore the matching private files before reconnecting")
			}
		}
	} else if _, err := os.Lstat(o.WingsConfigPath); err == nil {
		return errors.New("Wings configuration already exists; move it aside deliberately before pairing")
	} else if !os.IsNotExist(err) {
		return err
	}
	fmt.Fprintln(o.Out, "[Pairing] Paste the Panel connection string at the hidden prompt:")
	var line string
	var err error
	if o.ReadConnection != nil {
		line, err = o.ReadConnection()
	} else {
		line, err = bufio.NewReader(io.LimitReader(o.In, 8193)).ReadString('\n')
		if err == io.EOF && line != "" {
			err = nil
		}
	}
	if err != nil {
		return errors.New("could not read private connection string; run sudo voltra-node setup from an interactive terminal with /dev/tty")
	}
	base, token, err := ParseConnectionString(line)
	if err != nil {
		return err
	}
	host, err := os.Hostname()
	if err != nil {
		return errors.New("could not read hostname")
	}
	memory, disk := hostResources()
	var e enrollment
	if err := request(ctx, http.MethodPost, endpoint(base, "/api/remote/enroll", false), "", map[string]any{"token": token, "hostname": host, "platform": runtime.GOOS, "architecture": runtime.GOARCH, "memory_mib": memory, "disk_mib": disk}, &e); err != nil {
		return err
	}
	if e.Recovery != o.Reconnect {
		return errors.New("enrollment mode mismatch; reconnect requires a recovery connection string, and recovery requires setup --reconnect")
	}
	if !streamID.MatchString(e.ID) || e.RequestToken == "" || strings.ContainsAny(e.RequestToken, "\r\n") || e.VerificationCode == "" || len(e.VerificationCode) > 80 || strings.ContainsAny(e.VerificationCode, "\r\n\x1b") || e.ExpiresAt.IsZero() {
		return errors.New("Panel returned invalid enrollment credentials")
	}
	fmt.Fprintf(o.Out, "Verification code: %s\nApprove this code and hostname in the Panel. Waiting for approval...\n", e.VerificationCode)
	for {
		if time.Now().After(e.ExpiresAt) {
			return errors.New("enrollment expired; request a new connection string")
		}
		var a approval
		if err := request(ctx, http.MethodGet, endpoint(base, "/api/remote/enroll/"+e.ID, false), e.RequestToken, nil, &a); err != nil {
			return err
		}
		switch a.Status {
		case "pending":
			t := time.NewTimer(min(o.PollInterval, time.Until(e.ExpiresAt)))
			select {
			case <-ctx.Done():
				t.Stop()
				return ctx.Err()
			case <-t.C:
			}
		case "rejected", "expired":
			return fmt.Errorf("node enrollment %s", a.Status)
		case "approved":
			if a.Recovery != o.Reconnect {
				return errors.New("approved enrollment recovery mode mismatch; no configuration was changed")
			}
			panelURL := base.String()
			if a.PanelURL != "" {
				panelURL = a.PanelURL
			}
			config := Config{PanelURL: panelURL, Token: a.ConnectorToken, WingsAddress: "127.0.0.1:8080"}
			if _, err := validateConfig(config); err != nil {
				return err
			}
			var wings []byte
			if o.Reconnect {
				wings, err = reconnectWings(previousWings, a.Configuration, panelURL)
			} else {
				wings, err = wingsConfig(a.Configuration, panelURL)
			}
			if err != nil {
				return err
			}
			// A crash between the two files can be recovered without touching stock
			// Wings data: node.json is written first, and retains the bootstrap token.
			saved := SavedConfig{
				Config: config, EnrollmentID: e.ID, RequestToken: e.RequestToken,
				EnrollmentPanelURL: base.String(), PendingWings: wings, WingsConfigPath: o.WingsConfigPath,
				PreviousWings: previousWings, Recovery: o.Reconnect, NodeUUID: stringValue(a.Configuration["uuid"]),
				RestartWings: o.Reconnect && o.StartServices,
			}
			fmt.Fprintln(o.Out, "[Persistence] Approval received; saving private configuration before acknowledgment.")
			if err := saveConfig(o.ConfigPath, saved, o.Reconnect); err != nil {
				return err
			}
			if err := persistWings(o.WingsConfigPath, saved); err != nil {
				return fmt.Errorf("could not save Wings config; bootstrap credentials retained for recovery: %w", err)
			}
			if err := complete(ctx, o.ConfigPath, &saved); err != nil {
				return err
			}
			fmt.Fprintln(o.Out, "Approved. Private node and Wings configuration saved.")
			return finishSavedSetup(ctx, o, saved)
		default:
			return errors.New("Panel returned unknown enrollment status")
		}
	}
}

func wingsConfig(config map[string]any, panelURL string) ([]byte, error) {
	if stringValue(config["token"]) == "" || stringValue(config["token_id"]) == "" || stringValue(config["uuid"]) == "" {
		return nil, errors.New("approval is missing stock Wings configuration")
	}
	api, _ := config["api"].(map[string]any)
	if api == nil {
		api = make(map[string]any)
	}
	api["host"] = "127.0.0.1"
	api["port"] = 8080
	api["ssl"] = map[string]any{"enabled": false, "cert": "", "key": ""}
	config["api"] = api
	system, _ := config["system"].(map[string]any)
	if system == nil {
		system = make(map[string]any)
	}
	system["root_directory"] = "/var/lib/voltra"
	system["data"] = "/var/lib/voltra/volumes"
	sftp, _ := system["sftp"].(map[string]any)
	if sftp == nil {
		sftp = make(map[string]any)
	}
	sftp["bind_address"] = "127.0.0.1"
	system["sftp"] = sftp
	config["system"] = system
	config["remote"] = panelURL
	return yaml.Marshal(config)
}

func stringValue(value any) string {
	s, _ := value.(string)
	return s
}

func readPrivateWings(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("Wings configuration must be a private regular file (0600)")
	}
	return os.ReadFile(path)
}

// Decode and update the YAML tree, retaining unknown settings and operator data,
// Docker, SFTP and network configuration. Only approved credentials, remote and
// the private management listener change. A different node must never be adopted.
func reconnectWings(previous []byte, approved map[string]any, panelURL string) ([]byte, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(previous, &doc); err != nil || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, errors.New("existing Wings YAML is invalid; restore it before reconnecting")
	}
	root := doc.Content[0]
	field := func(key string) *yaml.Node {
		for i := 0; i < len(root.Content); i += 2 {
			if root.Content[i].Value == key {
				return root.Content[i+1]
			}
		}
		return nil
	}
	uuid := field("uuid")
	if uuid == nil || uuid.Kind != yaml.ScalarNode || uuid.Value == "" {
		return nil, errors.New("existing Wings configuration has no node UUID; restore it before reconnecting")
	}
	if approved == nil {
		return nil, nil
	}
	if uuid.Value != stringValue(approved["uuid"]) {
		return nil, errors.New("recovery node UUID mismatch; create a reconnect request for this node in the Panel; no configuration was changed")
	}
	if stringValue(approved["token"]) == "" || stringValue(approved["token_id"]) == "" {
		return nil, errors.New("recovery approval is missing Wings authentication")
	}
	setYAMLField(root, "token", approved["token"])
	setYAMLField(root, "token_id", approved["token_id"])
	setYAMLField(root, "remote", panelURL)
	api := field("api")
	if api == nil {
		setYAMLField(root, "api", map[string]any{})
		api = field("api")
	}
	if api.Kind != yaml.MappingNode {
		return nil, errors.New("existing Wings api configuration must be a mapping")
	}
	setYAMLField(api, "host", "127.0.0.1")
	setYAMLField(api, "port", 8080)
	setYAMLField(api, "ssl", map[string]any{"enabled": false, "cert": "", "key": ""})
	return yaml.Marshal(&doc)
}

func setYAMLField(node *yaml.Node, key string, value any) {
	var replacement yaml.Node
	_ = replacement.Encode(value)
	for i := 0; i < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			node.Content[i+1] = &replacement
			return
		}
	}
	node.Content = append(node.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, &replacement)
}

func persistWings(path string, c SavedConfig) error {
	if !c.Recovery || len(c.PendingWings) == 0 {
		return ensureWings(path, c.PendingWings)
	}
	current, err := readPrivateWings(path)
	if err != nil {
		return fmt.Errorf("cannot restore recovery Wings configuration; restore the original private file: %w", err)
	}
	if bytes.Equal(current, c.PendingWings) {
		return nil
	}
	if len(c.PreviousWings) == 0 || !bytes.Equal(current, c.PreviousWings) {
		return errors.New("Wings configuration changed since recovery approval; refusing to overwrite operator changes")
	}
	return privateWrite(path, c.PendingWings, true)
}

func saveConfig(path string, c SavedConfig, replace bool) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return privateWrite(path, append(b, '\n'), replace)
}

func ensureWings(path string, pending []byte) error {
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
			return errors.New("Wings configuration must be a private regular file (0600)")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if len(pending) > 0 && !bytes.Equal(b, pending) {
			return errors.New("existing Wings configuration differs from pending approval; refusing to replace it")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if len(pending) == 0 {
		return errors.New("saved Wings configuration is missing; restore it before retrying")
	}
	return privateWrite(path, pending, false)
}

// privateWrite uses a private temporary file and atomic rename. Hard-link install
// with no replacement prevents a concurrent setup from clobbering credentials.
func privateWrite(path string, data []byte, replace bool) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if info, err := os.Lstat(path); err == nil && (!replace || !info.Mode().IsRegular()) {
		return errors.New("refusing to replace existing configuration")
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".voltra-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if replace {
		err = os.Rename(f.Name(), path)
	} else {
		err = os.Link(f.Name(), path)
	}
	if err != nil {
		return err
	}
	// Persist the directory entry before the caller acknowledges credentials.
	if runtime.GOOS != "windows" {
		dir, err := os.Open(filepath.Dir(path))
		if err != nil {
			return err
		}
		defer dir.Close()
		return dir.Sync()
	}
	return nil
}

func LoadConfig(path string) (SavedConfig, error) {
	var c SavedConfig
	info, err := os.Lstat(path)
	if err != nil {
		return c, err
	}
	if !info.Mode().IsRegular() || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return c, errors.New("connector configuration must be a private regular file (0600)")
	}
	f, err := os.Open(path)
	if err != nil {
		return c, err
	}
	defer f.Close()
	if err := json.NewDecoder(io.LimitReader(f, 1024*1024)).Decode(&c); err != nil {
		return c, errors.New("invalid connector configuration")
	}
	_, err = validateConfig(c.Config)
	return c, err
}

func complete(ctx context.Context, path string, c *SavedConfig) error {
	if c.RequestToken == "" {
		return nil
	}
	base, err := ValidatePanelURL(c.EnrollmentPanelURL)
	if err != nil || !streamID.MatchString(c.EnrollmentID) {
		return errors.New("invalid saved enrollment state")
	}
	if err := request(ctx, http.MethodPost, endpoint(base, "/api/remote/enroll/"+c.EnrollmentID+"/complete", false), c.RequestToken, nil, nil); err != nil {
		return fmt.Errorf("configuration saved; rerun setup to retry completion: %w", err)
	}
	c.EnrollmentID = ""
	c.RequestToken = ""
	c.EnrollmentPanelURL = ""
	c.PendingWings = nil
	c.PreviousWings = nil
	return saveConfig(path, *c, true)
}

// RunSaved retries any interrupted enrollment ACK before starting the connector.
func RunSaved(ctx context.Context, path string) error {
	c, err := LoadConfig(path)
	if err != nil {
		return err
	}
	if c.RequestToken != "" {
		if c.WingsConfigPath == "" {
			return errors.New("pending enrollment has no Wings config path; rerun setup")
		}
		if err := persistWings(c.WingsConfigPath, c); err != nil {
			return err
		}
	}
	if err := complete(ctx, path, &c); err != nil {
		return err
	}
	// A recovery can crash before Setup restarts Wings. The connector service
	// resumes that work without restarting itself, then uses the new credential.
	if c.RestartWings {
		reportSetupStatus(ctx, c.Config, "starting", "")
		if err := runSystemd(ctx, [][]string{{"restart", "voltra-wings.service"}, {"is-active", "--quiet", "voltra-wings.service"}}); err != nil {
			reportSetupStatus(ctx, c.Config, "error", serviceFailureDetail)
			return err
		}
		c.RestartWings = false
		if err := saveConfig(path, c, true); err != nil {
			return err
		}
		reportSetupStatus(ctx, c.Config, "checking", "")
	}
	return Run(ctx, c.Config)
}

const serviceFailureDetail = "Node services failed to start. Check systemd logs on the node."

func finishSavedSetup(ctx context.Context, o SetupOptions, c SavedConfig) error {
	if err := finishSetup(ctx, o, c.Config); err != nil {
		return err
	}
	if o.StartServices && c.RestartWings {
		c.RestartWings = false
		return saveConfig(o.ConfigPath, c, true)
	}
	return nil
}

func reportSetupStatus(ctx context.Context, c Config, stage, detail string) {
	base, err := validateConfig(c)
	if err != nil {
		return
	}
	// Best effort only. Never upload stderr, paths, terminal output or credentials.
	statusCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = request(statusCtx, http.MethodPost, endpoint(base, "/api/remote/connector/status", false), c.Token, map[string]string{"stage": stage, "detail": detail}, nil)
}

func finishSetup(ctx context.Context, o SetupOptions, c Config) error {
	if !o.StartServices {
		return nil
	}
	fmt.Fprintln(o.Out, "[Services] Starting Wings and the outbound connector.")
	reportSetupStatus(ctx, c, "starting", "")
	if err := installServices(ctx, o); err != nil {
		reportSetupStatus(ctx, c, "error", serviceFailureDetail)
		return err
	}
	reportSetupStatus(ctx, c, "checking", "")
	fmt.Fprintln(o.Out, "[Panel check] Services are active. The Panel will verify authenticated Wings health before showing Ready.")
	return nil
}

func unitArg(s string) (string, error) {
	if !filepath.IsAbs(s) || strings.ContainsAny(s, "\r\n\x00") {
		return "", errors.New("systemd paths must be absolute")
	}
	s = strings.ReplaceAll(s, "%", "%%")
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	return "\"" + s + "\"", nil
}

func installServices(ctx context.Context, o SetupOptions) error {
	if !o.StartServices {
		return nil
	}
	if runtime.GOOS != "linux" {
		return errors.New("service installation requires Linux with systemd")
	}
	binary, err := exec.LookPath("wings")
	if err != nil {
		return errors.New("Wings binary is missing; rerun the Panel installer before setup")
	}
	wingsBinary, err := unitArg(binary)
	if err != nil {
		return err
	}
	if binary == "/usr/local/bin/wings" {
		wingsBinary = binary
	}
	data, err := readPrivateWings(o.WingsConfigPath)
	if err != nil {
		return err
	}
	var configuration struct {
		System struct {
			Root string `yaml:"root_directory"`
			Data string `yaml:"data"`
		} `yaml:"system"`
	}
	if err := yaml.Unmarshal(data, &configuration); err != nil {
		return errors.New("cannot read Wings storage configuration; restore valid YAML before starting services")
	}
	root := configuration.System.Root
	if root == "" {
		root = "/var/lib/voltra"
	}
	storage := configuration.System.Data
	if storage == "" {
		storage = filepath.Join(root, "volumes")
	}
	workingDirectory, err := unitArg(root)
	if err != nil {
		return fmt.Errorf("invalid Wings root storage directory: %w", err)
	}
	if root == "/var/lib/voltra" {
		workingDirectory = root
	}
	if !filepath.IsAbs(storage) {
		return errors.New("Wings data directory must be absolute; review system.data in Wings YAML")
	}
	journal := o.SteamJournalPath
	if journal == "" {
		journal = "/var/lib/voltra/steam-jobs"
	}
	for _, path := range []string{storage, journal} {
		clean := filepath.Clean(path)
		if !filepath.IsAbs(path) || clean != path {
			return errors.New("Steam service write directories must be clean absolute paths")
		}
		if homeProtected(clean) {
			return errors.New("ProtectHome blocks this Steam storage path; move Wings system.data and Steam journal outside /home, /root and /run/user")
		}
	}
	for _, path := range []string{root, storage, journal} {
		if err := os.MkdirAll(path, 0700); err != nil {
			return fmt.Errorf("cannot prepare Wings storage; check directory permissions, free space and read-only mounts: %w", err)
		}
		resolved, resolveErr := filepath.EvalSymlinks(path)
		if resolveErr != nil || resolved != path {
			return errors.New("Wings and Steam storage directories must not contain symlinks")
		}
	}
	wingsPath, err := unitArg(o.WingsConfigPath)
	if err != nil {
		return err
	}
	nodePath, err := unitArg(o.ConfigPath)
	if err != nil {
		return err
	}
	writePath, err := unitArg(filepath.Dir(o.ConfigPath))
	if err != nil {
		return err
	}
	storagePath, err := unitArg(storage)
	if err != nil {
		return err
	}
	journalPath, err := unitArg(journal)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(o.SystemdDir, 0755); err != nil {
		return err
	}
	units := map[string]string{
		"voltra-wings.service": "[Unit]\nDescription=Voltra Wings\nAfter=docker.service network-online.target\nRequires=docker.service\nWants=network-online.target\n\n[Service]\nUser=root\nWorkingDirectory=" + workingDirectory + "\nExecStart=" + wingsBinary + " --config " + wingsPath + "\nRestart=on-failure\nRestartSec=5s\nLimitNOFILE=65536\n\n[Install]\nWantedBy=multi-user.target\n",
		"voltra-node.service":  nodeServiceUnit(nodePath, writePath+" "+journalPath+" "+storagePath),
	}
	writes := map[string]string{}
	wingsExisting := false
	for name, text := range units {
		path := filepath.Join(o.SystemdDir, name)
		if existing, err := os.ReadFile(path); err == nil {
			if name == "voltra-wings.service" {
				wingsExisting = true
			}
			if string(existing) != text && !(name == "voltra-node.service" && string(existing) == nodeServiceUnit(nodePath, writePath)) {
				return fmt.Errorf("existing %s differs; review %s and preserve custom settings before rerunning setup", name, path)
			}
			if string(existing) == text {
				continue
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		writes[path] = text
	}
	for path, text := range writes {
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			return err
		}
	}
	start := [][]string{{"restart", "voltra-wings.service", "voltra-node.service"}}
	if wingsExisting && !o.Reconnect {
		start = [][]string{{"start", "voltra-wings.service"}, {"restart", "voltra-node.service"}}
	}
	commands := [][]string{{"daemon-reload"}, {"enable", "voltra-wings.service", "voltra-node.service"}}
	commands = append(commands, start...)
	commands = append(commands, []string{"is-active", "--quiet", "voltra-wings.service"}, []string{"is-active", "--quiet", "voltra-node.service"})
	if err := runSystemd(ctx, commands); err != nil {
		return err
	}
	fmt.Fprintln(o.Out, "Wings and the outbound connector are active. No inbound management port is required.")
	return nil
}

func homeProtected(path string) bool {
	for _, root := range []string{"/home", "/root", "/run/user"} {
		if path == root || strings.HasPrefix(path, root+"/") {
			return true
		}
	}
	return false
}

func nodeServiceUnit(nodePath, writePaths string) string {
	return "[Unit]\nDescription=Voltra outbound node connector\nAfter=network-online.target voltra-wings.service\nWants=network-online.target voltra-wings.service\n\n[Service]\nUser=root\nExecStart=/usr/local/bin/voltra-node run --config " + nodePath + "\nRestart=on-failure\nRestartSec=5s\nUMask=0077\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=" + writePaths + "\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target\n"
}

func runSystemd(ctx context.Context, commands [][]string) error {
	if runtime.GOOS != "linux" {
		return errors.New("service recovery requires Linux with systemd")
	}
	for _, args := range commands {
		commandCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		err := exec.CommandContext(commandCtx, "systemctl", args...).Run()
		cancel()
		if err != nil {
			return fmt.Errorf("systemd %s failed; run systemctl status voltra-wings voltra-node and journalctl -u voltra-wings -u voltra-node -n 100; check Docker, storage permissions and port 8080 conflicts", args[0])
		}
	}
	return nil
}
