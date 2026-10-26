package panel

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Explicitly opt-in, read-only provider acceptance. Never provisions a server.
func TestMinecraftLiveATM10Pack(t *testing.T) {
	if os.Getenv("MINECRAFT_LIVE_PACK_TEST") != "1" {
		t.Skip("opt-in provider test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, os.Getenv("MINECRAFT_LIVE_DATABASE_URL"))
	if err != nil {
		t.Fatal("live database configuration unavailable")
	}
	defer pool.Close()
	a := &App{DB: pool, Config: Config{EncryptionKey: os.Getenv("ENCRYPTION_KEY")}, HTTP: &http.Client{Timeout: 90 * time.Second}}
	project, err := a.minecraftPackProject(ctx, "curseforge", "925200")
	if err != nil {
		t.Fatal(err)
	}
	version := project.RawVersions["9190157"]
	if version == nil {
		t.Fatal("ATM10 8.3 unavailable")
	}
	var server struct {
		Data M `json:"data"`
	}
	if err = a.minecraftProviderJSON(ctx, fmt.Sprintf("https://api.curseforge.com/v1/mods/925200/files/%d", num(version["serverPackFileId"])), project.Key, &server); err != nil {
		t.Fatal(err)
	}
	t.Logf("ATM10 8.3 client bytes=%d server bytes=%d", num(version["fileLength"]), num(server.Data["fileLength"]))
	if os.Getenv("MINECRAFT_LIVE_PACK_PLAN") == "1" {
		plan, err := a.minecraftModpackPlan(ctx, M{"provider": "curseforge", "project_id": "925200", "version_id": "9190157"})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("Read-only pack plan validated: %+v", plan.Loader)
	}
}
