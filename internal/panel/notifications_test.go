package panel

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func notificationSMTP(t *testing.T) (int, <-chan string) {
	t.Helper()
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { listener.Close() })
	messages := make(chan string, 32)
	go func() {
		for {
			conn, e := listener.Accept()
			if e != nil {
				return
			}
			go func() {
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				reader := bufio.NewReader(conn)
				fmt.Fprint(conn, "220 notification SMTP\r\n")
				dataMode := false
				var message strings.Builder
				for {
					line, e := reader.ReadString('\n')
					if e != nil {
						return
					}
					if dataMode {
						if line == ".\r\n" {
							dataMode = false
							messages <- message.String()
							fmt.Fprint(conn, "250 accepted\r\n")
						} else {
							message.WriteString(line)
						}
						continue
					}
					switch {
					case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
						fmt.Fprint(conn, "250 notification-test\r\n")
					case strings.HasPrefix(line, "MAIL FROM:"), strings.HasPrefix(line, "RCPT TO:"):
						fmt.Fprint(conn, "250 ok\r\n")
					case strings.HasPrefix(line, "DATA"):
						dataMode = true
						fmt.Fprint(conn, "354 begin\r\n")
					case strings.HasPrefix(line, "QUIT"):
						fmt.Fprint(conn, "221 bye\r\n")
						return
					default:
						fmt.Fprint(conn, "500 unsupported\r\n")
					}
				}
			}()
		}
	}()
	_, portString, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portString)
	return port, messages
}

func notificationFixture(t *testing.T, a *App, userID int64) (M, M) {
	t.Helper()
	user, e := a.one(context.Background(), "SELECT * FROM users WHERE id=$1", userID)
	if e != nil {
		t.Fatal(e)
	}
	server := M{"uuid": newUUID(), "uuid_short": "abcd1234", "name": "Notification game", "installed_at": time.Now().UTC(), "created_at": time.Now().UTC()}
	return user, server
}

func TestNotificationsPersistRetryAndRestart(t *testing.T) {
	a, handler, userID := infraTestApp(t)
	ctx := context.Background()
	user, server := notificationFixture(t, a, userID)
	if e := a.queueNotification(ctx, user, server, "server.installed"); e != nil {
		t.Fatal(e)
	}
	if e := a.queueNotification(ctx, user, server, "server.installed"); e != nil {
		t.Fatal(e)
	}
	count, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM notification_jobs")
	if e != nil || num(count["count"]) != 1 {
		t.Fatal("duplicate install callback enqueued duplicate notification")
	}
	worked, e := a.processNotification(ctx)
	if e != nil || !worked {
		t.Fatalf("unconfigured SMTP processing: worked=%v err=%v", worked, e)
	}
	job, e := a.one(ctx, "SELECT * FROM notification_jobs")
	if e != nil {
		t.Fatal(e)
	}
	if str(job["status"]) != "pending" || num(job["attempts"]) != 1 || !strings.Contains(str(job["last_error"]), "not configured") {
		t.Fatalf("unconfigured SMTP lost queue state: %v", job)
	}
	restarted := &App{DB: a.DB, Config: a.Config, HTTP: a.HTTP}
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"mail:host": "127.0.0.1", "mail:port": 1, "mail:encryption": "none"}, 200)
	if e = a.exec(ctx, "UPDATE notification_jobs SET next_attempt_at=now()"); e != nil {
		t.Fatal(e)
	}
	worked, e = restarted.processNotification(ctx)
	if e != nil || !worked {
		t.Fatalf("failed delivery processing: %v %v", worked, e)
	}
	job, e = a.one(ctx, "SELECT * FROM notification_jobs")
	if e != nil {
		t.Fatal(e)
	}
	if str(job["status"]) != "pending" || num(job["attempts"]) != 2 || str(job["last_error"]) == "" {
		t.Fatal("failed delivery was not persisted for retry")
	}
	next := job["next_attempt_at"].(time.Time)
	if time.Until(next) < 50*time.Second {
		t.Fatal("retry did not apply exponential delay")
	}
	port, messages := notificationSMTP(t)
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"mail:port": port}, 200)
	if e = a.exec(ctx, "UPDATE notification_jobs SET next_attempt_at=now()"); e != nil {
		t.Fatal(e)
	}
	worked, e = restarted.processNotification(ctx)
	if e != nil || !worked {
		t.Fatalf("retry delivery: %v %v", worked, e)
	}
	job, e = a.one(ctx, "SELECT * FROM notification_jobs")
	if e != nil || str(job["status"]) != "sent" || job["delivered_at"] == nil || job["last_error"] != nil || num(job["attempts"]) != 3 {
		t.Fatalf("sent delivery not persisted: %v %v", job, e)
	}
	select {
	case message := <-messages:
		if !strings.Contains(message, "Notification game") || !strings.Contains(message, "Your server is ready") {
			t.Fatalf("notification content incorrect: %s", message)
		}
	case <-time.After(time.Second):
		t.Fatal("SMTP did not receive notification")
	}
	worked, e = restarted.processNotification(ctx)
	if e != nil || worked {
		t.Fatal("sent notification claimed twice")
	}
}

func TestNotificationsConcurrentClaimsAndLeaseRecovery(t *testing.T) {
	a, handler, userID := infraTestApp(t)
	ctx := context.Background()
	user, server := notificationFixture(t, a, userID)
	port, messages := notificationSMTP(t)
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"mail:host": "127.0.0.1", "mail:port": port, "mail:encryption": "none"}, 200)
	for _, event := range []string{"server.installed", "server.added", "server.removed"} {
		if e := a.queueNotification(ctx, user, server, event); e != nil {
			t.Fatal(e)
		}
	}
	if e := a.exec(ctx, "UPDATE notification_jobs SET status='sending',lock_token='previous-process',locked_until=now()-interval '1 minute' WHERE event='server.installed'"); e != nil {
		t.Fatal(e)
	}
	workersCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var workers sync.WaitGroup
	workers.Add(2)
	for i := 0; i < 2; i++ {
		go func() { defer workers.Done(); a.RunNotifications(workersCtx) }()
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		row, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM notification_jobs WHERE status='sent'")
		if e != nil {
			t.Fatal(e)
		}
		if num(row["count"]) == 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("notifications not drained: %v", row)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	workers.Wait()
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		select {
		case message := <-messages:
			for _, subject := range []string{"Your server is ready", "You have been added to a server", "Your server access has been removed"} {
				if strings.Contains(message, "Subject: "+subject) {
					if seen[subject] {
						t.Fatal("multiple workers delivered duplicate notification")
					}
					seen[subject] = true
				}
			}
		case <-time.After(time.Second):
			t.Fatal("missing SMTP delivery")
		}
	}
	if len(seen) != 3 {
		t.Fatalf("missing notification types %v", seen)
	}
}

func TestNotificationsFlagsAndAdminRetry(t *testing.T) {
	a, handler, userID := infraTestApp(t)
	ctx := context.Background()
	user, server := notificationFixture(t, a, userID)
	infraExpect(t, handler, userID, "PATCH", "/api/admin/settings", M{"pterodactyl:email:send_install_notification": false}, 200)
	if e := a.queueNotification(ctx, user, server, "server.installed"); e != nil {
		t.Fatal(e)
	}
	count, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM notification_jobs")
	if e != nil || num(count["count"]) != 0 {
		t.Fatal("disabled install notification was queued")
	}
	if e = a.queueNotification(ctx, user, server, "server.reinstalled"); e != nil {
		t.Fatal(e)
	}
	worked, e := a.processNotification(ctx)
	if e != nil || !worked {
		t.Fatal(e)
	}
	job, e := a.one(ctx, "SELECT * FROM notification_jobs")
	if e != nil {
		t.Fatal(e)
	}
	infraExpect(t, handler, userID, "POST", fmt.Sprintf("/api/admin/notifications/%d/retry", num(job["id"])), nil, 200)
	list := infraExpect(t, handler, userID, "GET", "/api/admin/notifications", nil, 200)
	if len(asSlice(list["data"])) != 1 {
		t.Fatal("admin queue list missing notification")
	}
	if notificationRetry(1) != 30*time.Second || notificationRetry(2) != time.Minute || notificationRetry(100) != time.Hour {
		t.Fatal("notification retry delay incorrect")
	}
}

func TestNotificationsTransactionRollbackAndCommit(t *testing.T) {
	a, _, _ := infraTestApp(t)
	ctx := context.Background()
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	user := M{"uuid": newUUID(), "email": "new-account@example.invalid", "username": "new-account"}
	var userID int64
	if e = tx.QueryRow(ctx, "INSERT INTO users(uuid,email,username) VALUES($1,$2,$3) RETURNING id", user["uuid"], user["email"], user["username"]).Scan(&userID); e != nil {
		t.Fatal(e)
	}
	user["id"] = userID
	if e = a.queueNotificationTx(ctx, tx, user, nil, "account.created"); e != nil {
		t.Fatal(e)
	}
	if e = tx.Rollback(ctx); e != nil {
		t.Fatal(e)
	}
	count, e := a.one(ctx, "SELECT COUNT(*)::bigint AS count FROM notification_jobs")
	if e != nil || num(count["count"]) != 0 {
		t.Fatal("rolled back account creation left a notification")
	}
	tx, e = a.DB.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if e = tx.QueryRow(ctx, "INSERT INTO users(uuid,email,username) VALUES($1,$2,$3) RETURNING id", user["uuid"], user["email"], user["username"]).Scan(&userID); e != nil {
		t.Fatal(e)
	}
	user["id"] = userID
	if e = a.queueNotificationTx(ctx, tx, user, nil, "account.created"); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	job, e := a.one(ctx, "SELECT * FROM notification_jobs")
	if e != nil || num(job["user_id"]) != userID {
		t.Fatal("account and notification were not committed atomically")
	}
	body := str(asMap(job["payload"])["body"])
	if strings.Contains(body, "/auth/") || strings.Contains(body, "password") {
		t.Fatal("welcome notification contains local login/password instructions")
	}
}
