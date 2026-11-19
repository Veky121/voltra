package panel

import (
	"net/http"
	"sync"
)

// The Game Library front page needs every game at once. Recipes and guided
// Steam setups are shipped with the binary, so the page reads one response
// holding both lists instead of merging two that arrive at different times.
//
// Summarising a recipe parses its egg. That work and the encoding are done
// once; later requests are answered from memory or with a 304.
type gameCatalogResponseSet struct {
	catalog   [2]revalidatedJSON // member, administrator
	templates [2]revalidatedJSON
}

// gameCatalogSource identifies what the cached responses were built from. Both
// lists are fixed in a running panel; tests replace them.
type gameCatalogSource struct {
	revision  string
	templates int
	steam     int
	// The first guided game's address changes when the list is replaced, even
	// by a copy of the same length.
	firstSteam *steamGameSpec
}

var gameCatalogCache struct {
	sync.Mutex
	ready     bool
	source    gameCatalogSource
	responses gameCatalogResponseSet
}

func catalogAudience(user M) int {
	if boolean(user["root_admin"]) {
		return 1
	}
	return 0
}

// libraryCardFields are the summary fields the library grid reads. Setup
// metadata stays on the setup endpoints, which keeps this response small.
var libraryCardFields = []string{"id", "name", "description", "category", "source", "available", "detail", "verification", "managed_game"}

func gameCatalogResponses() (gameCatalogResponseSet, error) {
	shipped := gameTemplates()
	cache := &gameCatalogCache
	cache.Lock()
	defer cache.Unlock()
	source := gameCatalogSource{revision: shipped.Revision, templates: len(shipped.Entries), steam: len(steamGameSpecs)}
	if len(steamGameSpecs) > 0 {
		source.firstSteam = &steamGameSpecs[0]
	}
	if cache.ready && cache.source == source {
		return cache.responses, nil
	}
	summaries := make([]M, 0, len(shipped.Entries))
	cards := make([]M, 0, len(shipped.Entries))
	for _, entry := range shipped.Entries {
		summary := templateSummary(entry)
		summaries = append(summaries, summary)
		card := M{}
		for _, field := range libraryCardFields {
			if value, ok := summary[field]; ok {
				card[field] = value
			}
		}
		cards = append(cards, card)
	}
	steam := make([]M, 0, len(steamGameSpecs))
	for _, spec := range steamGameSpecs {
		steam = append(steam, M{"id": spec.ID, "name": spec.Name, "description": spec.Description})
	}
	var responses gameCatalogResponseSet
	for audience, canInstall := range []bool{false, true} {
		var err error
		if responses.catalog[audience], err = newRevalidatedJSON(item("game_catalog", M{"revision": shipped.Revision, "can_install": canInstall, "templates": cards, "steam": steam})); err != nil {
			return gameCatalogResponseSet{}, err
		}
		if responses.templates[audience], err = newRevalidatedJSON(item("game_templates", M{"games": summaries, "revision": shipped.Revision, "can_install": canInstall})); err != nil {
			return gameCatalogResponseSet{}, err
		}
	}
	cache.ready, cache.source, cache.responses = true, source, responses
	return responses, nil
}

func (a *App) gameCatalog(w http.ResponseWriter, r *http.Request) {
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	responses, err := gameCatalogResponses()
	if err != nil {
		fail(w, err)
		return
	}
	responses.catalog[catalogAudience(user)].write(w, r)
}
