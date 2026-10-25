package steamapi

// PrivateAppProfile is independent of anonymous SteamCMD support. Adding a
// private content policy must never advertise a new public installer capability.
type PrivateAppProfile struct {
	AppID          uint32
	Platform       string
	Architecture   string
	ProtectedPaths []string
}

var privateCatalogProfiles = []PrivateAppProfile{
	// The shipped Banana adapter confines per-server configuration, bans and
	// rotations to Servers/<SERVER>. Never replace it with publisher content.
	{2406780, "linux", "64", []string{".voltra", "Servers"}},
}

func PrivateProfile(app uint32) (PrivateAppProfile, bool) {
	for _, profile := range privateCatalogProfiles {
		if profile.AppID == app {
			profile.ProtectedPaths = append([]string{}, profile.ProtectedPaths...)
			return profile, true
		}
	}
	if profile, ok := Profile(int64(app)); ok {
		return PrivateAppProfile{app, "linux", "64", profile.ProtectedPaths}, true
	}
	return PrivateAppProfile{}, false
}
