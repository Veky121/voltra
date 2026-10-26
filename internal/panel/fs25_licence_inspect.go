package panel

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

type fs25LicenceProduct struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

var fs25PortalCDN = regexp.MustCompile(`^cdn[0-9]*\.giants-software\.com$`)

func fs25PortalProducts(body string) []fs25LicenceProduct {
	root, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return nil
	}
	attr := func(node *html.Node, key string) string {
		for _, a := range node.Attr {
			if a.Key == key {
				return a.Val
			}
		}
		return ""
	}
	var text func(*html.Node) string
	text = func(n *html.Node) string {
		if n.Type == html.TextNode {
			return n.Data
		}
		var result string
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			result += text(c)
		}
		return result
	}
	result := []fs25LicenceProduct{}
	seen := map[string]bool{}
	heading := ""
	family := ""
	generic := regexp.MustCompile(`(?i)^(downloads?|bonus content|your downloads|thank you.*)$`)
	add := func(kind string) {
		name := strings.Join(strings.Fields(heading), " ")
		if name == "" {
			return
		}
		if !strings.Contains(strings.ToLower(family+" "+name), "farming simulator 25") {
			return
		}
		key := kind + ":" + name
		if !seen[key] && len(result) < 32 {
			seen[key] = true
			result = append(result, fs25LicenceProduct{Name: name, Kind: kind})
		}
	}
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if len(n.Data) == 2 && n.Data[0] == 'h' && n.Data[1] >= '1' && n.Data[1] <= '6' {
				title := strings.Join(strings.Fields(text(n)), " ")
				if n.Data == "h1" {
					family = title
				}
				if !generic.MatchString(title) {
					heading = title
					if strings.HasPrefix(strings.ToLower(title), "farming simulator 25:") {
						add("dlc")
					}
				}
			}
			if n.Data == "form" && strings.EqualFold(attr(n, "method"), "post") {
				action, e := url.Parse(attr(n, "action"))
				if e == nil && action.Path == "/download.php" && (action.Host == "" || action.Host == "eshop.giants-software.com") && (action.Scheme == "" || action.Scheme == "https") && action.User == nil {
					var platforms map[string]struct {
						ID      json.RawMessage `json:"id"`
						Caption string          `json:"caption"`
					}
					if json.Unmarshal([]byte(attr(n, "data-default-downloads")), &platforms) == nil {
						caption := strings.ToUpper(platforms["windows"].Caption)
						if strings.HasPrefix(caption, "WINDOWS") {
							if strings.Contains(caption, "IMG") {
								add("game")
							} else if strings.Contains(caption, "EXE") {
								add("dlc")
							}
						}
					}
				}
			}
			if n.Data == "a" {
				u, e := url.Parse(attr(n, "href"))
				if e == nil && u.Scheme == "https" && fs25PortalCDN.MatchString(u.Hostname()) && u.User == nil && (u.Port() == "" || u.Port() == "443") && strings.HasPrefix(path.Base(u.Path), "FarmingSimulator25_") {
					if strings.HasSuffix(strings.ToLower(u.Path), ".exe") {
						add("dlc")
					} else if strings.HasSuffix(strings.ToLower(u.Path), ".img") {
						add("game")
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(root)
	return result
}

func (a *App) fs25InspectLicence(w http.ResponseWriter, r *http.Request) {
	if _, err := a.requireAdmin(r); err != nil {
		fail(w, err)
		return
	}
	input, err := decodeRaw(r)
	if err != nil {
		fail(w, err)
		return
	}
	key, ok := input["key"].(string)
	key = strings.TrimSpace(key)
	if input["integration_id"] != nil {
		if key != "" {
			fail(w, bad("Choose a saved licence or enter a key, not both."))
			return
		}
		id, valid := applicationInteger(input["integration_id"])
		if !valid || id <= 0 {
			fail(w, bad("Select a saved game licence."))
			return
		}
		record, e := a.one(r.Context(), "SELECT * FROM integrations WHERE id=$1 AND provider='game_license'", id)
		if e != nil {
			fail(w, notFound())
			return
		}
		credentials, e := a.integrationCredentials(record)
		if e != nil {
			fail(w, e)
			return
		}
		key = strings.TrimSpace(str(credentials["license_key"]))
		ok = true
	}
	if !ok || key == "" || len(key) > 128 {
		fail(w, bad("Enter a GIANTS product key of at most 128 characters."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", "https://eshop.giants-software.com/downloads.php", strings.NewReader(url.Values{"activationKey": {key}, "foobar": {"DOWNLOAD"}}.Encode()))
	if err != nil {
		fail(w, bad("Could not prepare the GIANTS lookup."))
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Voltra-FS25/1.0")
	client := http.Client{Timeout: 15 * time.Second}
	if a.HTTP != nil {
		client = *a.HTTP
	}
	client.Jar = nil
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		fail(w, &APIError{Status: 502, Code: "GIANTSLookupUnavailable", Detail: "GIANTS could not be reached. Retry the lookup later."})
		return
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if err != nil || len(body) > 4*1024*1024 || response.StatusCode != 200 {
		fail(w, bad("GIANTS did not return a supported download page. Check the key or retry later."))
		return
	}
	products := fs25PortalProducts(string(body))
	if len(products) == 0 {
		fail(w, bad("GIANTS offered no Windows FS25 downloads for this key. Check that it is a GIANTS product key, not a Steam code."))
		return
	}
	kind := "dlc"
	names := []string{}
	for i := range products {
		for _, variant := range []string{key, strings.ReplaceAll(strings.Join(strings.Fields(key), ""), "-", "")} {
			if variant != "" && strings.Contains(strings.ToUpper(products[i].Name), strings.ToUpper(variant)) {
				products[i].Name = "GIANTS product"
			}
		}
		names = append(names, products[i].Name)
		if products[i].Kind == "game" {
			kind = "game"
		}
	}
	name := strings.Join(names, ", ")
	if len(name) > 191 {
		if kind == "game" {
			name = "Farming Simulator 25 licence"
		} else {
			name = "Farming Simulator 25 DLC collection"
		}
	}
	entry := farmingSimulatorTemplate()
	egg, variables, e := parseEggDocument(entry.Egg)
	if e != nil {
		fail(w, e)
		return
	}
	imported, e := a.ensureGameTemplateEgg(r.Context(), entry, egg, variables)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, item("fs25_licence_inspection", M{"products": products, "suggested_name": name, "kind": kind, "egg_id": imported["id"]}))
}
