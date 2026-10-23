package panel

import (
	"context"
	"errors"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
)

// timezone resolves the persisted panel setting before the deployment default.
// The embedded IANA database also works in a standalone Windows binary.
func (a *App) timezone(ctx context.Context) (*time.Location, error) {
	name := strings.TrimSpace(a.Config.Timezone)
	if a.DB != nil {
		setting, err := a.one(ctx, "SELECT value FROM settings WHERE key='app:timezone'")
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			name = str(setting["value"])
		}
	}
	if name == "" {
		name = "UTC"
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, bad("The panel timezone must be a valid IANA timezone.")
	}
	return location, nil
}
