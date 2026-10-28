package panel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Images and their Temurin base are documented by pterodactyl/yolks/java.
func javaDefaultRuntimes() []M {
	out := []M{}
	for _, major := range []int64{8, 11, 16, 17, 21, 25} {
		out = append(out, M{"id": fmt.Sprintf("temurin-%d", major), "name": fmt.Sprintf("Java %d (Temurin)", major), "major": major, "distribution": "temurin", "image": fmt.Sprintf("ghcr.io/pterodactyl/yolks:java_%d", major), "enabled": true})
	}
	return out
}

func javaInteger(v any, field string, minimum, maximum int64) (int64, error) {
	// JSON numbers must be finite integers. Do not use num, which truncates.
	n, ok := applicationNumeric(v)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n || n < float64(minimum) || n > float64(maximum) {
		return 0, bad(fmt.Sprintf("%s must be an integer between %d and %d.", field, minimum, maximum))
	}
	if _, ok := v.(string); ok {
		return 0, bad(field + " must be a JSON integer.")
	}
	return int64(n), nil
}

var javaID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$`)
var javaImage = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,510}$`)
var javaArgsFile = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$`)
var javaMemoryFlag = regexp.MustCompile(`(?i)(^|[\s"'])(-Xm[sx][^\s"']*|-XX:(?:Max|Initial|Min)RAM(?:Percentage|Fraction|Size)=[^\s"']*|-XX:(?:MaxHeapSize|InitialHeapSize)=[^\s"']*)`)

type javaWord struct {
	start, end int
	text       string
}

func javaWords(s string) ([]javaWord, error) {
	out := []javaWord{}
	for i := 0; i < len(s); {
		if strings.ContainsRune(" \t\r\n", rune(s[i])) {
			i++
			continue
		}
		start, quote := i, byte(0)
		var word strings.Builder
		for i < len(s) {
			c := s[i]
			if quote == 0 && strings.ContainsRune(" \t\r\n", rune(c)) {
				break
			}
			if c == '\\' && quote != '\'' {
				i++
				if i == len(s) {
					return nil, bad("JVM arguments contain an unfinished escape.")
				}
				word.WriteByte(s[i])
				i++
				continue
			}
			if quote != 0 {
				if c == quote {
					quote = 0
				} else {
					word.WriteByte(c)
				}
				i++
				continue
			}
			if c == '\'' || c == '"' {
				quote = c
				i++
				continue
			}
			word.WriteByte(c)
			i++
		}
		if quote != 0 {
			return nil, bad("JVM arguments contain an unfinished quote.")
		}
		out = append(out, javaWord{start: start, end: i, text: word.String()})
	}
	return out, nil
}

func javaValidateFlags(v string) error {
	if len(v) > 16384 || strings.ContainsAny(v, "\x00\r\n") {
		return bad("JVM arguments must be one line of at most 16384 characters.")
	}
	words, err := javaWords(v)
	if err != nil {
		return err
	}
	for _, word := range words {
		if loc := javaMemoryFlag.FindStringIndex(word.text); loc != nil && loc[0] == 0 {
			return bad("Set heap sizes in the memory fields; JVM arguments cannot override heap or RAM limits.")
		}
	}
	// These are JVM options, never a second shell command, launcher target or file.
	if strings.ContainsAny(v, "`;|&<>$") {
		return bad("JVM arguments cannot contain shell operators or substitutions.")
	}
	valueOption := false
	for _, word := range words {
		f := word.text
		if strings.HasPrefix(f, "@") || f == "-jar" || f == "-m" || f == "--module" || f == "--disable-@files" {
			return bad("JVM arguments cannot select a program or another argument file.")
		}
		if valueOption {
			valueOption = false
			continue
		}
		if !strings.HasPrefix(f, "-") {
			return bad("JVM arguments must contain options, not a main class or program argument.")
		}
		switch f {
		case "-cp", "-classpath", "--class-path", "-p", "--module-path", "--upgrade-module-path", "--add-opens", "--add-exports", "--add-reads", "--add-modules", "--limit-modules", "--patch-module":
			valueOption = true
		}
	}
	if valueOption {
		return bad("A JVM option is missing its value.")
	}
	return nil
}

func javaObject(value any) (M, error) {
	m, ok := value.(map[string]any)
	if !ok {
		return nil, bad("java_config must be an object.")
	}
	return m, nil
}

func javaNormalize(value any, egg bool) (M, error) {
	m, err := javaObject(value)
	if err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return M{}, nil
	}
	out := M{"enabled": true, "required_major": int64(0), "required_distribution": ""}
	if egg {
		out["memory_mode"], out["args_file"], out["jvm_args"] = "command", "user_jvm_args.txt", ""
	} else {
		out["runtime_id"], out["xms_mib"], out["xmx_mib"], out["extra_args"] = "auto", int64(256), int64(0), ""
	}
	for k, v := range m {
		if _, ok := out[k]; !ok && !(egg && (k == "default_major" || k == "legacy_startup")) {
			return nil, bad("Unknown Java setting: " + k)
		}
		switch k {
		case "enabled":
			if _, ok := v.(bool); !ok {
				return nil, bad("Java enabled must be a boolean.")
			}
		case "default_major":
			v, err = javaInteger(v, k, 8, 999)
			if err != nil {
				return nil, err
			}
		case "required_major", "xms_mib", "xmx_mib":
			max := int64(1 << 40)
			if k == "required_major" {
				max = 999
			}
			v, err = javaInteger(v, k, 0, max)
			if err != nil {
				return nil, err
			}
		default:
			// decode normalizes blank strings to nil throughout JSON objects.
			if v == nil {
				v = ""
			}
			if _, ok := v.(string); !ok {
				return nil, bad(k + " must be a string.")
			}
		}
		out[k] = v
	}
	if s := str(out["required_distribution"]); s != "" && !javaID.MatchString(s) {
		return nil, bad("Invalid Java distribution.")
	}
	if egg {
		if value, exists := out["default_major"]; exists && num(value) < num(out["required_major"]) {
			return nil, bad("The default Java major cannot be older than the egg minimum.")
		}
		if out["memory_mode"] != "command" && out["memory_mode"] != "argfile" {
			return nil, bad("memory_mode must be command or argfile.")
		}
		if !javaArgsFile.MatchString(str(out["args_file"])) || strings.Contains(str(out["args_file"]), "..") {
			return nil, bad("args_file must be a filename in the server directory.")
		}
		if legacy := str(out["legacy_startup"]); legacy != "" {
			if out["memory_mode"] != "argfile" {
				return nil, bad("legacy_startup is only available for argfile-managed eggs.")
			}
			if err := javaValidateLegacyStartup(legacy); err != nil {
				return nil, err
			}
		}
		err = javaValidateFlags(str(out["jvm_args"]))
	} else {
		if !javaID.MatchString(str(out["runtime_id"])) {
			return nil, bad("Invalid runtime_id.")
		}
		err = javaValidateFlags(str(out["extra_args"]))
	}
	return out, err
}

func javaValidateCatalog(value any) ([]M, error) {
	values := eggSlice(value)
	if values == nil || len(values) == 0 || len(values) > 200 {
		return nil, bad("runtimes must contain 1 to 200 runtimes.")
	}
	out, seen := []M{}, map[string]bool{}
	for _, value := range values {
		m, err := javaObject(value)
		if err != nil {
			return nil, err
		}
		id, name, distro, image := str(m["id"]), str(m["name"]), str(m["distribution"]), str(m["image"])
		if !javaID.MatchString(id) || id == "auto" || seen[id] {
			return nil, bad("Runtime IDs must be unique and cannot be auto.")
		}
		if strings.TrimSpace(name) == "" || len(name) > 191 || !javaID.MatchString(distro) || !javaImage.MatchString(image) {
			return nil, bad("Each runtime needs a name, distribution and valid container image.")
		}
		major, err := javaInteger(m["major"], "major", 8, 999)
		if err != nil {
			return nil, err
		}
		if _, ok := m["enabled"].(bool); !ok {
			return nil, bad("Runtime enabled must be a boolean.")
		}
		seen[id] = true
		out = append(out, M{"id": id, "name": name, "distribution": distro, "image": image, "major": major, "enabled": m["enabled"]})
	}
	return out, nil
}

func (a *App) javaRuntimes(ctx context.Context) ([]M, error) {
	if a.DB == nil {
		return javaDefaultRuntimes(), nil
	}
	seed, _ := json.Marshal(javaDefaultRuntimes())
	if err := a.exec(ctx, "INSERT INTO settings(key,value) VALUES('java.runtimes',$1::jsonb) ON CONFLICT(key) DO NOTHING", string(seed)); err != nil {
		return nil, err
	}
	row, err := a.one(ctx, "SELECT value FROM settings WHERE key='java.runtimes'")
	if err != nil {
		return nil, err
	}
	return javaValidateCatalog(row["value"])
}

func (a *App) javaResolve(ctx context.Context, egg M, config M, memory int64) (M, error) {
	ec := asMap(egg["java_config"])
	if len(ec) == 0 && len(config) == 0 {
		return M{}, nil
	}
	var err error
	ec, err = javaNormalize(ec, true)
	if err != nil {
		return nil, err
	}
	config, err = javaNormalize(config, false)
	if err != nil {
		return nil, err
	}
	if len(config) > 0 && !boolean(config["enabled"]) || len(config) == 0 && !boolean(ec["enabled"]) {
		return M{}, nil
	}
	if len(config) == 0 {
		config, _ = javaNormalize(M{"enabled": true}, false)
	}
	required := num(config["required_major"])
	if required == 0 {
		required = num(ec["required_major"])
		// A preferred automatic default must not become a hard minimum for
		// historical versions using an explicitly selected compatible runtime.
		if str(config["runtime_id"]) == "auto" && num(ec["default_major"]) > 0 {
			required = num(ec["default_major"])
		}
	}
	if required == 0 {
		required = 17
	}
	distro := str(ec["required_distribution"])
	if sd := str(config["required_distribution"]); sd != "" {
		if distro != "" && sd != distro {
			return nil, bad("The runtime distribution does not meet the egg requirement.")
		}
		distro = sd
	}
	if er := num(ec["required_major"]); er > 0 && required < er {
		return nil, bad("The requested Java version is older than the egg requires.")
	}
	runtimes, err := a.javaRuntimes(ctx)
	if err != nil {
		return nil, err
	}
	selected := M{}
	for _, runtime := range runtimes {
		if !boolean(runtime["enabled"]) || distro != "" && str(runtime["distribution"]) != distro {
			continue
		}
		if config["runtime_id"] == "auto" {
			if num(runtime["major"]) == required {
				selected = runtime
				break
			}
		} else if runtime["id"] == config["runtime_id"] && num(runtime["major"]) >= required {
			selected = runtime
			break
		}
	}
	if len(selected) == 0 {
		return nil, bad("No enabled Java runtime meets the selected version and distribution requirements.")
	}
	if memory < 0 || memory > 1<<40 {
		return nil, bad("Invalid container memory limit.")
	}
	reserve := (memory + 9) / 10
	if reserve < 128 {
		reserve = 128
	}
	xmx, xms := num(config["xmx_mib"]), num(config["xms_mib"])
	if memory == 0 && xmx == 0 {
		return nil, bad("Set an explicit maximum heap for a server with unlimited memory.")
	}
	if xmx == 0 {
		xmx = memory - reserve
	}
	if xmx < 1 || memory > 0 && xmx > memory-reserve {
		return nil, bad("The maximum heap must leave at least 0.125 GB or 10% of container memory for Java overhead.")
	}
	if xms == 0 {
		xms = min(int64(256), xmx)
	}
	if xms > xmx {
		return nil, bad("The initial heap cannot exceed the maximum heap.")
	}
	flags := fmt.Sprintf("-Xms%dM -Xmx%dM", xms, xmx)
	for _, v := range []string{str(ec["jvm_args"]), str(config["extra_args"])} {
		if v != "" {
			flags += " " + v
		}
	}
	return M{"runtime_id": selected["id"], "image": selected["image"], "major": selected["major"], "xms_mib": xms, "xmx_mib": xmx, "reserved_mib": reserve, "jvm_args": flags}, nil
}

func javaEnabled(egg, config M) bool {
	if len(config) > 0 {
		return boolean(config["enabled"])
	}
	return boolean(asMap(egg["java_config"])["enabled"])
}

func (a *App) registerJava(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/java/runtimes", a.javaCatalog)
	mux.HandleFunc("PUT /api/admin/java/runtimes", a.javaCatalog)
	mux.HandleFunc("GET /api/client/java/runtimes", a.javaCatalog)
	mux.HandleFunc("GET /api/client/servers/{server}/java", a.javaSettings)
	mux.HandleFunc("PUT /api/client/servers/{server}/java", a.javaSettings)
}

func (a *App) javaCatalog(w http.ResponseWriter, r *http.Request) {
	u, err := a.user(r)
	if err == nil && strings.HasPrefix(r.URL.Path, "/api/admin/") {
		_, err = a.requireAdmin(r)
	}
	if err == nil && r.Method == "PUT" && !boolean(u["root_admin"]) {
		err = forbidden()
	}
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == "PUT" {
		d, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		runtimes, err := javaValidateCatalog(d["runtimes"])
		if err != nil {
			fail(w, err)
			return
		}
		body, _ := json.Marshal(runtimes)
		if err = a.exec(r.Context(), "INSERT INTO settings(key,value) VALUES('java.runtimes',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(body)); err != nil {
			fail(w, err)
			return
		}
		_ = a.audit(r.Context(), UserID(r), 0, "java:runtimes.update", M{"count": len(runtimes)})
	}
	runtimes, err := a.javaRuntimes(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/client/") {
		filtered := []M{}
		for _, runtime := range runtimes {
			if boolean(runtime["enabled"]) {
				filtered = append(filtered, runtime)
			}
		}
		runtimes = filtered
	}
	writeJSON(w, 200, collection("java_runtime", runtimes))
}

func (a *App) javaSettingsView(ctx context.Context, user, server M) (M, error) {
	egg, err := a.effectiveEgg(ctx, num(server["egg_id"]))
	if err != nil {
		return nil, err
	}
	config := asMap(server["java_config"])
	effective, err := a.javaResolve(ctx, egg, config, num(server["memory"]))
	effectiveError := ""
	if err != nil {
		effective, effectiveError = M{}, err.Error()
	}
	runtimes, err := a.javaRuntimes(ctx)
	if err != nil {
		return nil, err
	}
	return M{"config": config, "egg": asMap(egg["java_config"]), "runtimes": runtimes, "effective": effective, "effective_error": effectiveError, "can_update": a.can(ctx, user, server, "startup.update"), "can_change_runtime": a.can(ctx, user, server, "startup.docker-image")}, nil
}

func (a *App) javaSettings(w http.ResponseWriter, r *http.Request) {
	permission := "startup.read"
	if r.Method == "PUT" {
		permission = "startup.update"
	}
	server, err := a.server(r, permission)
	if err != nil {
		fail(w, err)
		return
	}
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == "PUT" {
		d, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		value := any(d)
		if v, ok := d["config"]; ok {
			value = v
		}
		config, err := javaNormalize(value, false)
		if err != nil {
			fail(w, err)
			return
		}
		egg, err := a.effectiveEgg(r.Context(), num(server["egg_id"]))
		if err != nil {
			fail(w, err)
			return
		}
		if err = javaCheckUpdate(user, server, egg, config); err != nil {
			fail(w, err)
			return
		}
		effective, err := a.javaResolve(r.Context(), egg, config, num(server["memory"]))
		if err != nil {
			fail(w, err)
			return
		}
		oldID, newID := str(asMap(server["java_config"])["runtime_id"]), str(config["runtime_id"])
		if oldID == "" {
			oldID = "auto"
		}
		if newID == "" {
			newID = "auto"
		}
		if (oldID != newID || len(effective) > 0 && str(effective["image"]) != str(server["image"])) && !a.can(r.Context(), user, server, "startup.docker-image") {
			fail(w, forbidden())
			return
		}
		server, err = a.javaSave(r.Context(), server, egg, config, effective)
		if err != nil {
			fail(w, err)
			return
		}
		_ = a.audit(r.Context(), UserID(r), num(server["id"]), "server:java.update", M{"runtime_id": effective["runtime_id"], "xms_mib": effective["xms_mib"], "xmx_mib": effective["xmx_mib"]})
	}
	view, err := a.javaSettingsView(r.Context(), user, server)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("java_settings", view))
}

func javaCheckUpdate(user, server, egg, next M) error {
	if boolean(user["root_admin"]) {
		return nil
	}
	old, ec := asMap(server["java_config"]), asMap(egg["java_config"])
	enabled := func(c M) bool {
		if len(c) > 0 {
			return boolean(c["enabled"])
		}
		return boolean(ec["enabled"])
	}
	major := func(c M) int64 {
		n := num(c["required_major"])
		if n == 0 {
			n = num(ec["required_major"])
		}
		if n == 0 {
			n = 17
		}
		return n
	}
	distribution := func(c M) string {
		d := str(c["required_distribution"])
		if d == "" {
			d = str(ec["required_distribution"])
		}
		return d
	}
	if enabled(old) && !enabled(next) || major(next) < major(old) || distribution(next) != distribution(old) {
		return &APIError{Status: 403, Code: "JavaRequirementPermission", Detail: "Only an administrator can disable managed Java, lower its required version, or change its required distribution."}
	}
	return nil
}

func (a *App) javaMutationLock(ctx context.Context, id int64) (func(), error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", id); err != nil {
		_ = tx.Rollback(context.Background())
		return nil, err
	}
	return func() { _ = tx.Rollback(context.Background()) }, nil
}

// The daemon reads panel state during sync, so commit the new data first and
// compensate in a separate transaction if sync fails. Keep independent fields
// out of compensation to preserve unrelated concurrent work.
func (a *App) javaRestore(server M, keys []string, allocations, variables, secrets []M) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	sets, args := []string{}, []any{server["id"]}
	for _, key := range keys {
		column, err := quoted(key)
		if err != nil {
			return err
		}
		args = append(args, server[key])
		sets = append(sets, fmt.Sprintf("%s=$%d", column, len(args)))
	}
	if _, err = tx.Exec(ctx, "UPDATE servers SET "+strings.Join(sets, ",")+",updated_at=NOW() WHERE id=$1", args...); err != nil {
		return err
	}
	if allocations != nil {
		if _, err = tx.Exec(ctx, "UPDATE allocations SET server_id=NULL WHERE server_id=$1", server["id"]); err != nil {
			return err
		}
		for _, allocation := range allocations {
			tag, e := tx.Exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2 AND (server_id IS NULL OR server_id=$1)", server["id"], allocation["id"])
			if e != nil {
				return e
			}
			if tag.RowsAffected() != 1 {
				return bad("Could not restore an allocation after daemon sync failed.")
			}
		}
	}
	if variables != nil {
		if _, err = tx.Exec(ctx, "DELETE FROM server_variables WHERE server_id=$1", server["id"]); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "DELETE FROM server_integration_secrets WHERE server_id=$1", server["id"]); err != nil {
			return err
		}
		for _, v := range variables {
			if _, err = tx.Exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) VALUES($1,$2,$3)", server["id"], v["variable_id"], v["variable_value"]); err != nil {
				return err
			}
		}
		for _, v := range secrets {
			if _, err = tx.Exec(ctx, "INSERT INTO server_integration_secrets(server_id,variable_id,value,source) VALUES($1,$2,$3,$4)", server["id"], v["variable_id"], v["value"], opDefault(str(v["source"]), "integration")); err != nil {
				return err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	_ = a.syncServer(ctx, server)
	return nil
}

func (a *App) javaSave(ctx context.Context, server, egg, config, effective M) (M, error) {
	copy := M{}
	for k, v := range server {
		copy[k] = v
	}
	copy["java_config"] = config
	if len(effective) > 0 {
		copy["image"] = effective["image"]
	}
	if _, _, err := javaInvocation(egg, copy, effective); err != nil {
		return nil, err
	}
	// Serialize cooperating panel mutations while allowing Wings' callback to read
	// the committed settings during /sync. A regular row lock across /sync would
	// deadlock that callback, and an uncommitted change would be invisible to it.
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", num(server["id"])); err != nil {
		return nil, err
	}
	current, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", server["id"])
	if err != nil {
		return nil, err
	}
	before, _ := json.Marshal(server["java_config"])
	nowConfig, _ := json.Marshal(current["java_config"])
	if string(before) != string(nowConfig) || str(current["image"]) != str(server["image"]) || current["memory"] != server["memory"] || current["egg_id"] != server["egg_id"] || current["startup"] != server["startup"] {
		return nil, &APIError{Status: 409, Code: "JavaSettingsConflict", Detail: "Java settings changed. Reload before saving."}
	}
	updated, err := a.update(ctx, "servers", num(server["id"]), M{"java_config": config, "image": copy["image"]})
	if err != nil {
		return nil, err
	}
	if err = a.syncServer(ctx, updated); err != nil {
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, restoreErr := a.update(rollbackCtx, "servers", num(server["id"]), M{"java_config": server["java_config"], "image": server["image"]})
		if restoreErr == nil {
			_ = a.syncServer(rollbackCtx, server)
		}
		return nil, errors.Join(err, restoreErr)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return updated, nil
}

// Retain custom flags exactly while replacing memory options from older eggs.
func javaStripMemory(s string) string {
	words, err := javaWords(s)
	if err != nil {
		return s
	}
	var out strings.Builder
	position := 0
	for _, word := range words {
		if javaMemoryFlag.MatchString(word.text) && javaMemoryFlag.FindStringIndex(word.text)[0] == 0 {
			out.WriteString(s[position:word.start])
			position = word.end
		}
	}
	out.WriteString(s[position:])
	return out.String()
}

func javaShellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }

var javaCommand = regexp.MustCompile(`^\s*(?:exec\s+)?(?:/[^\s]+/)?java(?:\s|$)`)
var javaScriptCommand = regexp.MustCompile(`^\s*(?:(?:bash|sh)\s+)?(\.?/?[a-zA-Z0-9_.-]+\.sh)(?:\s.*)?$`)

var javaLegacyJar = regexp.MustCompile(`^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\.jar|\{\{[A-Z_][A-Z0-9_]*\}\})$`)

func javaValidateLegacyStartup(startup string) error {
	if len(startup) > 4096 || strings.ContainsAny(startup, "\x00\r\n`;|&<>$@\\()[]*?!#~") {
		return bad("legacy_startup must be a direct Java -jar command without shell operators, substitutions or argument files.")
	}
	words, err := javaWords(startup)
	if err != nil {
		return err
	}
	if len(words) < 3 || words[0].text != "java" || words[1].text != "-jar" || !javaLegacyJar.MatchString(words[2].text) {
		return bad("legacy_startup must start with java -jar followed by a server JAR filename or environment placeholder.")
	}
	for _, word := range words[3:] {
		if strings.ContainsAny(word.text, "{}") || word.text == "-jar" || javaMemoryFlag.MatchString(word.text) {
			return bad("legacy_startup cannot add a second launcher or override managed memory.")
		}
	}
	return nil
}

func javaConfiguredStartup(egg, effective M, startup string) string {
	config := asMap(egg["java_config"])
	if config["memory_mode"] == "argfile" && num(effective["major"]) <= 8 && str(config["legacy_startup"]) != "" {
		return str(config["legacy_startup"])
	}
	return startup
}

var javaVariable = regexp.MustCompile(`\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}`)

func javaLauncher(script string) (string, M, error) {
	script = javaVariable.ReplaceAllStringFunc(script, func(v string) string { return "${" + v[2:len(v)-2] + "}" })
	return `bash -c eval\$IFS\"\$VOLTRA_JAVA_SCRIPT\"`, M{"VOLTRA_JAVA_SCRIPT": script}, nil
}

// Tokenize argument files without reformatting custom properties, quotes or
// comments. Memory tokens are removed as whole arguments, never substrings of
// -D properties. Java @files use quotes and backslash escaping, not shell eval.
const javaArgfileCleaner = `
function flush(    v) {
 v=tolower(word)
 if (v !~ /^-xm[sx]/ && v !~ /^-xx:(max|initial|min)ram(percentage|fraction|size)=/ && v !~ /^-xx:(maxheapsize|initialheapsize)=/) printf "%s", raw
 raw=""; word=""
}
{
 if ($0=="# BEGIN VOLTRA JAVA MEMORY") { managed=1; next }
 if (managed) { if ($0=="# END VOLTRA JAVA MEMORY") managed=0; next }
 for (i=1;i<=length($0);i++) {
  c=substr($0,i,1)
  if (escaped) { raw=raw c; word=word c; escaped=0; continue }
  if (c=="\\") { raw=raw c; escaped=1; continue }
  if (quote!="") { raw=raw c; if(c==quote)quote=""; else word=word c; continue }
  if (c=="\042" || c=="\047") { quote=c; raw=raw c; continue }
  if (c=="#") { flush(); printf "%s", substr($0,i); break }
  if (c ~ /[ \t\r]/) { flush(); printf "%s", c; continue }
  raw=raw c; word=word c
 }
 if (quote!="" || escaped) { raw=raw "\n"; word=word "\n"; escaped=0 }
 else { flush(); printf "\n" }
}
END { if (managed) exit 64; flush() }
`

func javaMinecraftEgg(egg M) bool {
	if str(egg["uuid"]) == minecraftLibraryEggUUID {
		return true
	}
	for _, feature := range eggStrings(egg["features"]) {
		if str(feature) == "minecraft" {
			return true
		}
	}
	return false
}

// Browser responses show a readable equivalent, never the shell trampoline or
// its environment. Call before the existing variable masking/substitution.
func (a *App) javaReadable(ctx context.Context, egg, server M, full bool) (string, M) {
	startup := str(server["startup"])
	if !javaEnabled(egg, asMap(server["java_config"])) {
		return startup, M{"java_managed": false}
	}
	effective, err := a.javaResolve(ctx, egg, asMap(server["java_config"]), num(server["memory"]))
	startup = javaConfiguredStartup(egg, effective, startup)
	clean := strings.TrimSpace(javaStripMemory(startup))
	if err != nil {
		return clean + " # Managed Java settings need attention", M{"java_managed": true, "java_effective_error": err.Error()}
	}
	flags := str(effective["jvm_args"])
	if !full {
		flags = fmt.Sprintf("-Xms%dM -Xmx%dM", num(effective["xms_mib"]), num(effective["xmx_mib"]))
	}
	if loc := javaCommand.FindStringIndex(clean); loc != nil {
		clean = strings.TrimRight(clean[:loc[1]], " \t") + " " + flags + " " + strings.TrimLeft(clean[loc[1]:], " \t")
	} else {
		file := str(asMap(egg["java_config"])["args_file"])
		if file == "" {
			file = "user_jvm_args.txt"
		}
		clean += " # JVM args in " + file + ": " + flags
	}
	return clean, M{"java_managed": true}
}

func javaInvocation(egg, server, effective M) (string, M, error) {
	startup := str(server["startup"])
	env := M{}
	if len(effective) == 0 {
		return startup, env, nil
	}
	ec := asMap(egg["java_config"])
	if ec["memory_mode"] == "argfile" && num(effective["major"]) <= 8 && str(ec["legacy_startup"]) != "" {
		if err := javaValidateLegacyStartup(str(ec["legacy_startup"])); err != nil {
			return "", nil, err
		}
		startup = javaConfiguredStartup(egg, effective, startup)
	}
	flags := str(effective["jvm_args"])
	clean := strings.TrimSpace(javaStripMemory(startup))
	clean = strings.TrimSpace(strings.TrimPrefix(clean, "exec "))
	if num(effective["major"]) <= 8 && strings.Contains(clean, "@") {
		return "", nil, bad("Java 8 does not support launcher argument files. Use command memory mode and a direct java startup.")
	}
	if ec["memory_mode"] != "argfile" || num(effective["major"]) <= 8 {
		loc := javaCommand.FindStringIndex(clean)
		if loc == nil || strings.ContainsAny(clean, ";|&\n\r") || strings.Contains(clean, "@") {
			return "", nil, bad("Command memory mode requires a direct java startup without argument files. Use argfile mode for Forge run.sh.")
		}
		return javaLauncher("exec " + strings.TrimPrefix(strings.TrimRight(clean[:loc[1]], " \t"), "exec ") + " " + flags + " " + strings.TrimLeft(clean[loc[1]:], " \t"))
	}
	file := str(ec["args_file"])
	if file == "" {
		file = "user_jvm_args.txt"
	}
	if !javaArgsFile.MatchString(file) || strings.Contains(file, "..") {
		return "", nil, bad("Invalid Java args filename.")
	}
	script := javaScriptCommand.FindStringSubmatch(clean)
	if !javaCommand.MatchString(clean) && script == nil {
		return "", nil, bad("Argfile memory mode requires a direct java command or a local shell script.")
	}
	if script == nil {
		if !strings.Contains(clean, "@"+file) {
			loc := javaCommand.FindStringIndex(clean)
			clean = strings.TrimRight(clean[:loc[1]], " \t") + " @" + file + " " + clean[loc[1]:]
		}
	}
	// Work at launch, after installation creates the file. Atomic replacement
	// preserves unrelated flags and comments and never edits Forge's run script.
	launch := "set -eu\n"
	if script != nil {
		check := `/^[ \t]*#/ {next}
/^[ \t]*(exec[ \t]+)?java[ \t]+/ {
 for(i=1;i<=NF;i++) if($i==token || $i=="\042" token "\042" || $i=="\047" token "\047") found=1
 if($0 ~ /(^|[ \t])(-Xm[sx]|-XX:(Max|Initial|Min)RAM(Percentage|Fraction|Size)=|-XX:(MaxHeapSize|InitialHeapSize)=)/) conflict=1
}
END {exit !(found && !conflict)}`
		launch += "awk -v token=" + javaShellQuote("@"+file) + " " + javaShellQuote(check) + " " + javaShellQuote(script[1]) + " || { echo 'The startup script must invoke java with @" + file + " and keep heap options in that file.' >&2; exit 64; }\n"
	}
	launch += "f=" + javaShellQuote(file) + "\n[ ! -L \"$f\" ] || { echo 'Java args file cannot be a symlink.' >&2; exit 64; }\nt=$(mktemp \"${f}.voltra.XXXXXX\")\ntrap 'rm -f \"$t\"' EXIT\n"
	launch += "if [ -f \"$f\" ]; then awk " + javaShellQuote(javaArgfileCleaner) + " \"$f\" > \"$t\"; fi\n"
	launch += "printf '%s\\n%s\\n%s\\n' '# BEGIN VOLTRA JAVA MEMORY' " + javaShellQuote(flags) + " '# END VOLTRA JAVA MEMORY' >> \"$t\"\nmv -- \"$t\" \"$f\"\ntrap - EXIT\nexec " + clean
	// Yolks' eval echo removes the backslashes, then exec env splits STARTUP.
	// The resulting bash -c argument contains no whitespace, and expands only
	// inside bash. Custom catalog images must follow Yolks' STARTUP contract.
	return javaLauncher(launch)
}

func (a *App) javaPrepare(ctx context.Context, egg, server M) (M, error) {
	config := M{}
	if v, ok := server["java_config"]; ok && v != nil {
		var err error
		config, err = javaNormalize(v, false)
		if err != nil {
			return nil, err
		}
	}
	effective, err := a.javaResolve(ctx, egg, config, num(server["memory"]))
	if err != nil {
		return nil, err
	}
	server["java_config"] = config
	if len(effective) > 0 {
		server["image"] = effective["image"]
	}
	_, _, err = javaInvocation(egg, server, effective)
	return effective, err
}
