package panel

import (
	"context"
	"testing"
)

func TestSteamCatalogBridgeSchemaMigration(t *testing.T) {
	rt := steamRuntime(t) // Isolated PostgreSQL schema and fake node transport.
	a, ctx := rt.app, context.Background()
	id := rt.server["id"]
	// Model an existing installation before these additive columns existed.
	if err := a.exec(ctx, `ALTER TABLE steam_servers DROP COLUMN beta_password_encrypted, DROP COLUMN console_password_encrypted, DROP COLUMN validate_on_start`); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, `DROP TABLE IF EXISTS panel_schema_versions`); err != nil {
		t.Fatal(err)
	}
	if err := a.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	row, err := a.one(ctx, `SELECT game,installed_build,beta_password_encrypted,console_password_encrypted,validate_on_start FROM steam_servers WHERE server_id=$1`, id)
	if err != nil {
		t.Fatal(err)
	}
	if row["game"] != "palworld" || row["installed_build"] != "100" || row["beta_password_encrypted"] != "" || row["console_password_encrypted"] != "" || boolean(row["validate_on_start"]) {
		t.Fatal("additive migration changed existing Steam settings or defaults")
	}
	if err = a.exec(ctx, `UPDATE steam_servers SET beta_password_encrypted='fixture-beta-ciphertext',console_password_encrypted='fixture-console-ciphertext',validate_on_start=true WHERE server_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err = a.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	row, err = a.one(ctx, `SELECT beta_password_encrypted,console_password_encrypted,validate_on_start FROM steam_servers WHERE server_id=$1`, id)
	if err != nil {
		t.Fatal(err)
	}
	if row["beta_password_encrypted"] != "fixture-beta-ciphertext" || row["console_password_encrypted"] != "fixture-console-ciphertext" || !boolean(row["validate_on_start"]) {
		t.Fatal("repeat migration changed stored bridge settings")
	}
}
