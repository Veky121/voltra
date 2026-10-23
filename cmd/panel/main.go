package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	"voltra/internal/panel"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	id, _ := strconv.ParseInt(env("DEV_USER_ID", "1"), 10, 64)
	cfg := panel.Config{ArtworkDirectory: os.Getenv("ARTWORK_DIRECTORY"), Listen: env("LISTEN", "127.0.0.1:8088"), DatabaseURL: os.Getenv("DATABASE_URL"), PublicURL: env("PUBLIC_URL", "http://127.0.0.1:8088"), DaemonURL: os.Getenv("DAEMON_URL"), WebDir: env("WEB_DIR", "web/dist"), LocalesDir: os.Getenv("LOCALES_DIR"), EncryptionKey: os.Getenv("ENCRYPTION_KEY"), Timezone: env("APP_TIMEZONE", "UTC"), DevMode: os.Getenv("DEV_MODE") == "true", DevUserID: id}
	if cfg.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	app, err := panel.New(ctx, cfg)
	if err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
	defer app.Close()
	if len(os.Args) > 1 {
		if err = app.RunCommand(ctx, os.Args[1:], os.Stdout); err != nil {
			slog.Error("command failed", "error", err)
			os.Exit(1)
		}
		return
	}
	if err = app.SeedDevelopment(ctx); err != nil {
		slog.Error("development seed failed", "error", err)
		os.Exit(1)
	}
	if err = app.StartConfiguredHTTPS(ctx); err != nil {
		slog.Error("HTTPS setup could not be restored", "error", err)
		os.Exit(1)
	}
	if cfg.DevMode {
		slog.Warn("Local development identity is enabled; loopback browser requests act as the selected development user.")
	}
	go app.RunScheduler(ctx)
	go app.RunNotifications(ctx)
	go app.RunRevocations(ctx)
	go app.RunSteamJobs(ctx)
	go func() {
		timer := time.NewTicker(30 * time.Minute)
		defer timer.Stop()
		for {
			if _, err := app.PruneStaleBackups(ctx); err != nil {
				slog.Error("stale backup cleanup failed", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
		}
	}()
	srv := &http.Server{Addr: cfg.Listen, Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("panel listening", "address", cfg.Listen)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("HTTP server failed", "error", err)
		os.Exit(1)
	}
}
