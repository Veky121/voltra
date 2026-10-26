package panel

import "fmt"

// Absence is proof only in a complete, correctly shaped response. In
// particular, asSlice(nil) must not turn an upstream error object into an
// empty set of proxies and release a reserved public port.
func proxyStoreEntries(snapshot M) ([]any, error) {
	entries, ok := snapshot["proxies"].([]any)
	if !ok {
		return nil, fmt.Errorf("FRPC Store API unsupported response")
	}
	if _, err := proxyEntryNames(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func proxyEntryNames(entries []any) (map[string]bool, error) {
	names := map[string]bool{}
	for _, entry := range entries {
		object, ok := entry.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("FRPC proxy list contains an invalid entry")
		}
		name, ok := object["name"].(string)
		if !ok || name == "" || names[name] {
			return nil, fmt.Errorf("FRPC proxy list contains an invalid or duplicate name")
		}
		names[name] = true
	}
	return names, nil
}

func proxyStatusContains(snapshot M, name string) (bool, error) {
	if snapshot == nil {
		return false, fmt.Errorf("FRPC runtime status response invalid")
	}
	// FRPC returns {} when no proxies exist. Populated protocol groups must
	// each be a list of named entries, including groups unknown to this panel.
	found := false
	for _, group := range snapshot {
		entries, ok := group.([]any)
		if !ok {
			return false, fmt.Errorf("FRPC runtime status response invalid")
		}
		names, err := proxyEntryNames(entries)
		if err != nil {
			return false, err
		}
		found = found || names[name]
	}
	return found, nil
}
