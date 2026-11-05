package panel

import "testing"

func TestLocalDevelopmentDatabaseBoundary(t *testing.T) {
	valid := "postgres://voltra_dev:local-secret@127.0.0.1:55440/voltra_dev?sslmode=disable"
	if err := ValidateLocalDevelopmentURL(valid); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		"postgres://voltra_dev:x@production.example:55440/voltra_dev?sslmode=disable",
		"postgres://voltra_dev:x@127.0.0.1:55432/voltra_dev?sslmode=disable",
		"postgres://voltra_dev:x@127.0.0.1:55440/pteroclone?sslmode=disable",
		"postgres://postgres:x@127.0.0.1:55440/voltra_dev?sslmode=disable",
		valid + "&host=production.example",
		valid + "&port=5432",
		valid + "&dbname=production",
		valid + "&options=-csearch_path%3Dproduction",
		valid + "&sslmode=disable",
		valid + "#ignored",
		"host=127.0.0.1 port=55440 dbname=voltra_dev user=voltra_dev",
	} {
		if ValidateLocalDevelopmentURL(raw) == nil {
			t.Errorf("accepted unsafe URL %q", raw)
		}
	}
}
