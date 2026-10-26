package panel

import (
	"reflect"
	"strconv"
	"strings"
)

func minecraftPropertyEnumNames(key string) []string {
	switch key {
	case "gamemode":
		return []string{"survival", "creative", "adventure", "spectator"}
	case "difficulty":
		return []string{"peaceful", "easy", "normal", "hard"}
	}
	return nil
}

func minecraftPropertyEnumLabel(key, value string) string {
	for index, name := range minecraftPropertyEnumNames(key) {
		if value == strconv.Itoa(index) {
			return name
		}
	}
	return value
}

func minecraftPropertyEnumNumber(key, value string) string {
	for index, name := range minecraftPropertyEnumNames(key) {
		if value == name {
			return strconv.Itoa(index)
		}
	}
	return value
}

// Releases before 1.13 read numeric property enums. Translate only the known
// managed template/runtime contract; custom scripts, images and mappings keep
// their administrator-defined semantics. Database startup values remain names.
func minecraftManagedLegacyEnums(egg, environment M, image string) bool {
	version := str(environment["MINECRAFT_VERSION"])
	parts := strings.Split(version, ".")
	if !minecraftSupportedRelease(version) || parts[0] != "1" {
		return false
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil || minor >= 13 {
		return false
	}
	if str(egg["author"]) != "library@voltra.local" {
		return false
	}
	if str(egg["script_entry"]) != "bash" || str(egg["startup"]) != "java -Xms128M -XX:MaxRAMPercentage=80.0 -Dterminal.jline=false -Dterminal.ansi=true -jar server.jar nogui" {
		return false
	}
	switch str(egg["uuid"]) {
	case "1da8cb7a-ceee-44c0-93d1-000000000001", "1da8cb7a-ceee-44c0-93d1-000000000002", "1da8cb7a-ceee-44c0-93d1-000000000003", "1da8cb7a-ceee-44c0-93d1-000000000004", "1da8cb7a-ceee-44c0-93d1-000000000005", "1da8cb7a-ceee-44c0-93d1-000000000006", "1da8cb7a-ceee-44c0-93d1-000000000104":
	default:
		return false
	}
	installerImage := str(egg["script_container"])
	if installerImage != minecraftInstallerImage && installerImage != "ghcr.io/pterodactyl/installers:debian" {
		return false
	}
	normalize := func(s string) string { return strings.TrimRight(strings.ReplaceAll(s, "\r\n", "\n"), "\n") }
	managed := strings.Replace(minecraftInstallScript, "# VOLTRA_PYTHON", minecraftInstallPython, 1)
	if normalize(str(egg["script_install"])) != normalize(managed) && !minecraftKnownHistoricalInstaller(str(egg["script_install"])) {
		return false
	}
	images, knownImage := M{}, false
	for _, runtime := range javaDefaultRuntimes() {
		images[str(runtime["name"])] = runtime["image"]
		knownImage = knownImage || image == str(runtime["image"])
	}
	if !knownImage || !reflect.DeepEqual(asMap(egg["docker_images"]), images) {
		return false
	}
	properties := asMap(asMap(egg["config_files"])["server.properties"])
	find := asMap(properties["find"])
	return str(properties["parser"]) == "properties" && str(find["gamemode"]) == "{{server.build.env.GAME_MODE}}" && str(find["difficulty"]) == "{{server.build.env.DIFFICULTY}}"
}

func minecraftRuntimePropertyEnums(egg, environment M, image string) {
	if !minecraftManagedLegacyEnums(egg, environment, image) {
		return
	}
	environment["GAME_MODE"] = minecraftPropertyEnumNumber("gamemode", str(environment["GAME_MODE"]))
	environment["DIFFICULTY"] = minecraftPropertyEnumNumber("difficulty", str(environment["DIFFICULTY"]))
}
