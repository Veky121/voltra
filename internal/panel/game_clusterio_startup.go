package panel

import (
	"context"
	"strings"
	"unicode/utf8"
)

// Keep the generic Startup validator's original request-body semantics intact.
// This reviewed native adapter has an additional controller/host constraint.
func (a *App) validateClusterioStartupChange(ctx context.Context, server M, changed M, variables []M, input M) error {
	key := str(changed["env_variable"])
	if key != "CLUSTER_NAME" && key != "SERVER_MODE" {
		return nil
	}
	egg, err := a.serverEffectiveEgg(ctx, server)
	if err != nil {
		return err
	}
	if str(egg["startup"]) != "exec node .voltra/clusterio-start.mjs" {
		return nil
	}
	values := map[string]string{}
	for _, variable := range variables {
		name := str(variable["env_variable"])
		if name != "CLUSTER_NAME" && name != "SERVER_MODE" {
			continue
		}
		value, present := variable["server_value"]
		if !present {
			value = variable["default_value"]
		}
		values[name] = str(value)
	}
	value := input["value"]
	if boolean(input["reset"]) {
		value = changed["default_value"]
	}
	values[key] = str(value)
	mode, hasMode := values["SERVER_MODE"]
	name, hasName := values["CLUSTER_NAME"]
	if !hasMode || !hasName {
		return bad("Clusterio role settings are incomplete.")
	}
	if mode != "controller" && mode != "host" {
		return bad("Choose controller or host.")
	}
	if utf8.RuneCountInString(name) > 100 {
		return bad("Cluster Name must be at most 100 characters.")
	}
	if mode == "controller" && strings.TrimSpace(name) == "" {
		return bad("A controller requires a Cluster Name. Set it before changing the server role.")
	}
	return nil
}
