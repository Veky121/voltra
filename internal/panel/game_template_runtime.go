package panel

import (
	"fmt"
	"strconv"
)

// Only reviewed declarations bind a startup variable to the game listener.
// Unrelated variables named PORT keep their previous behavior.
func templatePrimaryListenerPort(entry gameTemplate, environment M) (int64, bool, error) {
	name := entry.PrimaryPortEnv
	if name == "" {
		return 0, false, nil
	}
	if len(name) > 100 || !templatePortEnvironmentName.MatchString(name) {
		return 0, false, bad("This recipe has invalid primary listener metadata.")
	}
	matches := 0
	for _, raw := range asSlice(entry.Egg["variables"]) {
		if str(asMap(raw)["env_variable"]) == name {
			matches++
		}
	}
	if matches != 1 {
		return 0, false, bad("This recipe needs one unambiguous primary listener control.")
	}
	raw := str(environment[name])
	if raw == "" {
		return 0, false, nil
	}
	port, err := templateExplicitPort(raw)
	if err != nil {
		return 0, false, bad("The primary listener must be empty or a canonical integer between 1 and 65535.")
	}
	return port, true, nil
}

func validateTemplatePortRules(entry gameTemplate, environment M, primary M, additional []M) error {
	if err := validateL4D2OutgoingClientPort(entry, environment, primary); err != nil {
		return err
	}
	listener, explicitListener, err := templatePrimaryListenerPort(entry, environment)
	if err != nil {
		return err
	}
	if entry.PrimaryPortEnv != "" {
		if err := validateTemplateAllocationPorts(primary, additional, false); err != nil {
			return err
		}
		if explicitListener {
			allocated := num(primary["port"]) == listener
			for _, allocation := range additional {
				allocated = allocated || num(allocation["port"]) == listener
			}
			if !allocated {
				return bad("The configured primary listener must be among the server's allocated ports.")
			}
		}
	}
	environment, err = normalizeTemplatePortEnvironment(entry, environment, primary, additional)
	if err != nil {
		return err
	}
	for _, rule := range entry.PortRules {
		if err := validateTemplatePortRuleMetadata(rule); err != nil {
			return err
		}
		if rule.Minimum < 1 || rule.Maximum > 65535 || rule.Maximum < rule.Minimum || rule.Count < 1 || rule.Count > rule.Maximum-rule.Minimum+1 || len(rule.Offsets)+1 > rule.Count || rule.Condition != "" && rule.Condition != "nonzero" || rule.Condition == "nonzero" && (rule.Environment == "" || rule.Value != "") || rule.Condition == "" && (rule.Environment == "") != (rule.Value == "") || rule.AllocatedValue && (rule.Condition != "nonzero" || rule.Count < 2) || rule.ExcludePrimary && !rule.AllocatedValue {
			return bad("This recipe has invalid port rule metadata.")
		}
		seenOffsets := map[int]bool{}
		for _, offset := range rule.Offsets {
			if offset == 0 || offset < -65534 || offset > 65534 || seenOffsets[offset] {
				return bad("This recipe has invalid relative port metadata.")
			}
			seenOffsets[offset] = true
		}
		if len(rule.ExcludeOffsets) > 0 && !rule.AllocatedValue {
			return bad("Excluded relative ports require an allocated optional port.")
		}
		seenExcluded := map[int]bool{}
		for _, offset := range rule.ExcludeOffsets {
			if offset == 0 || offset < -65534 || offset > 65534 || seenExcluded[offset] {
				return bad("This recipe has invalid excluded relative port metadata.")
			}
			seenExcluded[offset] = true
		}
		if rule.WhenEnvironment != "" && str(environment[rule.WhenEnvironment]) != rule.WhenValue {
			continue
		}
		allocatedValue := int64(0)
		if rule.Condition == "nonzero" {
			raw := str(environment[rule.Environment])
			value, err := strconv.Atoi(raw)
			if err != nil || strconv.Itoa(value) != raw || value < 0 || value > 65535 {
				return bad("Optional port settings must be 0 or an integer between 1 and 65535.")
			}
			if value == 0 {
				continue
			}
			allocatedValue = int64(value)
		} else if rule.Environment != "" && str(environment[rule.Environment]) != rule.Value {
			continue
		}
		if err := validateTemplateAllocationPorts(primary, additional, true); err != nil {
			return err
		}
		primaryPort := num(primary["port"])
		count := 0
		ports := map[int64]bool{primaryPort: true}
		for _, allocation := range additional {
			ports[num(allocation["port"])] = true
		}
		for _, excluded := range rule.ExcludePorts {
			if ports[int64(excluded)] {
				return bad("A selected port is excluded by this recipe.")
			}
		}
		for port := range ports {
			if port >= int64(rule.Minimum) && port <= int64(rule.Maximum) {
				count++
			}
		}
		if primaryPort < int64(rule.Minimum) || primaryPort > int64(rule.Maximum) || count < rule.Count {
			return bad(fmt.Sprintf("This mode needs its game port and at least %d total allocated ports in the range %d through %d.", rule.Count, rule.Minimum, rule.Maximum))
		}
		if rule.AllocatedValue && (allocatedValue < int64(rule.Minimum) || allocatedValue > int64(rule.Maximum) || !ports[allocatedValue] || rule.ExcludePrimary && allocatedValue == primaryPort) {
			return bad("The configured optional port must be allocated on the game address.")
		}
		for _, offset := range rule.ExcludeOffsets {
			if allocatedValue == primaryPort+int64(offset) {
				return bad(fmt.Sprintf("The configured optional port must differ from the game port %+d.", offset))
			}
		}
		for _, offset := range rule.Offsets {
			port := primaryPort + int64(offset)
			if port < int64(rule.Minimum) || port > int64(rule.Maximum) || !ports[port] {
				return bad(fmt.Sprintf("This mode needs an allocation at the game port %+d on the same address.", offset))
			}
		}
		if rule.AllocatedValue {
			for _, delta := range append([]int{0}, rule.AllocatedOffsets...) {
				for _, excluded := range rule.ExcludePorts {
					if allocatedValue+int64(delta) == int64(excluded) {
						return bad("The configured service port or companion uses an excluded native port.")
					}
				}
			}
		}
		for _, offset := range rule.AllocatedOffsets {
			port := allocatedValue + int64(offset)
			if port < int64(rule.Minimum) || port > int64(rule.Maximum) || !ports[port] {
				return bad("The service port needs its companion allocation on the game address.")
			}
		}
	}
	return nil
}

func validateTemplateAllocationPorts(primary M, additional []M, sameIP bool) error {
	port := num(primary["port"])
	if port < 1 || port > 65535 {
		return bad("The game port must be between 1 and 65535.")
	}
	seen := map[string]bool{fmt.Sprintf("%s:%d", str(primary["ip"]), port): true}
	for _, allocation := range additional {
		port = num(allocation["port"])
		key := fmt.Sprintf("%s:%d", str(allocation["ip"]), port)
		if port < 1 || port > 65535 || seen[key] || sameIP && str(allocation["ip"]) != str(primary["ip"]) {
			return bad("Additional ports must be distinct valid ports on the required address.")
		}
		seen[key] = true
	}
	return nil
}

func validateTemplatePortLayout(entry gameTemplate, primary M, additional []M) error {
	required := max(1, entry.RequiredPorts)
	if err := validateTemplateAllocationPorts(primary, additional, required > 1); err != nil {
		return err
	}
	if !entry.ConsecutivePorts && (entry.ConsecutivePortsCount != 0 || entry.ConsecutivePrimaryOffset != 0) {
		return bad("This recipe has an invalid consecutive port layout.")
	}
	if len(additional)+1 < required {
		return bad(fmt.Sprintf("This recipe needs at least %d allocated ports on the same address.", required))
	}
	ports := map[int64]bool{num(primary["port"]): true}
	for _, allocation := range additional {
		if required > 1 && str(allocation["ip"]) != str(primary["ip"]) {
			return bad("This recipe needs its ports on the same address.")
		}
		ports[num(allocation["port"])] = true
	}
	if entry.ConsecutivePorts {
		count := entry.ConsecutivePortsCount
		if count == 0 {
			count = required
		}
		if count < 1 || count > required || entry.ConsecutivePrimaryOffset < 0 || entry.ConsecutivePrimaryOffset >= count {
			return bad("This recipe has an invalid consecutive port layout.")
		}
		for offset := range count {
			port := num(primary["port"]) - int64(entry.ConsecutivePrimaryOffset) + int64(offset)
			if port < 1 || port > 65535 || !ports[port] {
				return bad(fmt.Sprintf("This recipe needs %d consecutive ports starting %d ports below the game port.", count, entry.ConsecutivePrimaryOffset))
			}
		}
	}
	return nil
}

// Reviewed native Steam templates own their updates. Disable the image's legacy
// updater before its entrypoint runs, while retaining the operator's setting in
// an app-derived environment value for the typed template helper.
func templateRuntimeEnvironment(egg, environment M) error {
	managed := false
	privateWine := false
	arkWine := false
	typedWine := false
	for _, feature := range asSlice(egg["features"]) {
		managed = managed || str(feature) == "voltra_steam_template"
		privateWine = privateWine || str(feature) == "voltra_private_wine"
		arkWine = arkWine || str(feature) == "voltra_ark_wine"
		typedWine = typedWine || str(feature) == "voltra_typed_wine"
	}
	if !managed {
		return nil
	}
	automatic := str(environment["AUTO_UPDATE"])
	if automatic != "0" && automatic != "1" {
		return bad("Steam automatic updates must be enabled or disabled.")
	}
	wineRuntime := str(environment["WINETRICKS_RUN"])
	if privateWine && wineRuntime != "mono" {
		return bad("This private Wine recipe requires its fixed mono runtime setting.")
	}
	environment["VOLTRA_STEAM_AUTO_UPDATE"] = automatic
	environment["AUTO_UPDATE"] = "0"
	if privateWine || typedWine {
		// Keep the stored original variable intact. Only the derived daemon
		// environment disables the stock image's unrelated global prefix setup.
		environment["VOLTRA_WINETRICKS_RUN"] = wineRuntime
		environment["WINETRICKS_RUN"] = ""
	}
	if arkWine {
		environment["VOLTRA_ARK_WINETRICKS_RUN"] = wineRuntime
		environment["WINETRICKS_RUN"] = ""
	}
	return nil
}

// Exact L4D2 outgoing client port contract; it is not an allocated listener.
func validateL4D2OutgoingClientPort(entry gameTemplate, environment M, primary M) error {
	if entry.Path != "left4dead_2/egg-left4dead_2.json" {
		return nil
	}
	port, err := strconv.Atoi(str(environment["SRCDS_CPORT"]))
	if err != nil || port != 0 && (port < 1025 || port > 65535 || primary != nil && int64(port) == num(primary["port"])) {
		return bad("Choose 0 or a distinct optional outgoing client port between 1025 and 65535.")
	}
	return nil
}
