package panel

import (
	"strconv"
	"strings"
)

func resoniteSessionSettingPresentation(egg M, file string, field M) {
	if !nativeSettingsIsRecipe(egg, resoniteSettingsRecipe) || !reviewedNewDocument(egg, file) {
		return
	}
	parts := strings.Split(strings.TrimPrefix(str(field["key"]), "/"), "/")
	if len(parts) != 3 || (parts[0] != "startWorlds" && parts[0] != "StartWorlds") {
		return
	}
	index, err := strconv.Atoi(parts[1])
	if err != nil || index < 0 {
		return
	}
	labels := map[string]string{"sessionName": "Session name", "description": "Description", "accessLevel": "Access level", "maxUsers": "Maximum users", "isEnabled": "Enabled", "saveOnExit": "Save on exit", "autoRecover": "Recover session", "autoSleep": "Sleep when idle"}
	label, ok := labels[parts[2]]
	if !ok {
		return
	}
	field["label"], field["group"] = label, "Startup world "+strconv.Itoa(index+1)
	if parts[2] == "accessLevel" {
		field["type"] = "select"
		options := []M{}
		for _, value := range []string{"Private", "LAN", "Contacts", "ContactsPlus", "RegisteredUsers", "Anyone"} {
			options = append(options, M{"value": value, "label": value})
		}
		field["options"] = options
	}
	if parts[2] == "maxUsers" {
		field["min"], field["max"] = 1, 2147483647
	}
}
