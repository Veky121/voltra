package panel

import (
	"errors"
	"testing"
	"time"
)

func TestSettingsCacheOnlyWhileListening(t *testing.T) {
	var c settingsCache
	var slot *cachedSetting[int]
	reads := 0
	read := func() (int, error) { reads++; return reads, nil }
	get := func() int {
		v, err := readCached(&c, func() **cachedSetting[int] { return &slot }, read)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	if get() != 1 || get() != 2 {
		t.Fatal("cached without a listener")
	}
	c.setListening(true)
	if get() != 3 || get() != 3 {
		t.Fatal("not cached while listening")
	}
	c.invalidate()
	if get() != 4 {
		t.Fatal("invalidation ignored")
	}
	slot.fetched = time.Now().Add(-settingsCacheLifetime)
	if get() != 5 {
		t.Fatal("an old copy must be re-read in case a notification was lost")
	}
	c.setListening(false)
	if get() != 6 || get() != 7 {
		t.Fatal("cached after the listener stopped")
	}
}

func TestSettingsCacheIgnoresReadsOverlappingAChange(t *testing.T) {
	var c settingsCache
	c.setListening(true)
	var slot *cachedSetting[string]
	value, err := readCached(&c, func() **cachedSetting[string] { return &slot }, func() (string, error) {
		// A change is announced while the old value is being read.
		c.invalidate()
		return "old", nil
	})
	if err != nil || value != "old" || slot != nil && slot.generation == c.generation {
		t.Fatal("a value read across a change was kept")
	}
	if _, err = readCached(&c, func() **cachedSetting[string] { return &slot }, func() (string, error) { return "", errors.New("down") }); err == nil || slot != nil {
		t.Fatal("errors must not be cached")
	}
}
