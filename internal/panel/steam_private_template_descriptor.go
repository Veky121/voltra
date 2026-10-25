package panel

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"voltra/internal/steamapi"
)

type privateTemplateDescriptor struct {
	Path           string
	App            uint32
	Command        string
	DefaultPrivate bool
	Reviewed       bool
}

// Candidates describe an implementable preparation path, not app-policy grants.
// KF2 remains unreviewed until mutable publication and its worker policy are approved.
var privateTemplateDescriptors = []privateTemplateDescriptor{
	{"banana_shooter/egg-banana-shooter.json", 2406780, "python3 .voltra/light_games_next_install.py banana", true, true},
	{"killing_floor_2/egg-killing-floor2.json", 232130, "python3 .voltra/session_servers_install.py kf2", false, false},
}

func privateTemplateDescriptorFor(entry gameTemplate) (privateTemplateDescriptor, bool) {
	for _, d := range privateTemplateDescriptors {
		if d.Path == entry.Path {
			return d, true
		}
	}
	return privateTemplateDescriptor{}, false
}

func templateSteamRole(key string) string {
	switch strings.ToUpper(key) {
	case "STEAM_USER", "STEAM_USERNAME":
		return "username"
	case "STEAM_PASS", "STEAM_PASSWORD":
		return "password"
	case "STEAM_AUTH", "STEAM_GUARDCODE":
		return "guard"
	case "SRCDS_BETAID":
		return "branch"
	case "SRCDS_BETAPASS":
		return "beta_password"
	}
	return ""
}

func templateSteamControls(entry gameTemplate) M {
	controls := M{}
	for _, value := range asSlice(entry.Egg["variables"]) {
		v := asMap(value)
		role := templateSteamRole(str(v["env_variable"]))
		if role == "" {
			continue
		}
		fields := asSlice(controls[role])
		controls[role] = append(fields, M{"environment": v["env_variable"], "label": v["name"], "rules": v["rules"]})
	}
	return controls
}

func templateSteamMetadata(entry gameTemplate) M {
	controls := templateSteamControls(entry)
	if len(controls) == 0 {
		return nil
	}
	d, candidate := privateTemplateDescriptorFor(entry)
	supported := privateTemplateApp(entry) != 0
	reason := ""
	if !supported {
		reason = "Private Steam installation for this recipe is pending reviewed worker and publication policy support. Use anonymous installation only where the publisher supports it."
	}
	mode := "public"
	if supported && d.DefaultPrivate {
		mode = "private"
	}
	out := M{"default_mode": mode, "private_candidate": candidate, "private_supported": supported, "private_reason": reason, "controls": controls, "coverage": map[bool]string{true: "reviewed", false: "pending"}[supported]}
	if entry.Path == "holdfast/egg-holdfast-na-w.json" {
		out["legacy_branch_field"] = "EXTRA_FLAGS"
	}
	return out
}

// Reject rather than silently strip: these inputs must never reach the ordinary
// request digest, server_variables, integrations, or an anonymous installer.
func guardTemplateSteamEnvironment(env M, entries ...gameTemplate) error {
	if value, ok := env["INSTALL_FLAGS"]; ok && value != "" {
		return bad("Raw Steam installation flags are unsupported. Use typed Steam branch settings or Steam maintenance.")
	}
	if len(entries) > 0 {
		if err := guardTemplateSteamLegacy(entries[0], env); err != nil {
			return err
		}
	}
	for key, value := range env {
		role := templateSteamRole(key)
		if role == "" || role == "branch" {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return bad("Use Steam maintenance for account credentials, Guard responses and private branch passwords.")
		}
		if text == "" || role == "username" && text == "anonymous" {
			continue
		}
		return bad("Supply Steam account credentials, Guard responses and private branch passwords through Steam maintenance after preparation, not ordinary game settings.")
	}
	return nil
}

// Resolve original rules only through the same exact recipe/startup/image binding
// as private app selection. User variables never grant a policy or alter rules.
func privateServerTemplate(ctx context.Context, q steamHistoryQuerier, server M) (gameTemplate, bool, error) {
	egg, err := queryRowMap(q.QueryRow(ctx, "SELECT row_to_json(e) FROM eggs e WHERE id=$1", server["egg_id"]))
	if err != nil {
		return gameTemplate{}, false, err
	}
	for _, entry := range gameTemplates().Entries {
		if str(server["startup"]) != str(entry.Egg["startup"]) {
			continue
		}
		if str(egg["uuid"]) != gameTemplateEggUUID(entry) && str(egg["uuid"]) != gameTemplateEggUUID(privatePreparationIdentity(entry)) {
			continue
		}
		for _, image := range asMap(entry.Egg["docker_images"]) {
			if str(server["image"]) == str(image) {
				return entry, true, nil
			}
		}
	}
	return gameTemplate{}, false, nil
}

func privateServerSteamControls(ctx context.Context, q steamHistoryQuerier, server M) (M, error) {
	entry, ok, err := privateServerTemplate(ctx, q, server)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil || !ok {
		return nil, err
	}
	return templateSteamControls(entry), nil
}

func validatePrivateOriginal(controls M, role, value string) error {
	for _, field := range asSlice(controls[role]) {
		v := asMap(field)
		key := str(v["environment"])
		if validateEggValue(value, true, str(v["rules"]), M{"environment": M{key: value}}, "environment."+key) != nil {
			return bad("The private Steam input does not match this recipe's original " + role + " rules.")
		}
	}
	return nil
}

func privateTemplatePolicy(entry gameTemplate) (steamapi.PrivateAppProfile, bool) {
	d, ok := privateTemplateDescriptorFor(entry)
	if !ok || !d.Reviewed {
		return steamapi.PrivateAppProfile{}, false
	}
	return steamapi.PrivateProfile(d.App)
}

// Match the current Holdfast shlex-only contract. This never evaluates shell
// substitutions and never converts an embedded password into ordinary settings.
func splitSteamLegacyFlags(value string) ([]string, error) {
	var tokens []string
	var token []rune
	var quote rune
	active := false
	runes := []rune(value)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if c == '\\' && quote != '\'' {
			if i+1 == len(runes) {
				return nil, bad("Invalid typed Steam branch flags.")
			}
			i++
			next := runes[i]
			if quote == '"' && next != '"' && next != '\\' {
				token = append(token, '\\')
			}
			token = append(token, next)
			active = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				token = append(token, c)
			}
			active = true
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			active = true
			continue
		}
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			if active {
				tokens = append(tokens, string(token))
				token = nil
				active = false
			}
			continue
		}
		token = append(token, c)
		active = true
	}
	if quote != 0 {
		return nil, bad("Invalid typed Steam branch flags.")
	}
	if active {
		tokens = append(tokens, string(token))
	}
	return tokens, nil
}

func guardTemplateSteamLegacy(entry gameTemplate, env M) error {
	if entry.Path != "holdfast/egg-holdfast-na-w.json" {
		return nil
	}
	value, present := env["EXTRA_FLAGS"]
	if !present {
		return nil
	}
	raw, ok := value.(string)
	if !ok {
		return bad("Enter typed public Steam branch flags or use Steam maintenance.")
	}
	if raw == "" {
		return nil
	}
	tokens, err := splitSteamLegacyFlags(raw)
	if err != nil {
		return err
	}
	if len(tokens) == 0 {
		return nil
	}
	if (len(tokens) != 2 && len(tokens) != 4) || tokens[0] != "-beta" || len(tokens) == 4 && tokens[2] != "-betapassword" {
		return bad("Use typed public Steam branch flags; account or private branch inputs belong in Steam maintenance.")
	}
	if len(tokens) == 4 {
		return bad("Supply private branch passwords through Steam maintenance after reviewed preparation, not ordinary game settings.")
	}
	return nil
}
