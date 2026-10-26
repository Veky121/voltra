package panel

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// The native API can use a separate HTTPS origin while browser sign-in keeps
// its existing public URL and Cloudflare identity boundary.
func (a *App) desktopPairingPublicURL(ctx context.Context) (string, error) {
	var configured any
	if a.DB != nil {
		row, err := a.one(ctx, "SELECT value FROM settings WHERE key='desktop.public_url'")
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		configured = row["value"]
	}
	return desktopPairingURL(a.panelPublicURL(ctx), configured)
}

func desktopPairingURL(fallback string, configured any) (string, error) {
	if configured == nil {
		return pairingPanelURL(fallback)
	}
	value, ok := configured.(string)
	if !ok {
		return "", bad("desktop.public_url must be an HTTPS base URL.")
	}
	return pairingPanelURL(value)
}
