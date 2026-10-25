package panel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

func privateTemplateApp(entry gameTemplate) uint32 {
	if profile, ok := privateTemplatePolicy(entry); ok {
		return profile.AppID
	}
	return 0
}

// Stage the canonical helpers without invoking the final anonymous downloader.
// A distinct content-derived egg identity keeps ordinary installations unchanged.
func privatePreparationEntry(entry gameTemplate) (gameTemplate, error) {
	if privateTemplateApp(entry) == 0 {
		return gameTemplate{}, bad("This template has no reviewed private content preparation path.")
	}
	d, ok := privateTemplateDescriptorFor(entry)
	if !ok {
		return gameTemplate{}, bad("This template has no reviewed private preparation descriptor.")
	}
	return privatePreparationDescriptor(entry, d)
}

func privatePreparationDescriptor(entry gameTemplate, d privateTemplateDescriptor) (gameTemplate, error) {
	raw, err := json.Marshal(entry.Egg)
	if err != nil {
		return gameTemplate{}, err
	}
	var egg M
	if err = json.Unmarshal(raw, &egg); err != nil {
		return gameTemplate{}, err
	}
	installation := asMap(asMap(egg["scripts"])["installation"])
	script := strings.TrimRight(str(installation["script"]), "\r\n")
	command := "\n" + d.Command
	if !strings.HasSuffix(script, command) || strings.Count(script, command) != 1 {
		return gameTemplate{}, bad("The private preparation recipe changed and needs review.")
	}
	installation["script"] = strings.TrimSuffix(script, command) + "\nprintf '%s\\n' 'Voltra private Steam directory prepared. Authorize content installation in Steam maintenance.'\n"
	features := append([]any{}, asSlice(egg["features"])...)
	egg["features"] = append(features, "voltra:steam-private-prepared-v1")
	entry.Egg = egg
	entry = privatePreparationIdentity(entry)
	return entry, nil
}

func privatePreparationIdentity(entry gameTemplate) gameTemplate {
	sum := sha256.Sum256([]byte(entry.SHA256 + ":private-preparation-v1"))
	entry.SHA256 = hex.EncodeToString(sum[:])
	return entry
}

func privatePreparedEggUUIDs() []string {
	ids := []string{}
	for _, entry := range gameTemplates().Entries {
		if privateTemplateApp(entry) != 0 {
			ids = append(ids, gameTemplateEggUUID(privatePreparationIdentity(entry)))
		}
	}
	return ids
}

func privatePreparationEnvironment(env M) (M, error) {
	if err := guardTemplateSteamEnvironment(env); err != nil {
		return nil, err
	}
	copy := M{}
	for key, value := range env {
		copy[key] = value
		if role := templateSteamRole(key); role != "" && role != "branch" {
			copy[key] = ""
		}
	}
	copy["AUTO_UPDATE"] = "0"
	return copy, nil
}
