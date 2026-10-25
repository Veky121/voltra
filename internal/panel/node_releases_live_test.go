package panel

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestNodeReleaseLiveMetadata(t *testing.T) {
	if os.Getenv("VOLTRA_NODE_RELEASE_LIVE") != "1" {
		t.Skip("explicit read-only live metadata check")
	}
	t.Setenv("NODE_RELEASE_VERSION", "")
	t.Setenv("NODE_RELEASE_CHANNEL", "beta")
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	a := &App{}
	r, e := a.resolveNodeInstaller(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if !nodeReleaseTag.MatchString(r.Version) {
		t.Fatal("invalid resolved release")
	}
	t.Logf("Verified complete Linux node release %s: %s", r.Version, r.ReleaseURL)
}
