package steamexec

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestFailedSteamOutputStaysBoundedAndPrivate(t *testing.T) {
	executor, docker := fixture(t)
	docker.mutate = func(_ context.Context, out io.Writer) error {
		_, _ = io.WriteString(out, strings.Repeat("operator diagnostic\n", 6000))
		return errors.New("fixture failure")
	}
	event := terminal(t, execute(executor, req("update")))
	if event.Type != "error" || strings.Contains(event.Error, "operator diagnostic") {
		t.Fatal("raw Steam output escaped to the client")
	}
	file := filepath.Join(executor.journal, phaseID(req("update"))+".log")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || len(data) > 64<<10 {
		t.Fatalf("diagnostic size=%d", len(data))
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("diagnostic permissions=%o", info.Mode().Perm())
	}
}
