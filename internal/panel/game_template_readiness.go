package panel

// The generic template route must inherit a managed variant's dependency gate.
// Otherwise callers could bypass a blocked setup by using its imported recipe.
func gameTemplateSetupUnavailable(entry gameTemplate) string {
	if entry.SetupUnavailableReason != "" {
		return entry.SetupUnavailableReason
	}
	if managed := steamCatalogBridgeID(entry.Path); managed != "" {
		if spec, ok := steamGameSpecFor(managed); ok {
			return spec.UnavailableReason
		}
	}
	return ""
}
