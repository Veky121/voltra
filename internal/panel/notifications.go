package panel

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// queueNotification snapshots mail content before the referenced account, grant or
// server can be deleted. SMTP availability never prevents enqueueing a notification.
func (a *App) queueNotification(ctx context.Context, user, server M, event string) error {
	return a.queueNotificationUsing(ctx, a.DB, user, server, event)
}
func (a *App) queueNotificationTx(ctx context.Context, tx pgx.Tx, user, server M, event string) error {
	return a.queueNotificationUsing(ctx, tx, user, server, event)
}

type notificationExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (a *App) queueNotificationUsing(ctx context.Context, executor notificationExecutor, user, server M, event string) error {
	switch event {
	case "server.installed", "server.reinstalled", "server.added", "server.removed", "account.created":
	default:
		return bad("Unsupported notification event.")
	}
	email := str(user["email"])
	address, e := mail.ParseAddress(email)
	if e != nil || address.Address != email || strings.ContainsAny(email, "\r\n") {
		return bad("The notification recipient does not have a valid email address.")
	}
	if event == "server.installed" || event == "server.reinstalled" {
		key := "pterodactyl:email:send_install_notification"
		if event == "server.reinstalled" {
			key = "pterodactyl:email:send_reinstall_notification"
		}
		var enabled bool
		e = executor.QueryRow(ctx, "SELECT value='true'::jsonb FROM settings WHERE key=$1", key).Scan(&enabled)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		if e == nil && !enabled {
			return nil
		}
	}
	subject, body := a.notificationContent(user, server, event)
	var dedupe any
	cycle := str(server["_notification_key"])
	if cycle == "" && (event == "server.installed" || event == "server.reinstalled") {
		if installedAt, ok := server["installed_at"].(time.Time); ok {
			cycle = installedAt.UTC().Format(time.RFC3339Nano)
		} else {
			cycle = str(server["installed_at"])
		}
		if cycle == "" {
			cycle = str(server["created_at"])
		}
		if cycle == "" {
			return bad("Install notifications require a stable installation timestamp.")
		}
	}
	if cycle != "" {
		digest := sha256.Sum256([]byte(event + "\x00" + str(user["uuid"]) + "\x00" + str(server["uuid"]) + "\x00" + cycle))
		dedupe = hex.EncodeToString(digest[:])
	}
	var userID, serverID any
	if num(user["id"]) > 0 {
		userID = user["id"]
	}
	if num(server["id"]) > 0 {
		serverID = server["id"]
	}
	payload := M{"recipient": email, "subject": subject, "body": body, "server_name": str(server["name"]), "server_uuid": str(server["uuid"])}
	_, e = executor.Exec(ctx, "INSERT INTO notification_jobs(user_id,server_id,event,dedupe_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO NOTHING", userID, serverID, event, dedupe, payload)
	return e
}

func (a *App) notificationContent(user, server M, event string) (string, string) {
	name := str(user["name_first"])
	if name == "" {
		name = str(user["username"])
	}
	serverName := str(server["name"])
	base := strings.TrimRight(a.Config.PublicURL, "/")
	subject := ""
	message := ""
	link := base
	switch event {
	case "server.installed", "server.reinstalled":
		subject = "Your server is ready"
		message = "Your server has finished installing and is ready to use."
	case "server.added":
		subject = "You have been added to a server"
		message = "You have been added as a subuser and can now access the server with the permissions its administrator assigned."
		identifier := str(server["uuid_short"])
		if identifier == "" {
			identifier = str(server["identifier"])
		}
		link = base + "/server/" + identifier
	case "server.removed":
		subject = "Your server access has been removed"
		message = "You have been removed as a subuser and no longer have access to this server."
	case "account.created":
		subject = "Your panel account is ready"
		message = "Your panel account has been created. Your administrator manages sign-in through the panel's identity provider."
	}
	body := "Hello " + name + ",\r\n\r\n" + message + "\r\n"
	if serverName != "" {
		body += "\r\nServer name: " + serverName + "\r\n"
	}
	body += "\r\nOpen panel: " + link + "\r\n"
	return subject, body
}

// RunNotifications recovers expired work leases after a process restart. Work is
// claimed in PostgreSQL so separate app workers cannot deliver the same lease.
func (a *App) RunNotifications(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		for i := 0; i < 20 && ctx.Err() == nil; i++ {
			worked, e := a.processNotification(ctx)
			if e != nil && !errors.Is(e, context.Canceled) {
				slog.Error("notification worker failed", "error", e)
				break
			}
			if !worked {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *App) processNotification(ctx context.Context) (bool, error) {
	lease := randomToken(16)
	job, e := a.one(ctx, `UPDATE notification_jobs SET status='sending',attempts=attempts+1,lock_token=$1,locked_until=now()+interval '120 seconds',updated_at=now()
 WHERE id=(SELECT id FROM notification_jobs WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND locked_until<now()) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, lease)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	settings, e := a.infraLoadSettings(ctx)
	if e != nil {
		return true, a.retryNotification(ctx, job, lease, "Panel settings could not be loaded.", notificationRetry(num(job["attempts"])))
	}
	if str(settings["mail:host"]) == "" {
		return true, a.retryNotification(ctx, job, lease, "SMTP is not configured. The notification remains queued.", 5*time.Minute)
	}
	payload := asMap(job["payload"])
	if e = a.sendNotification(ctx, str(payload["recipient"]), str(payload["subject"]), str(payload["body"])); e != nil {
		// Persist a safe diagnostic; SMTP server responses must not leak credentials.
		retryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		return true, a.retryNotification(retryCtx, job, lease, "SMTP delivery failed. Check the SMTP address, encryption, credentials and sender permissions.", notificationRetry(num(job["attempts"])))
	}
	doneCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	e = a.exec(doneCtx, "UPDATE notification_jobs SET status='sent',delivered_at=now(),last_error=NULL,locked_until=NULL,lock_token=NULL,updated_at=now() WHERE id=$1 AND lock_token=$2 AND status='sending'", job["id"], lease)
	return true, e
}
func notificationRetry(attempt int64) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 8 {
		attempt = 8
	}
	delay := 30 * time.Second * time.Duration(int64(1)<<(attempt-1))
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}
func (a *App) retryNotification(ctx context.Context, job M, lease, detail string, delay time.Duration) error {
	e := a.exec(ctx, "UPDATE notification_jobs SET status='pending',next_attempt_at=now()+($3*interval '1 second'),last_error=$4,locked_until=NULL,lock_token=NULL,updated_at=now() WHERE id=$1 AND lock_token=$2 AND status='sending'", job["id"], lease, int64(delay/time.Second), detail)
	if e == nil {
		slog.Warn("notification delivery deferred", "job_id", job["id"], "event", job["event"], "attempts", job["attempts"], "retry_seconds", int64(delay/time.Second), "reason", detail)
	}
	return e
}

func (a *App) registerNotifications(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/notifications", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.requireAdmin(r); e != nil {
			fail(w, e)
			return
		}
		jobs, e := a.query(r.Context(), "SELECT id,user_id,server_id,event,status,attempts,next_attempt_at,last_error,delivered_at,created_at,updated_at,payload->>'recipient' AS recipient,payload->>'subject' AS subject FROM notification_jobs ORDER BY id DESC")
		if e != nil {
			fail(w, e)
			return
		}
		infraPage(w, r, "notification", jobs)
	})
	mux.HandleFunc("POST /api/admin/notifications/{job}/retry", func(w http.ResponseWriter, r *http.Request) {
		if _, e := a.requireAdmin(r); e != nil {
			fail(w, e)
			return
		}
		id, e := infraID(r.PathValue("job"))
		if e != nil {
			fail(w, e)
			return
		}
		job, e := a.one(r.Context(), "SELECT * FROM notification_jobs WHERE id=$1", id)
		if e != nil {
			fail(w, e)
			return
		}
		if str(job["status"]) != "pending" {
			fail(w, bad("Only pending notifications can be retried."))
			return
		}
		if e = a.exec(r.Context(), "UPDATE notification_jobs SET next_attempt_at=now(),updated_at=now() WHERE id=$1 AND status='pending'", id); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, M{"queued": true, "id": id})
	})
}
