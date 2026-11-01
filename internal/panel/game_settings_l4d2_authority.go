package panel

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
)

const l4d2CanonicalStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/source_variant_runtime.py"
const l4d2ManagedFooter = "\n// BEGIN VOLTRA L4D MANAGED\nexec voltra-managed.cfg\nexec voltra-variant.cfg\necho VOLTRA_L4D_CONFIG_APPLIED\n// END VOLTRA L4D MANAGED\n"

// Pure snapshot resolver, deliberately not registered in shared dispatch.
// files must be a complete Wings-confined cfg/addons/scripts inventory, not a
// caller assertion that those paths are safe. Missing required files fail closed.
// Root must reread the inventory and startup under the existing mutation lock.
func resolveL4D2Settings(recipe, startup string, argv []string, files map[string][]byte) (gameSettingsParsed, error) {
	refuse := func() (gameSettingsParsed, error) {
		return gameSettingsParsed{}, bad("L4D2 configuration authority is unresolved; review Files and Runtime.")
	}
	if recipe != l4d2SettingsRecipe || startup != l4d2CanonicalStartup || !l4d2ManagedArgv(argv) {
		return refuse()
	}
	base := "/left4dead2/cfg/"
	data, ok := files[l4d2SettingsPath]
	if !ok || !bytes.HasSuffix(data, []byte(l4d2ManagedFooter)) {
		return refuse()
	}
	prefix := data[:len(data)-len(l4d2ManagedFooter)]
	if bytes.Contains(prefix, []byte("VOLTRA L4D MANAGED")) {
		return refuse()
	}
	// Only the exact generated wrapper is inert here: the L4D argv never selects it.
	required := map[string]bool{"server.cfg": true, "voltra-managed.cfg": true, "voltra-variant.cfg": true, "voltra-login.cfg": true, "voltra-server.cfg": true}
	for name, content := range files {
		if strings.HasPrefix(name, base) && required[strings.TrimPrefix(name, base)] {
			continue
		}
		// Any other executable config, addon or script is unresolved, including empty
		// files: presence can change engine lookup/selection and is not ignored.
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, base) || strings.HasPrefix(lower, "/left4dead2/addons/") || strings.HasPrefix(lower, "/left4dead2/scripts/") {
			_ = content
			return refuse()
		}
	}
	for name := range required {
		if _, ok := files[base+name]; !ok {
			return refuse()
		}
	}
	if string(files[base+"voltra-server.cfg"]) != "exec server.cfg\nexec voltra-managed.cfg\nexec voltra-variant.cfg\n" {
		return refuse()
	}
	managed := string(files[base+"voltra-managed.cfg"])
	if !l4d2ManagedConfig.MatchString(managed) {
		return refuse()
	}
	variant := string(files[base+"voltra-variant.cfg"])
	if !l4d2VariantConfig.MatchString(variant) {
		return refuse()
	}
	login := string(files[base+"voltra-login.cfg"])
	if login != "// Anonymous game server login.\n" && !l4d2LoginConfig.MatchString(login) {
		return refuse()
	}
	parsed, err := parseL4D2Settings(prefix)
	if err != nil {
		return parsed, err
	}
	patch := parsed.patch
	parsed.patch = func(changes map[string]string) ([]byte, error) {
		next, err := patch(changes)
		if err != nil {
			return nil, err
		}
		return append(next, []byte(l4d2ManagedFooter)...), nil
	}
	return parsed, nil
}

// These are the exact generators in source-runtime.py/source-variant-runtime.py.
// Exclude all candidate gameplay keys from the trailing managed command files.
var l4d2ManagedConfig = regexp.MustCompile(`\A// Managed by the setup form\. Advanced settings remain in server\.cfg\.\nhostname "[^"\\;\x00-\x1f\x7f]*"\nsv_password "[^"\\;\x00-\x1f\x7f]*"\nrcon_password "[^"\\;\x00-\x1f\x7f]*"\nsv_lan [01]\n\z`)
var l4d2VariantConfig = regexp.MustCompile(`\Az_difficulty "(?:Easy|Normal|Hard|Impossible)"\nsv_allow_lobby_connect_only [01]\n\z`)
var l4d2LoginConfig = regexp.MustCompile(`\Asv_setsteamaccount "[A-Za-z0-9]{1,128}"\n\z`)
var l4d2MapName = regexp.MustCompile(`\A[A-Za-z0-9_/-]{1,128}\z`)

func l4d2ManagedArgv(a []string) bool {
	// Canonical container cwd is /home/container. No shell splitting or arbitrary
	// +exec is accepted. Custom mutation modes remain outside this resolver.
	if len(a) < 18 || a[0] != "/home/container/srcds_run" || a[1] != "+mp_gamemode" {
		return false
	}
	switch a[2] {
	case "coop", "versus", "survival", "realism", "scavenge", "teamversus", "teamscavenge":
	default:
		return false
	}
	fixed := []string{"-game", "left4dead2", "-console", "-ip", "0.0.0.0", "-port"}
	for i, v := range fixed {
		if a[3+i] != v {
			return false
		}
	}
	port, err := strconv.Atoi(a[9])
	if err != nil || port < 1025 || port > 65535 || strconv.Itoa(port) != a[9] {
		return false
	}
	if a[10] != "-strictportbind" || a[11] != "-norestart" {
		return false
	}
	i := 12
	if a[i] == "+clientport" {
		if len(a) <= i+2 {
			return false
		}
		p, e := strconv.Atoi(a[i+1])
		if e != nil || p < 1025 || p > 65535 || p == port || strconv.Itoa(p) != a[i+1] {
			return false
		}
		i += 2
	}
	if len(a) != i+6 || a[i] != "+sv_lan" || (a[i+1] != "0" && a[i+1] != "1") || a[i+2] != "+exec" || a[i+3] != "voltra-login.cfg" || a[i+4] != "+map" {
		return false
	}
	m := a[i+5]
	if !l4d2MapName.MatchString(m) {
		return false
	}
	for _, p := range strings.Split(m, "/") {
		if p == "" || p == "." || p == ".." {
			return false
		}
	}
	return true
}
