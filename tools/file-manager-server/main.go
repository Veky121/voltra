// Local file-manager acceptance server. It deliberately starts no schedulers,
// Steam jobs or node reconnect workers. Use a loopback listen address only.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"voltra/internal/panel"
)

func main() {
	cfg := panel.Config{Listen: "127.0.0.1:8098", PublicURL: "http://127.0.0.1:8098", DatabaseURL: os.Getenv("DATABASE_URL"), EncryptionKey: os.Getenv("ENCRYPTION_KEY"), WebDir: ".local/file-manager/web", Timezone: "UTC", DevMode: true, DevUserID: 1}
	app, err := panel.New(context.Background(), cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer app.Close()
	log.Printf("File-manager acceptance server listening at %s; no background workers", cfg.Listen)
	handler := app.Handler()
	delay, _ := strconv.Atoi(os.Getenv("FILE_MANAGER_PATCH_DELAY_MS"))
	server := &http.Server{Addr: cfg.Listen, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if delay > 0 && r.Method == http.MethodPatch && strings.Contains(r.URL.Path, "/files/transfers/") {
			select {
			case <-time.After(time.Duration(delay) * time.Millisecond):
			case <-r.Context().Done():
				return
			}
		}
		handler.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(server.ListenAndServe())
}
