package panel

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var templatePortEnvironmentName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validateTemplatePortRuleMetadata(rule templatePortRule) error {
	if len(rule.AllocatedOffsets) > 0 && (!rule.AllocatedValue || len(rule.AllocatedOffsets)+2 > rule.Count) {
		return bad("This recipe has invalid service-relative port metadata.")
	}
	if rule.Minimum < 1 || rule.Maximum > 65535 || rule.Maximum < rule.Minimum || rule.Count < 1 || rule.Count > rule.Maximum-rule.Minimum+1 || len(rule.Offsets)+1 > rule.Count || rule.Condition != "" && rule.Condition != "nonzero" || rule.Condition == "nonzero" && (rule.Environment == "" || rule.Value != "") || rule.Condition == "" && (rule.Environment == "") != (rule.Value == "") || rule.AllocatedValue && (rule.Condition != "nonzero" || rule.Count < 2) || rule.ExcludePrimary && !rule.AllocatedValue || len(rule.ExcludeOffsets) > 0 && !rule.AllocatedValue || rule.AutoAllocate && (!rule.AllocatedValue || rule.Condition != "nonzero") {
		return bad("This recipe has invalid port rule metadata.")
	}
	if (rule.WhenEnvironment == "") != (rule.WhenValue == "") || rule.WhenEnvironment != "" && (!templatePortEnvironmentName.MatchString(rule.WhenEnvironment) || strings.ContainsAny(rule.WhenValue, "\x00\r\n")) {
		return bad("This recipe has invalid port activation metadata.")
	}
	for _, offsets := range [][]int{rule.Offsets, rule.ExcludeOffsets, rule.AllocatedOffsets} {
		seen := map[int]bool{}
		for _, offset := range offsets {
			if offset == 0 || offset < -65534 || offset > 65534 || seen[offset] {
				return bad("This recipe has invalid relative port metadata.")
			}
			seen[offset] = true
		}
	}
	return nil
}

func templatePortRuleActive(rule templatePortRule, environment M) bool {
	if rule.WhenEnvironment != "" && str(environment[rule.WhenEnvironment]) != rule.WhenValue {
		return false
	}
	if rule.Condition == "nonzero" {
		return str(environment[rule.Environment]) != "0"
	}
	return rule.Environment == "" || str(environment[rule.Environment]) == rule.Value
}

func templateExplicitPort(value string) (int64, error) {
	port, err := strconv.Atoi(value)
	if err != nil || strconv.Itoa(port) != value || port < 1 || port > 65535 {
		return 0, bad("Optional port settings must be 0 or an integer between 1 and 65535.")
	}
	return int64(port), nil
}

// Automatic allocation is opt-in. Legacy metadata keeps its exact validation
// behavior, including blank rejection and optional zero disabling. New roles
// bind only selected additional allocations, never unselected/free node ports.
func normalizeTemplatePortEnvironment(entry gameTemplate, environment M, primary M, additional []M) (M, error) {
	result := M{}
	for key, value := range environment {
		result[key] = value
	}
	active := []templatePortRule{}
	hasAuto := false
	autoNames := map[string]bool{}
	for _, rule := range entry.PortRules {
		if err := validateTemplatePortRuleMetadata(rule); err != nil {
			return nil, err
		}
		if rule.AutoAllocate {
			if autoNames[rule.Environment] {
				return nil, bad("This recipe repeats an automatic port role.")
			}
			autoNames[rule.Environment] = true
		}
		if !templatePortRuleActive(rule, environment) {
			continue
		}
		active = append(active, rule)
		hasAuto = hasAuto || rule.AutoAllocate || len(rule.AllocatedOffsets) > 0
	}
	if !hasAuto {
		return result, nil
	}
	if err := validateTemplateAllocationPorts(primary, additional, true); err != nil {
		return nil, err
	}
	primaryPort := num(primary["port"])
	available := map[int64]bool{}
	for _, allocation := range additional {
		available[num(allocation["port"])] = true
	}
	reserved := map[int64]bool{primaryPort: true}
	for _, rule := range active {
		for _, offset := range rule.Offsets {
			reserved[primaryPort+int64(offset)] = true
		}
	}
	if entry.ConsecutivePorts {
		count := entry.ConsecutivePortsCount
		if count == 0 {
			count = max(1, entry.RequiredPorts)
		}
		for offset := 0; offset < count; offset++ {
			reserved[primaryPort-int64(entry.ConsecutivePrimaryOffset)+int64(offset)] = true
		}
	}
	pending := []templatePortRule{}
	group := func(rule templatePortRule, base int64) []int64 {
		ports := []int64{base}
		for _, offset := range rule.AllocatedOffsets {
			ports = append(ports, base+int64(offset))
		}
		return ports
	}
	eligible := func(rule templatePortRule, base int64) bool {
		for _, port := range group(rule, base) {
			if !available[port] || reserved[port] || port < int64(rule.Minimum) || port > int64(rule.Maximum) {
				return false
			}
			for _, offset := range rule.ExcludeOffsets {
				if port == primaryPort+int64(offset) {
					return false
				}
			}
		}
		return true
	}
	names := map[string]bool{}
	for _, rule := range active {
		if !rule.AllocatedValue {
			continue
		}
		if names[rule.Environment] {
			return nil, bad("Service port roles must be distinct.")
		}
		names[rule.Environment] = true
		raw := str(environment[rule.Environment])
		if raw == "" && rule.AutoAllocate {
			pending = append(pending, rule)
			continue
		}
		port, err := templateExplicitPort(raw)
		if err != nil {
			return nil, err
		}
		if !eligible(rule, port) {
			return nil, bad("Service ports must use distinct selected additional allocations, separate from fixed game ports.")
		}
		for _, port := range group(rule, port) {
			reserved[port] = true
		}
	}
	ports := make([]int64, 0, len(available))
	for port := range available {
		ports = append(ports, port)
	}
	sort.Slice(ports, func(i, j int) bool { return ports[i] < ports[j] })
	for _, rule := range pending {
		chosen := int64(0)
		for _, port := range ports {
			if eligible(rule, port) {
				chosen = port
				break
			}
		}
		if chosen == 0 {
			return nil, bad("Allocate another distinct port on the game address for " + rule.Environment + ".")
		}
		for _, port := range group(rule, chosen) {
			reserved[port] = true
		}
		result[rule.Environment] = strconv.FormatInt(chosen, 10)
	}
	return result, nil
}
