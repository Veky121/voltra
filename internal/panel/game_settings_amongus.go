package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"gopkg.in/yaml.v3"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

func among165Recipe(egg M) string {
	for _, recipe := range []string{"among_us/bettercrewlink_server/egg-better-crewlink-server.json", "among_us/impostor_server/egg-among-us--impostor-server.json"} {
		if nativeSettingsIsRecipe(egg, recipe) {
			return recipe
		}
	}
	return ""
}

// Source adapter admission only. Exact helper bytes do not attest game binaries.
// Called by shared discovery, locked refresh and final publication refresh.
func (a *App) prepareAmong165Authority(ctx context.Context, s, egg M) error {
	recipe := among165Recipe(egg)
	entry, ok := gameSettingsProfile(egg)
	if !ok || recipe == "" {
		return notFound()
	}
	startup := str(entry.Egg["startup"])
	if str(s["startup"]) != startup || str(egg["startup"]) != startup {
		return notFound()
	}
	actualMapping, _ := json.Marshal(egg["config_files"])
	var mappings map[string]json.RawMessage
	if json.Unmarshal(actualMapping, &mappings) != nil || mappings == nil || len(mappings) != 0 {
		return notFound()
	}
	config, err := a.serverConfig(ctx, s)
	if err != nil {
		return err
	}
	env := asMap(config["environment"])
	for _, key := range []string{"PYTHONPATH", "PYTHONHOME", "LD_PRELOAD", "LD_LIBRARY_PATH", "EXTRA_ARGS", "ADDITIONAL_ARGS", "SERVER_ARGS", "STARTUP_ARGS", "OTHER_ARGS", "VOLTRA_SERVER_ROOT"} {
		if str(env[key]) != "" {
			return notFound()
		}
	}
	files := map[string][]byte{}
	script := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok || !strings.HasPrefix(name, ".voltra/") {
			continue
		}
		marker = strings.TrimSuffix(marker, "'")
		expected, _, ok := strings.Cut(body, "\n"+marker+"\n")
		if !ok {
			return notFound()
		}
		data, exists, e := a.quickSetupRead(ctx, s, "/"+name)
		if e != nil {
			return e
		}
		if !exists || string(data) != expected+"\n" {
			return notFound()
		}
		files[name] = data
	}
	if len(files) == 0 {
		return notFound()
	}
	allocations, err := a.query(ctx, "SELECT id,port FROM allocations WHERE server_id=$1 ORDER BY id", s["id"])
	if err != nil {
		return err
	}
	path := "/crewlink/config/peerConfig.yml"
	if strings.Contains(recipe, "impostor_server") {
		path = "/impostor/config.json"
	}
	binding, _ := json.Marshal(M{"startup": startup, "environment": env, "helpers": files, "path": path, "allocations": allocations, "primary": s["allocation_id"], "mapping": egg["config_files"]})
	egg["_among_effective_environment"] = env
	egg["_campaign_parser_path"] = path
	egg["_campaign_parser_binding"] = settingsAuthorityHash(binding)
	return nil
}

// The finite editor uses original byte spans; unknown fields remain Files-only.
func among165Editable(file, key string) bool {
	if file == "/impostor/config.json" {
		return key == "/Server/PublicIp" || key == "/Server/PublicPort"
	}
	switch key {
	case "/forceRelayOnly", "/integratedRelay/debugLevel", "/integratedRelay/defaultUsername", "/integratedRelay/defaultPassword":
		return true
	}
	return false
}

// Span offsets are bytes; yaml.v3 columns count Unicode code points.
func among168YAMLSpan(data []byte, n *yaml.Node) (bananaJSONSpan, bool) {
	if n == nil || n.Kind != yaml.ScalarNode || n.Anchor != "" || n.Style&(yaml.TaggedStyle|yaml.LiteralStyle|yaml.FoldedStyle) != 0 {
		return bananaJSONSpan{}, false
	}
	lines := bytes.SplitAfter(data, []byte("\n"))
	if n.Line < 1 || n.Line > len(lines) {
		return bananaJSONSpan{}, false
	}
	start := 0
	for _, line := range lines[:n.Line-1] {
		start += len(line)
	}
	column := n.Column - 1
	line := lines[n.Line-1]
	for column > 0 && len(line) > 0 {
		_, size := utf8.DecodeRune(line)
		start += size
		line = line[size:]
		column--
	}
	if column != 0 || start >= len(data) {
		return bananaJSONSpan{}, false
	}
	end := start
	if data[start] == '\'' || data[start] == '"' {
		quote := data[start]
		end++
		for end < len(data) && data[end] != '\r' && data[end] != '\n' {
			if data[end] == quote {
				if quote == '\'' && end+1 < len(data) && data[end+1] == quote {
					end += 2
					continue
				}
				return bananaJSONSpan{start: start, end: end + 1}, true
			}
			if data[end] == '\\' && quote == '"' {
				end++
				if end >= len(data) || data[end] == '\r' || data[end] == '\n' {
					return bananaJSONSpan{}, false
				}
			}
			end++
		}
		return bananaJSONSpan{}, false
	}
	for end < len(data) && data[end] != '\r' && data[end] != '\n' {
		if data[end] == '#' && (end == start || data[end-1] == ' ' || data[end-1] == '\t') {
			break
		}
		end++
	}
	for end > start && (data[end-1] == ' ' || data[end-1] == '\t') {
		end--
	}
	return bananaJSONSpan{start: start, end: end}, end > start
}
func parseAmong165(file string, data []byte, seeds ...M) (gameSettingsParsed, error) {
	raw := data
	offset := 0
	if bytes.HasPrefix(raw, []byte{239, 187, 191}) {
		raw = raw[3:]
		offset = 3
	}
	out, e := parseGameSettings(file, raw)
	if e != nil {
		return out, e
	}
	spans := map[string]bananaJSONSpan{}
	fields := map[string]gameSetting{}
	if strings.HasSuffix(file, ".json") {
		spans, e = bananaJSONSpans(raw)
		if e != nil {
			return out, e
		}
	} else {
		for _, f := range out.fields {
			if span, ok := among168YAMLSpan(raw, f.node); ok {
				spans[f.key] = span
			}
		}
	}
	for i := range out.fields {
		f := &out.fields[i]
		_, spanOK := spans[f.key]
		supported := among165Editable(file, f.key) && spanOK && f.node != nil
		if supported {
			switch f.key {
			case "/forceRelayOnly":
				supported = f.node.Tag == "!!bool"
			case "/Server/PublicPort":
				supported = f.node.Tag == "!!int"
			default:
				supported = f.node.Tag == "!!str"
			}
		}
		if !supported {
			f.kind = "readonly"
			delete(spans, f.key)
		}
		fields[f.key] = *f
	}
	out.patch = func(changes map[string]string) ([]byte, error) {
		type edit struct {
			start, end int
			value      string
		}
		edits := []edit{}
		for key, value := range changes {
			span, ok := spans[key]
			if !ok || fields[key].kind == "readonly" {
				return nil, bad("Use Files for this setting.")
			}
			for _, r := range value {
				if r < 32 || r == 127 {
					return nil, bad("Invalid scalar.")
				}
			}
			encoded := value
			switch key {
			case "/Server/PublicIp":
				if !regexp.MustCompile(`^[A-Za-z0-9._:-]+$`).MatchString(value) {
					return nil, bad("Invalid advertised address.")
				}
				b, _ := json.Marshal(value)
				encoded = string(b)
			case "/Server/PublicPort":
				n, e := strconv.Atoi(value)
				if e != nil || n < 1 || n > 65535 {
					return nil, bad("Invalid advertised port.")
				}
				encoded = strconv.Itoa(n)
			case "/forceRelayOnly":
				if value != "true" && value != "false" {
					return nil, bad("Invalid relay boolean.")
				}
			default:
				encoded = strconv.Quote(value)
			}
			edits = append(edits, edit{span.start + offset, span.end + offset, encoded})
		}
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		result := append([]byte(nil), data...)
		for _, edit := range edits {
			result = append(append(append([]byte(nil), result[:edit.start]...), []byte(edit.value)...), result[edit.end:]...)
		}
		checked := result[offset:]
		if _, e := parseGameSettings(file, checked); e != nil {
			return nil, bad("Invalid resulting configuration.")
		}
		if file == "/impostor/config.json" {
			if e := validateAmong172Impostor(checked, seeds...); e != nil {
				return nil, e
			}
		}
		return result, nil
	}
	return out, nil
}

// Match the retained adapter's conservative .NET alias refusals and effective
// advertised values. This does not attest publisher provider precedence.
func validateAmong172Impostor(data []byte, seeds ...M) error {
	var document map[string]any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if decoder.Decode(&document) != nil || document == nil {
		return bad("Invalid Impostor document.")
	}
	env := M{}
	if len(seeds) > 0 && seeds[0] != nil {
		env = seeds[0]
	}
	for key := range document {
		lower := strings.ToLower(key)
		if strings.Contains(key, ":") || ((lower == "server" || lower == "httpserver") && key != "Server" && key != "HttpServer") {
			return bad("Ambiguous Impostor alias.")
		}
	}
	for _, section := range []string{"Server", "HttpServer"} {
		fields := map[string]bool{"ListenIp": true, "ListenPort": true}
		if section == "Server" {
			fields["PublicIp"] = true
			fields["PublicPort"] = true
		}
		raw, exists := document[section]
		if !exists {
			continue
		}
		values, ok := raw.(map[string]any)
		if !ok {
			return bad("Invalid Impostor section.")
		}
		for key := range values {
			if strings.Contains(key, ":") {
				return bad("Ambiguous Impostor alias.")
			}
			for managed := range fields {
				if strings.EqualFold(key, managed) && key != managed {
					return bad("Ambiguous Impostor alias.")
				}
			}
		}
	}
	server, _ := document["Server"].(map[string]any)
	ip, present := server["PublicIp"]
	if !present {
		ip = "127.0.0.1"
		if value, ok := env["PUBLIC_IP"]; ok {
			ip = value
		}
		s, ok := ip.(string)
		if !ok || len(s) > 250 {
			return bad("Invalid advertised address seed.")
		}
	}
	address, ok := ip.(string)
	if !ok || !regexp.MustCompile(`^[A-Za-z0-9._:-]+$`).MatchString(address) {
		return bad("Invalid effective advertised address.")
	}
	port, present := server["PublicPort"]
	if present {
		number, ok := port.(json.Number)
		if !ok {
			return bad("Invalid effective advertised port.")
		}
		n, e := number.Int64()
		if e != nil || n < 1 || n > 65535 {
			return bad("Invalid effective advertised port.")
		}
	} else {
		value := "22023"
		if v, ok := env["SERVER_PORT"]; ok {
			value = str(v)
		}
		if v := str(env["PUBLIC_PORT"]); v != "" {
			value = v
		}
		if !regexp.MustCompile(`^[0-9]{1,5}$`).MatchString(value) {
			return bad("Invalid advertised port seed.")
		}
		n, e := strconv.Atoi(value)
		if e != nil || n < 1 || n > 65535 {
			return bad("Invalid advertised port seed.")
		}
	}
	return nil
}
