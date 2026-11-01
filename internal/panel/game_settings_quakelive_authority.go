package panel

const quakeLiveSettingsStartup = "exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/quakelive_parity.py"

// Integration must provide a fresh mounted-filesystem lookup for discovery and
// again immediately before saving. Lookup errors must never authorize fallback.
// This helper does not replace the shared revision or permission checks.
func quakeLiveActiveSettingsDocument(recipe, startup string, exists func(string) (bool, error)) (string, error) {
	if recipe != quakeLiveSettingsRecipe || startup != quakeLiveSettingsStartup {
		return "", nil
	}
	for _, file := range []string{quakeLiveHomeSettingsPath, quakeLiveBaseSettingsPath} {
		found, err := exists(file)
		if err != nil {
			return "", err
		}
		if found {
			return file, nil
		}
	}
	return "", nil
}
