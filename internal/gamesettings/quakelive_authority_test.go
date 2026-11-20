package gamesettings

import (
	"errors"
	"testing"
)

func TestQuakeLiveAuthority(t *testing.T) {
	for _, tc := range []struct {
		home, base bool
		want       string
	}{
		{true, true, QuakeLiveHomeSettingsPath}, {true, false, QuakeLiveHomeSettingsPath},
		{false, true, QuakeLiveBaseSettingsPath}, {false, false, ""},
	} {
		got, err := quakeLiveActiveSettingsDocument(QuakeLiveSettingsRecipe, quakeLiveSettingsStartup, func(file string) (bool, error) {
			if file == QuakeLiveHomeSettingsPath {
				return tc.home, nil
			}
			return tc.base, nil
		})
		if err != nil || got != tc.want {
			t.Fatalf("selection %q: %v", got, err)
		}
	}
	for _, identity := range [][2]string{{"other", quakeLiveSettingsStartup}, {QuakeLiveSettingsRecipe, "custom launcher"}} {
		got, err := quakeLiveActiveSettingsDocument(identity[0], identity[1], func(string) (bool, error) { t.Fatal("unsupported launcher probed"); return true, nil })
		if got != "" || err != nil {
			t.Fatal(got, err)
		}
	}
	failure := errors.New("mounted lookup unavailable")
	got, err := quakeLiveActiveSettingsDocument(QuakeLiveSettingsRecipe, quakeLiveSettingsStartup, func(string) (bool, error) { return false, failure })
	if got != "" || !errors.Is(err, failure) {
		t.Fatal("lookup failure authorized fallback", got, err)
	}
}
