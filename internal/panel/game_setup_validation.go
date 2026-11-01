package panel

import (
	"net/netip"
	"strings"
	"unicode/utf8"
)

// Additive validation metadata never changes an egg variable or its native rules.
type templateSetupValidation struct {
	Environment string `json:"environment"`
	Type        string `json:"type"`
	Required    bool   `json:"required"`
	Message     string `json:"message"`
	Description string `json:"description,omitempty"`
}

// Python 3.13+ IPv4Address.is_global && !is_multicast, including CGNAT and
// 192.0.0.9/.10 exceptions. netip.IsGlobalUnicast alone allows private ranges.
// https://docs.python.org/3/library/ipaddress.html#ipaddress.IPv4Address.is_global
func setupPublicIPv4(value string) bool {
	ip, err := netip.ParseAddr(value)
	if err != nil || !ip.Is4() || ip.String() != value {
		return false
	}
	if value == "192.0.0.9" || value == "192.0.0.10" {
		return true
	}
	for _, prefix := range []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"} {
		if netip.MustParsePrefix(prefix).Contains(ip) {
			return false
		}
	}
	return true
}

func validateTemplateSetupMetadata(validations []templateSetupValidation, egg M) error {
	invalid := func() error {
		return APIError{409, "GameSetupValidationMetadataInvalid", "This template's setup validation needs a compatibility review."}
	}
	if len(validations) > 64 {
		return invalid()
	}
	seen := map[string]bool{}
	for _, rule := range validations {
		key := rule.Environment
		if key == "" || len(key) > 100 || seen[key] || rule.Type != "public_ipv4" || strings.TrimSpace(rule.Message) == "" || len(rule.Message) > 1024 || !utf8.ValidString(rule.Message) || strings.ContainsAny(rule.Message, "\x00\r\n") || len(rule.Description) > 4096 || !utf8.ValidString(rule.Description) || strings.ContainsRune(rule.Description, 0) {
			return invalid()
		}
		for i, c := range key {
			if !(c == '_' || c >= 'A' && c <= 'Z' || i > 0 && c >= '0' && c <= '9') {
				return invalid()
			}
		}
		matches := 0
		for _, raw := range asSlice(egg["variables"]) {
			if str(asMap(raw)["env_variable"]) == key {
				matches++
			}
		}
		if matches != 1 {
			return invalid()
		}
		seen[key] = true
	}
	return nil
}

// Call after templateEnvironment and before planning/allocation/import/create.
// No network address discovery, normalization, defaults or writes occur here.
func validateTemplateSetupEnvironment(validations []templateSetupValidation, egg M, environment M) error {
	if err := validateTemplateSetupMetadata(validations, egg); err != nil {
		return err
	}
	// Bind the cross-control rule to the reviewed native launcher. Compare the
	// effective environment representation, without changing stored values.
	if str(egg["startup"]) == "exec bash .voltra/unturned-entry.sh" && eggEnvironmentString(environment["PUBLIC_SERVER"]) == "1" && eggEnvironmentString(environment["OFFLINE_ONLY"]) == "1" {
		return APIError{422, "GameSetupValidationFailed", "PUBLIC_SERVER and OFFLINE_ONLY are mutually exclusive. Choose LAN/offline or Internet mode."}
	}
	for _, rule := range validations {
		raw, exists := environment[rule.Environment]
		value, ok := raw.(string)
		if (!exists || ok && value == "") && !rule.Required {
			continue
		}
		if !ok || !setupPublicIPv4(value) {
			return APIError{422, "GameSetupValidationFailed", rule.Environment + ": " + rule.Message}
		}
	}
	return nil
}
