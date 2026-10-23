package panel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

const minecraftRuntimeRulesKey = "minecraft.runtime_rules"

var minecraftRuntimeRuleID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)

func (a *App) registerMinecraftRuntimeRules(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/minecraft/runtime-rules", a.minecraftRuntimeRulesHandler)
	mux.HandleFunc("PUT /api/admin/minecraft/runtime-rules", a.minecraftRuntimeRulesHandler)
}

func validateMinecraftRuntimeRules(input any) ([]M, error) {
	values, ok := input.([]any)
	if !ok || len(values) > 200 {
		return nil, bad("Provide an array of up to 200 Minecraft runtime rules.")
	}
	rules := make([]M, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		rule, ok := value.(map[string]any)
		if !ok {
			return nil, bad("Each runtime rule must be an object.")
		}
		id := str(rule["id"])
		if !minecraftRuntimeRuleID.MatchString(id) || seen[id] {
			return nil, bad("Runtime rules need unique IDs containing letters, digits, dots, dashes or underscores.")
		}
		seen[id] = true
		out := M{"id": id, "enabled": true}
		for _, key := range []string{"name", "provider", "project_id", "project_version", "loader", "game_version", "required_distribution", "jvm_args"} {
			if rule[key] != nil {
				if _, ok := rule[key].(string); !ok {
					return nil, bad("Runtime rule text fields must be strings.")
				}
			}
			out[key] = strings.TrimSpace(str(rule[key]))
		}
		if str(out["name"]) == "" || len(str(out["name"])) > 191 {
			return nil, bad("Give each runtime rule a name of up to 191 characters.")
		}
		if enabled, exists := rule["enabled"]; exists {
			if _, ok := enabled.(bool); !ok {
				return nil, bad("Rule enabled must be a boolean.")
			}
			out["enabled"] = enabled
		}
		provider := str(out["provider"])
		if provider != "" && provider != "modrinth" && provider != "curseforge" {
			return nil, bad("Select Modrinth, CurseForge or any provider for the rule.")
		}
		if str(out["project_id"]) != "" && provider == "" || str(out["project_version"]) != "" && str(out["project_id"]) == "" {
			return nil, bad("A project needs a provider, and a pack version needs a project ID.")
		}
		loader := str(out["loader"])
		if loader != "" && !map[string]bool{"vanilla": true, "paper": true, "fabric": true, "forge": true, "neoforge": true, "quilt": true}[loader] {
			return nil, bad("Select a supported Minecraft loader for the rule.")
		}
		for _, key := range []string{"project_id", "project_version", "game_version", "required_distribution"} {
			if len(str(out[key])) > 191 || strings.ContainsAny(str(out[key]), "\x00\r\n") {
				return nil, bad("Runtime rule identifiers must be single lines of up to 191 characters.")
			}
		}
		for _, spec := range []struct {
			key     string
			maximum int64
		}{{"required_major", 999}, {"min_memory_mib", 1048576}} {
			n := int64(0)
			if rule[spec.key] != nil {
				var err error
				n, err = javaInteger(rule[spec.key], spec.key, 0, spec.maximum)
				if err != nil {
					return nil, err
				}
			}
			out[spec.key] = n
		}
		args := str(out["jvm_args"])
		if len(args) > 4096 || strings.ContainsAny(args, "\x00\r\n;&|`$") {
			return nil, bad("Runtime rule JVM arguments must be one line without shell operators.")
		}
		if err := javaValidateFlags(args); err != nil {
			return nil, err
		}
		rules = append(rules, out)
	}
	return rules, nil
}

func (a *App) minecraftRuntimeRules(ctx context.Context) ([]M, error) {
	row, err := a.one(ctx, "SELECT value FROM settings WHERE key=$1", minecraftRuntimeRulesKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return []M{}, nil
	}
	if err != nil {
		return nil, err
	}
	return validateMinecraftRuntimeRules(row["value"])
}

func (a *App) minecraftRuntimeRulesHandler(w http.ResponseWriter, r *http.Request) {
	user, err := a.requireAdmin(r)
	if err != nil {
		fail(w, err)
		return
	}
	if r.Method == http.MethodPut {
		input, err := decode(r)
		if err != nil {
			fail(w, err)
			return
		}
		rules, err := validateMinecraftRuntimeRules(input["rules"])
		if err != nil {
			fail(w, err)
			return
		}
		if err = a.exec(r.Context(), "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", minecraftRuntimeRulesKey, rules); err != nil {
			fail(w, err)
			return
		}
		_ = a.audit(r.Context(), num(user["id"]), 0, "admin:minecraft.runtime-rules.update", M{"count": len(rules)})
	}
	rules, err := a.minecraftRuntimeRules(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("minecraft_runtime_rules", M{"rules": rules}))
}

// Rules supplement provider metadata for packs whose authors require a specific
// runtime. They affect new installations; an existing server keeps its settings.
func (a *App) applyMinecraftRuntimeRules(ctx context.Context, provider, projectID, packVersion, loader, gameVersion string, config M, memory int64) (M, error) {
	rules, err := a.minecraftRuntimeRules(ctx)
	if err != nil {
		return nil, err
	}
	result := M{}
	for key, value := range config {
		result[key] = value
	}
	matched := []string{}
	args := []string{}
	for _, rule := range rules {
		if !boolean(rule["enabled"]) {
			continue
		}
		matches := true
		for key, actual := range map[string]string{"provider": provider, "project_id": projectID, "project_version": packVersion, "loader": loader, "game_version": gameVersion} {
			if expected := str(rule[key]); expected != "" && expected != actual {
				matches = false
				break
			}
		}
		if !matches {
			continue
		}
		if memory < num(rule["min_memory_mib"]) {
			return nil, bad(fmt.Sprintf("%s requires at least %d MiB of server memory.", str(rule["name"]), num(rule["min_memory_mib"])))
		}
		if major := num(rule["required_major"]); major > num(result["required_major"]) {
			result["required_major"] = major
		}
		if distribution := str(rule["required_distribution"]); distribution != "" {
			if prior := str(result["required_distribution"]); prior != "" && prior != distribution {
				return nil, bad("Matching Minecraft runtime rules require conflicting Java distributions. Update the rules in Admin.")
			}
			result["required_distribution"] = distribution
		}
		if flags := str(rule["jvm_args"]); flags != "" {
			args = append(args, flags)
		}
		matched = append(matched, str(rule["id"]))
	}
	if len(matched) > 0 {
		if flags := str(result["extra_args"]); flags != "" {
			args = append(args, flags)
		}
		result["extra_args"] = strings.Join(args, " ")
	}
	return result, nil
}
