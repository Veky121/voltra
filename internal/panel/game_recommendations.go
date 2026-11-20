package panel

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed game_library/recommended.json
var gameRecommendationsJSON []byte

type gameRecommendation struct {
	Memory     int64                         `json:"memory"`
	Disk       int64                         `json:"disk"`
	Players    *int                          `json:"players"`
	Confidence string                        `json:"confidence"`
	Source     string                        `json:"source"`
	Note       string                        `json:"note"`
	Agreements []gameRecommendationAgreement `json:"agreements"`
}

type gameRecommendationAgreement struct {
	Environment string `json:"environment"`
	Title       string `json:"title"`
	URL         string `json:"url"`
}

type gameAcceptanceLink struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// One variable can cover several documents (Bedrock: EULA and Usage
// Guidelines); the toggle names and links each of them.
type gameAcceptance struct {
	gameRecommendationAgreement
	Links       []gameAcceptanceLink `json:"links"`
	AcceptValue string               `json:"accept_value"`
}

var gameRecommendations = loadGameRecommendations()

func loadGameRecommendations() (catalog struct {
	Templates map[string]gameRecommendation `json:"templates"`
	Steam     map[string]gameRecommendation `json:"steam"`
}) {
	if err := json.Unmarshal(gameRecommendationsJSON, &catalog); err != nil {
		panic("invalid game recommendations: " + err.Error())
	}
	return catalog
}

func (rec gameRecommendation) options() M {
	return M{"memory": rec.Memory, "disk": rec.Disk, "players": rec.Players, "confidence": rec.Confidence, "source": rec.Source, "note": rec.Note}
}

// Variants of a managed game (palworld-native, palworld-proton) share the
// base game's researched recommendation.
func addSteamRecommendation(out M, gameID string) {
	rec, ok := gameRecommendations.Steam[gameID]
	if !ok {
		if base, _, found := strings.Cut(gameID, "-"); found {
			rec, ok = gameRecommendations.Steam[base]
		}
	}
	if ok {
		out["recommendation"] = rec.options()
	}
}

func addTemplateRecommendations(out M, entry gameTemplate, variables []M, rec gameRecommendation) {
	if rec.Confidence != "" && rec.Confidence != "none" {
		out["defaults"] = M{"memory": rec.Memory, "disk": rec.Disk}
		out["recommendation"] = rec.options()
	}
	out["acceptances"] = templateAcceptances(entry.Agreements, variables, rec.Agreements)
}

var gameAgreementFallbacks = map[string]struct{ title, url string }{
	"EULA_ACCEPTED":                   {"Minecraft EULA", "https://www.minecraft.net/eula"},
	"BEDROCK_TERMS_ACCEPTED":          {"Minecraft EULA and Usage Guidelines", "https://www.minecraft.net/usage-guidelines"},
	"PNX_LICENSE_ACCEPTED":            {"PowerNukkitX licence (LGPLv3)", "https://www.gnu.org/licenses/lgpl-3.0.html"},
	"SCPSL_ACCEPT_EULA":               {"SCP: Secret Laboratory EULA", "https://link.scpslgame.com/eula"},
	"REFORGER_ACCEPT_BATTLEYE":        {"BattlEye EULA", "https://www.battleye.com/downloads/EULA.txt"},
	"POT_HOSTING_AGREEMENT":           {"Path of Titans Server Hosting Agreement", "https://alderongames.com/legal/server-hosting-agreement"},
	"HYTALE_ACCEPT_EARLY_PLUGINS":     {"Hytale early plugin terms", "https://support.hytale.com/hc/en-us/articles/45326769420827-Hytale-Server-Manual"},
	"ACCEPT_WINDOWS_RUNTIME_LICENSES": {"Windows runtime licences", "https://visualstudio.microsoft.com/license-terms/"},
	// ACKNOWLEDGE_LEGACY_PREREQUISITES is shared by several recipes; each one
	// names and links its own project in recommended.json.
}

func templateAcceptances(structured []templateAgreement, variables []M, recommended []gameRecommendationAgreement) []gameAcceptance {
	seen := make(map[string]bool)
	for _, agreement := range structured {
		seen[agreement.Environment] = true
	}
	metadata := make(map[string][]gameRecommendationAgreement, len(recommended))
	for _, agreement := range recommended {
		metadata[agreement.Environment] = append(metadata[agreement.Environment], agreement)
	}
	acceptances := []gameAcceptance{}
	for _, variable := range variables {
		env := str(variable["env_variable"])
		if seen[env] || env == "FIVEM_LICENSE" || env == "CFX_LICENSE" {
			continue
		}
		documents := metadata[env]
		if len(documents) == 0 {
			fallback, found := gameAgreementFallbacks[env]
			if !found {
				continue
			}
			documents = []gameRecommendationAgreement{{Environment: env, Title: fallback.title, URL: fallback.url}}
		}
		titles := make([]string, 0, len(documents))
		links := make([]gameAcceptanceLink, 0, len(documents))
		for _, document := range documents {
			titles = append(titles, document.Title)
			links = append(links, gameAcceptanceLink{Title: document.Title, URL: document.URL})
		}
		agreement := gameRecommendationAgreement{Environment: env, Title: joinTitles(titles), URL: documents[0].URL}
		if value := templateAcceptValue(str(variable["rules"]), str(variable["default_value"])); value != "" {
			acceptances = append(acceptances, gameAcceptance{gameRecommendationAgreement: agreement, Links: links, AcceptValue: value})
			seen[env] = true
		}
	}
	return acceptances
}

func templateAcceptValue(rawRules, defaultValue string) string {
	rules, err := splitEggRules(rawRules)
	if err != nil {
		return ""
	}
	for _, rule := range rules {
		if rule.name != "in" {
			continue
		}
		var candidates []string
		for _, value := range eggRuleParams(rule.params) {
			switch strings.ToLower(value) {
			case "", "0", "false", "no", "off", "decline", "declined", "reject", "rejected":
				continue
			}
			candidates = append(candidates, value)
		}
		if len(candidates) == 1 {
			return candidates[0]
		}
		for _, value := range candidates {
			switch strings.ToLower(value) {
			case "1", "true", "yes", "on", "accept", "accepted", "agree", "agreed":
				return value
			}
		}
		return ""
	}
	if eggHasRule(rules, "boolean") {
		if defaultValue == "true" || defaultValue == "false" {
			return "true"
		}
		return "1"
	}
	return ""
}

// joinTitles reads "A", "A and B" or "A, B and C".
func joinTitles(titles []string) string {
	if len(titles) < 2 {
		return strings.Join(titles, "")
	}
	return strings.Join(titles[:len(titles)-1], ", ") + " and " + titles[len(titles)-1]
}
