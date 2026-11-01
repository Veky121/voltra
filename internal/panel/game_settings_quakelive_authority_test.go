package panel

import (
	"errors"
	"testing"
)

func TestQuakeLiveAuthority(t *testing.T) {
	for _, tc := range []struct {
		home, base bool
		want       string
	}{
		{true, true, quakeLiveHomeSettingsPath}, {true, false, quakeLiveHomeSettingsPath},
		{false, true, quakeLiveBaseSettingsPath}, {false, false, ""},
	} {
		got, err := quakeLiveActiveSettingsDocument(quakeLiveSettingsRecipe, quakeLiveSettingsStartup, func(file string) (bool, error) {
			if file == quakeLiveHomeSettingsPath {
				return tc.home, nil
			}
			return tc.base, nil
		})
		if err != nil || got != tc.want {
			t.Fatalf("selection %q: %v", got, err)
		}
	}
	for _, identity := range [][2]string{{"other", quakeLiveSettingsStartup}, {quakeLiveSettingsRecipe, "custom launcher"}} {
		got, err := quakeLiveActiveSettingsDocument(identity[0], identity[1], func(string) (bool, error) { t.Fatal("unsupported launcher probed"); return true, nil })
		if got != "" || err != nil {
			t.Fatal(got, err)
		}
	}
	failure := errors.New("mounted lookup unavailable")
	got, err := quakeLiveActiveSettingsDocument(quakeLiveSettingsRecipe, quakeLiveSettingsStartup, func(string) (bool, error) { return false, failure })
	if got != "" || !errors.Is(err, failure) {
		t.Fatal("lookup failure authorized fallback", got, err)
	}
}
