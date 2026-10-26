package steamapi

import "strconv"

const ProfileCapability = "steam-profiles-v1"

// This registry is shared by the node's preservation policy and capability
// advertisement. New games cannot be offered to an agent lacking their policy.
type AppProfile struct {
	AppID          int64
	ProtectedPaths []string
	LegacyV1       bool
}

var appProfiles = []AppProfile{
	{1690800, []string{".config/Epic/FactoryGame/Saved", "FactoryGame/Saved"}, true},
	{2394010, []string{"Pal/Saved", ".voltra"}, true},
	{896660, []string{".voltra", "saves"}, false},
	{294420, []string{"serverconfig.xml", "saves", ".voltra"}, false},
}

func AppCapability(appID int64) string { return "steam-app:" + strconv.FormatInt(appID, 10) }
func Profile(appID int64) (AppProfile, bool) {
	for _, profile := range appProfiles {
		if profile.AppID == appID {
			profile.ProtectedPaths = append([]string{}, profile.ProtectedPaths...)
			return profile, true
		}
	}
	return AppProfile{}, false
}
func Capabilities() []string {
	out := []string{Capability, ProfileCapability, OptionsCapability, ConsoleCapability, WindowsCapability, PalworldBridgeCapability}
	for _, profile := range appProfiles {
		out = append(out, AppCapability(profile.AppID))
	}
	return out
}
func KnownCapability(capability string) bool {
	if KnownPrivateCapability(capability) {
		return true
	}
	for _, known := range Capabilities() {
		if known == capability {
			return true
		}
	}
	return false
}
