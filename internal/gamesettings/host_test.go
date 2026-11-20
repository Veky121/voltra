package gamesettings

import (
	"reflect"
	"runtime"
	"testing"
)

// panel's failure logging skips this forwarder by name.
func TestServiceFailForwarderName(t *testing.T) {
	if name := runtime.FuncForPC(reflect.ValueOf((*Service).fail).Pointer()).Name(); name != "voltra/internal/gamesettings.(*Service).fail" {
		t.Fatalf("forwarder renamed to %s", name)
	}
}
