package panel

import (
	"context"
	"crypto/md5"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/adhocore/gronx"
	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
)

func (a *App) registerCollaboration(mux *http.ServeMux) {
	for _, p := range []string{"GET /api/client/servers/{server}/users", "POST /api/client/servers/{server}/users", "GET /api/client/servers/{server}/users/{user}", "POST /api/client/servers/{server}/users/{user}", "DELETE /api/client/servers/{server}/users/{user}"} {
		mux.HandleFunc(p, a.collabUsers)
	}
	for _, p := range []string{"GET /api/client/servers/{server}/schedules", "POST /api/client/servers/{server}/schedules", "GET /api/client/servers/{server}/schedules/{schedule}", "POST /api/client/servers/{server}/schedules/{schedule}", "DELETE /api/client/servers/{server}/schedules/{schedule}", "POST /api/client/servers/{server}/schedules/{schedule}/execute"} {
		mux.HandleFunc(p, a.collabSchedules)
	}
	for _, p := range []string{"POST /api/client/servers/{server}/schedules/{schedule}/tasks", "POST /api/client/servers/{server}/schedules/{schedule}/tasks/{task}", "DELETE /api/client/servers/{server}/schedules/{schedule}/tasks/{task}"} {
		mux.HandleFunc(p, a.collabTasks)
	}
	for _, prefix := range []string{"/api/client", "/api/application"} {
		for _, p := range []string{"GET " + prefix + "/servers/{server}/databases", "POST " + prefix + "/servers/{server}/databases", "GET " + prefix + "/servers/{server}/databases/{database}", "DELETE " + prefix + "/servers/{server}/databases/{database}"} {
			mux.HandleFunc(p, a.collabDatabases)
		}
	}
	mux.HandleFunc("POST /api/client/servers/{server}/databases/{database}/rotate-password", a.collabDatabases)
	mux.HandleFunc("POST /api/application/servers/{server}/databases/{database}/reset-password", a.collabDatabases)
	mux.HandleFunc("GET /api/client/account/activity", a.collabActivity)
	mux.HandleFunc("GET /api/client/servers/{server}/activity", a.collabActivity)
}

func collabJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func collabID(v string) int64 { n, _ := strconv.ParseInt(v, 10, 64); return n }
func (a *App) collabSetting(ctx context.Context, key string, fallback any) any {
	row, err := a.one(ctx, "SELECT value FROM settings WHERE key=$1", key)
	if err != nil {
		return fallback
	}
	return row["value"]
}
func collabUser(u M) M {
	h := md5.Sum([]byte(strings.ToLower(str(u["email"]))))
	return M{"id": u["id"], "uuid": u["uuid"], "identifier": u["uuid"], "username": u["username"], "email": u["email"], "image": "https://gravatar.com/avatar/" + hex.EncodeToString(h[:]), "2fa_enabled": false, "created_at": u["created_at"], "permissions": u["permissions"]}
}

func (a *App) collabUsers(w http.ResponseWriter, r *http.Request) {
	perm := "user.read"
	if r.Method == "POST" {
		perm = "user.create"
		if r.PathValue("user") != "" {
			perm = "user.update"
		}
	}
	if r.Method == "DELETE" {
		perm = "user.delete"
	}
	s, err := a.server(r, perm)
	if err != nil {
		fail(w, err)
		return
	}
	actor, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	if r.Method == "GET" {
		q := "SELECT u.*,su.permissions FROM subusers su JOIN users u ON u.id=su.user_id WHERE su.server_id=$1"
		args := []any{s["id"]}
		if r.PathValue("user") == "" {
			q = "SELECT u.*,su.permissions,(u.id=$2) AS server_owner FROM users u LEFT JOIN subusers su ON su.user_id=u.id AND su.server_id=$1 WHERE su.id IS NOT NULL OR u.id=$2 OR (u.root_admin AND NOT u.disabled)"
			args = append(args, s["owner_id"])
		}
		if r.PathValue("user") != "" {
			q += " AND (u.uuid=$2 OR u.id::text=$2)"
			args = append(args, r.PathValue("user"))
		}
		q += " ORDER BY u.id"
		rows, e := a.query(ctx, q, args...)
		if e != nil {
			fail(w, e)
			return
		}
		for i := range rows {
			user := rows[i]
			rows[i] = collabUser(user)
			rows[i]["is_owner"] = boolean(user["server_owner"])
			rows[i]["is_admin"] = boolean(user["root_admin"])
			rows[i]["is_current_user"] = num(user["id"]) == num(actor["id"])
			rows[i]["inherited_access"] = boolean(user["server_owner"]) || boolean(user["root_admin"])
		}
		if r.PathValue("user") != "" {
			if len(rows) == 0 {
				fail(w, notFound())
				return
			}
			writeJSON(w, 200, item("server_subuser", rows[0]))
			return
		}
		writeJSON(w, 200, collection("server_subuser", rows))
		return
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	// Serialize permission changes against the server, including duplicate invitations.
	if _, err = tx.Exec(ctx, "SELECT id FROM servers WHERE id=$1 FOR UPDATE", s["id"]); err != nil {
		fail(w, err)
		return
	}
	var target M
	if r.PathValue("user") != "" {
		rows, e := tx.Query(ctx, "SELECT u.*,su.id AS subuser_id,su.permissions FROM subusers su JOIN users u ON u.id=su.user_id WHERE su.server_id=$1 AND (u.uuid=$2 OR u.id::text=$2)", s["id"], r.PathValue("user"))
		if e != nil {
			fail(w, e)
			return
		}
		rr, e := pgx.CollectRows(rows, pgx.RowToMap)
		if e != nil {
			fail(w, e)
			return
		}
		if len(rr) == 0 {
			fail(w, notFound())
			return
		}
		target = M(rr[0])
		if num(target["id"]) == num(actor["id"]) {
			fail(w, forbidden())
			return
		}
	}
	if r.Method == "DELETE" {
		if err = a.queueRevocationTx(ctx, tx, s, target); err != nil {
			fail(w, err)
			return
		}
		_, err = tx.Exec(ctx, "DELETE FROM subusers WHERE id=$1", target["subuser_id"])
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			fail(w, err)
			return
		}
		a.audit(ctx, num(actor["id"]), num(s["id"]), "server:subuser.delete", M{"email": target["email"]})
		w.WriteHeader(204)
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	permissions, err := a.collabPermissions(ctx, actor, s, d["permissions"])
	if err != nil {
		fail(w, err)
		return
	}
	createdSubuser := target == nil
	if target == nil {
		email := strings.ToLower(strings.TrimSpace(str(d["email"])))
		addr, e := mail.ParseAddress(email)
		if e != nil || addr.Address != email || len(email) > 191 {
			fail(w, bad("A valid email address is required to identify the account."))
			return
		}
		rows, e := tx.Query(ctx, "SELECT * FROM users WHERE lower(email)=$1", email)
		if e != nil {
			fail(w, e)
			return
		}
		rr, e := pgx.CollectRows(rows, pgx.RowToMap)
		if e != nil {
			fail(w, e)
			return
		}
		if len(rr) > 0 {
			target = M(rr[0])
		} else {
			username := "user_" + strings.ToLower(randomToken(6)) + "0"
			rows, e = tx.Query(ctx, "INSERT INTO users(uuid,username,email,name_first,name_last) VALUES($1,$2,$3,'','') RETURNING *", newUUID(), username, email)
			if e != nil {
				fail(w, e)
				return
			}
			rr, e = pgx.CollectRows(rows, pgx.RowToMap)
			if e != nil {
				fail(w, e)
				return
			}
			target = M(rr[0])
		}
		if num(target["id"]) == num(s["owner_id"]) || num(target["id"]) == num(actor["id"]) {
			fail(w, bad("The server owner and current user cannot be invited as subusers."))
			return
		}
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM subusers WHERE server_id=$1 AND user_id=$2)", s["id"], target["id"]).Scan(&exists); err != nil {
			fail(w, err)
			return
		}
		if exists {
			fail(w, bad("This account is already a subuser."))
			return
		}
		var subuserID int64
		err = tx.QueryRow(ctx, "INSERT INTO subusers(server_id,user_id,permissions) VALUES($1,$2,$3::jsonb) RETURNING id", s["id"], target["id"], collabJSON(permissions)).Scan(&subuserID)
	} else {
		if err = a.queueRevocationTx(ctx, tx, s, target); err != nil {
			fail(w, err)
			return
		}
		_, err = tx.Exec(ctx, "UPDATE subusers SET permissions=$1::jsonb,updated_at=now() WHERE id=$2", collabJSON(permissions), target["subuser_id"])
	}
	if err == nil && createdSubuser {
		err = a.queueRevocationTx(ctx, tx, s, target)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		fail(w, err)
		return
	}
	target["permissions"] = permissions
	event := "server:subuser.update"
	if createdSubuser {
		event = "server:subuser.create"
	}
	a.audit(ctx, num(actor["id"]), num(s["id"]), event, M{"email": target["email"], "permissions": permissions})
	writeJSON(w, 200, item("server_subuser", collabUser(target)))
}

var collabPermissionNames = strings.Fields("websocket.connect control.console control.start control.stop control.restart database.read database.create database.update database.delete database.view_password schedule.read schedule.create schedule.update schedule.delete user.read user.create user.update user.delete backup.read backup.create backup.delete backup.download backup.restore allocation.read allocation.create allocation.update allocation.delete file.read file.read-content file.create file.update file.delete file.archive file.sftp startup.read startup.update startup.docker-image settings.rename settings.reinstall activity.read")

func (a *App) collabPermissions(ctx context.Context, u, s M, raw any) ([]string, error) {
	values, ok := raw.([]any)
	if !ok {
		if ss, yes := raw.([]string); yes {
			values = make([]any, len(ss))
			for i, v := range ss {
				values[i] = v
			}
		} else {
			return nil, bad("permissions must be an array")
		}
	}
	valid := map[string]bool{}
	for _, p := range collabPermissionNames {
		valid[p] = true
	}
	set := map[string]bool{"websocket.connect": true}
	for _, v := range values {
		p, ok := v.(string)
		if !ok || !valid[p] {
			return nil, bad("Unknown server permission: " + str(v))
		}
		if !a.can(ctx, u, s, p) {
			return nil, forbidden()
		}
		set[p] = true
	}
	out := []string{}
	for p := range set {
		out = append(out, p)
	}
	sort.Strings(out)
	return out, nil
}
func (a *App) collabRevoke(ctx context.Context, s, u M) error {
	n, err := a.node(ctx, num(s["node_id"]))
	if err != nil {
		return err
	}
	resp, err := a.daemon(ctx, n, "POST", "/api/deauthorize-user", M{"user": u["uuid"], "servers": []string{str(s["uuid"])}})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

type collabCronSchedule string

func (expression collabCronSchedule) Next(after time.Time) time.Time {
	location := after.Location()
	if location == time.UTC {
		next, err := gronx.NextTickAfter(string(expression), after, false)
		if err != nil {
			return time.Time{}
		}
		return next
	}
	// Calculate matching civil times in UTC, then map them into the configured
	// zone. Direct calendar arithmetic in gronx skips spring gaps and cannot
	// distinguish the two occurrences of a fall-back minute.
	_, minOffset, maxOffset := collabZoneOffsets(after, location)
	civil := collabCivilTime(after).Add(-time.Duration(maxOffset-minOffset) * time.Second)
	var best time.Time
	for attempts := 0; attempts < 5000; attempts++ {
		candidate, err := gronx.NextTickAfter(string(expression), civil, false)
		if err != nil {
			return best
		}
		offsets, _, largestOffset := collabZoneOffsets(candidate, location)
		if !best.IsZero() && !time.Unix(candidate.Unix()-int64(largestOffset), int64(candidate.Nanosecond())).Before(best) {
			return best
		}
		var exact []time.Time
		var forward time.Time
		var forwardCivil time.Time
		for _, offset := range offsets {
			instant := time.Unix(candidate.Unix()-int64(offset), int64(candidate.Nanosecond())).In(location)
			wall := collabCivilTime(instant)
			if wall.Equal(candidate) {
				exact = append(exact, instant)
			} else if wall.After(candidate) && (forward.IsZero() || wall.Before(forwardCivil)) {
				forward, forwardCivil = instant, wall
			}
		}
		// Native PHP CronExpression accepts the missing hourly slot after a
		// one-hour spring jump. Its hour-field fallback does not apply to a
		// half-hour jump, such as Australia/Lord_Howe, which skips that slot.
		if len(exact) == 0 && !forward.IsZero() && forwardCivil.Sub(candidate) == time.Hour {
			exact = append(exact, forward)
		}
		for _, instant := range exact {
			if instant.After(after) && (best.IsZero() || instant.Before(best)) {
				best = instant
			}
		}
		civil = candidate
	}
	return best
}

func collabCivilTime(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
}
func collabZoneOffsets(near time.Time, location *time.Location) ([]int, int, int) {
	set := map[int]bool{}
	min, max := 86400, -86400
	for _, hours := range []int{-48, -24, 0, 24, 48} {
		_, offset := near.Add(time.Duration(hours) * time.Hour).In(location).Zone()
		set[offset] = true
		if offset < min {
			min = offset
		}
		if offset > max {
			max = offset
		}
	}
	offsets := make([]int, 0, len(set))
	for offset := range set {
		offsets = append(offsets, offset)
	}
	return offsets, min, max
}

func (a *App) collabNextRun(ctx context.Context, expression collabCronSchedule, after time.Time) (time.Time, error) {
	location, err := a.timezone(ctx)
	if err != nil {
		return time.Time{}, err
	}
	return expression.Next(after.In(location)), nil
}
func collabCron(d M) (collabCronSchedule, error) {
	parts := []string{}
	for _, k := range []string{"minute", "hour", "day_of_month", "month", "day_of_week"} {
		v := str(d[k])
		if strings.TrimSpace(v) == "" || strings.ContainsAny(v, "\r\n\t ") {
			return "", bad("All five cron fields are required and must contain a single field.")
		}
		parts = append(parts, v)
	}
	expression := strings.Join(parts, " ")
	if !gronx.IsValid(expression) {
		return "", bad("Invalid cron expression.")
	}
	return collabCronSchedule(expression), nil
}
func collabScheduleCron(s M) (collabCronSchedule, error) {
	d := M{}
	for _, k := range []string{"minute", "hour", "day_of_month", "month", "day_of_week"} {
		d[k] = s["cron_"+k]
	}
	return collabCron(d)
}
func (a *App) collabScheduleView(ctx context.Context, s M) (M, error) {
	d := M{}
	for _, k := range []string{"id", "name", "is_active", "is_processing", "only_when_online", "last_run_at", "next_run_at", "created_at", "updated_at"} {
		d[k] = s[k]
	}
	cr := M{}
	for _, k := range []string{"minute", "hour", "day_of_month", "month", "day_of_week"} {
		cr[k] = s["cron_"+k]
	}
	d["cron"] = cr
	tasks, err := a.query(ctx, "SELECT * FROM tasks WHERE schedule_id=$1 ORDER BY sequence_id,id", s["id"])
	if err != nil {
		return nil, err
	}
	d["relationships"] = M{"tasks": collection("schedule_task", tasks)}
	return d, nil
}

// Live schedule mutations use the worker's run -> schedule lock order. If a
// queue appeared while we waited for the schedule row, restart the transaction
// and lock that run first rather than deadlocking a worker holding its row.
func (a *App) collabLockSchedule(ctx context.Context, id, serverID int64) (pgx.Tx, M, error) {
	for attempt := 0; attempt < 5; attempt++ {
		tx, err := a.DB.Begin(ctx)
		if err != nil {
			return nil, nil, err
		}
		runRows, err := tx.Query(ctx, "SELECT id FROM schedule_runs WHERE schedule_id=$1 AND status IN ('pending','running') FOR UPDATE", id)
		if err != nil {
			tx.Rollback(ctx)
			return nil, nil, err
		}
		runs, err := pgx.CollectRows(runRows, pgx.RowToMap)
		if err != nil {
			tx.Rollback(ctx)
			return nil, nil, err
		}
		rows, err := tx.Query(ctx, "SELECT * FROM schedules WHERE id=$1 AND server_id=$2 FOR UPDATE", id, serverID)
		if err != nil {
			tx.Rollback(ctx)
			return nil, nil, err
		}
		schedules, err := pgx.CollectRows(rows, pgx.RowToMap)
		if err != nil {
			tx.Rollback(ctx)
			return nil, nil, err
		}
		if len(schedules) == 0 {
			tx.Rollback(ctx)
			return nil, nil, notFound()
		}
		schedule := M(schedules[0])
		if boolean(schedule["is_processing"]) && len(runs) == 0 {
			tx.Rollback(ctx)
			continue
		}
		return tx, schedule, nil
	}
	return nil, nil, bad("The schedule processing state is inconsistent. Toggle the schedule activation state to reset it.")
}
func (a *App) collabSchedules(w http.ResponseWriter, r *http.Request) {
	perm := "schedule.read"
	if r.Method == "POST" {
		perm = "schedule.create"
		if r.PathValue("schedule") != "" {
			perm = "schedule.update"
		}
	}
	if r.Method == "DELETE" {
		perm = "schedule.delete"
	}
	s, err := a.server(r, perm)
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	var schedule M
	if r.PathValue("schedule") != "" {
		schedule, err = a.one(ctx, "SELECT * FROM schedules WHERE server_id=$1 AND id=$2", s["id"], collabID(r.PathValue("schedule")))
		if err != nil {
			fail(w, err)
			return
		}
	}
	if r.Method == "GET" {
		if schedule != nil {
			out, e := a.collabScheduleView(ctx, schedule)
			if e != nil {
				fail(w, e)
				return
			}
			writeJSON(w, 200, item("server_schedule", out))
			return
		}
		rows, e := a.query(ctx, "SELECT * FROM schedules WHERE server_id=$1 ORDER BY id", s["id"])
		if e != nil {
			fail(w, e)
			return
		}
		for i := range rows {
			rows[i], e = a.collabScheduleView(ctx, rows[i])
			if e != nil {
				fail(w, e)
				return
			}
		}
		writeJSON(w, 200, collection("server_schedule", rows))
		return
	}
	if strings.HasSuffix(r.URL.Path, "/execute") {
		err = a.collabQueueSchedule(ctx, num(schedule["id"]), true)
		if err != nil {
			fail(w, err)
			return
		}
		a.audit(ctx, UserID(r), num(s["id"]), "server:schedule.execute", M{"name": schedule["name"]})
		writeJSON(w, 202, M{})
		return
	}
	if r.Method == "DELETE" {
		tx, _, e := a.collabLockSchedule(ctx, num(schedule["id"]), num(s["id"]))
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, "DELETE FROM schedules WHERE id=$1 AND server_id=$2", schedule["id"], s["id"])
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			fail(w, err)
			return
		}
		a.audit(ctx, UserID(r), num(s["id"]), "server:schedule.delete", M{"name": schedule["name"]})
		w.WriteHeader(204)
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	name := strings.TrimSpace(str(d["name"]))
	if name == "" || len(name) > 191 {
		fail(w, bad("Schedule name must contain 1 to 191 characters."))
		return
	}
	cr, err := collabCron(d)
	if err != nil {
		fail(w, err)
		return
	}
	next, err := a.collabNextRun(ctx, cr, time.Now())
	if err != nil {
		fail(w, err)
		return
	}
	if next.IsZero() {
		fail(w, bad("Cron expression does not have a future execution."))
		return
	}
	data := M{"server_id": s["id"], "name": name, "is_active": boolean(d["is_active"]), "only_when_online": boolean(d["only_when_online"]), "next_run_at": next}
	for _, k := range []string{"minute", "hour", "day_of_month", "month", "day_of_week"} {
		data["cron_"+k] = d[k]
	}
	event := "server:schedule.create"
	if schedule == nil {
		schedule, err = a.insert(ctx, "schedules", data)
	} else {
		event = "server:schedule.update"
		tx, lockedSchedule, e := a.collabLockSchedule(ctx, num(schedule["id"]), num(s["id"]))
		if e != nil {
			fail(w, e)
			return
		}
		defer tx.Rollback(ctx)
		active := boolean(lockedSchedule["is_active"])
		if active != boolean(data["is_active"]) {
			if _, e = tx.Exec(ctx, "UPDATE schedule_runs SET status='failed',last_error='Schedule activation state changed.',updated_at=now() WHERE schedule_id=$1 AND status IN ('pending','running')", schedule["id"]); e != nil {
				fail(w, e)
				return
			}
			if _, e = tx.Exec(ctx, "UPDATE tasks SET is_queued=false,updated_at=now() WHERE schedule_id=$1", schedule["id"]); e != nil {
				fail(w, e)
				return
			}
			if _, e = tx.Exec(ctx, "UPDATE schedules SET is_processing=false WHERE id=$1", schedule["id"]); e != nil {
				fail(w, e)
				return
			}
		}
		rows, e := tx.Query(ctx, "UPDATE schedules SET name=$1,is_active=$2,only_when_online=$3,next_run_at=$4,cron_minute=$5,cron_hour=$6,cron_day_of_month=$7,cron_month=$8,cron_day_of_week=$9,updated_at=now() WHERE id=$10 RETURNING *", name, data["is_active"], data["only_when_online"], next, d["minute"], d["hour"], d["day_of_month"], d["month"], d["day_of_week"], schedule["id"])
		if e != nil {
			fail(w, e)
			return
		}
		rr, e := pgx.CollectRows(rows, pgx.RowToMap)
		if e != nil {
			fail(w, e)
			return
		}
		if len(rr) == 0 {
			fail(w, notFound())
			return
		}
		schedule = M(rr[0])
		err = tx.Commit(ctx)
	}
	if err != nil {
		fail(w, err)
		return
	}
	out, err := a.collabScheduleView(ctx, schedule)
	if err != nil {
		fail(w, err)
		return
	}
	a.audit(ctx, UserID(r), num(s["id"]), event, M{"name": name})
	writeJSON(w, 200, item("server_schedule", out))
}

func collabValidateTask(d M) (string, error) {
	action := str(d["action"])
	payload := str(d["payload"])
	permission := ""
	switch action {
	case "command":
		if strings.TrimSpace(payload) == "" {
			return "", bad("Command payload is required.")
		}
		permission = "control.console"
	case "power":
		switch payload {
		case "start":
			permission = "control.start"
		case "stop", "kill":
			permission = "control.stop"
		case "restart":
			permission = "control.restart"
		default:
			return "", bad("Power action must be start, stop, restart, or kill.")
		}
	case "backup":
		permission = "backup.create"
	default:
		return "", bad("Task action must be command, power, or backup.")
	}
	offset, ok := d["time_offset"]
	seconds, integerErr := strconv.ParseInt(str(offset), 10, 64)
	if !ok || integerErr != nil || seconds < 0 || seconds > 900 {
		return "", bad("time_offset must be between 0 and 900 seconds.")
	}
	if v, ok := offset.(float64); ok && v != float64(num(v)) {
		return "", bad("time_offset must be an integer.")
	}
	if len(payload) > 65535 {
		return "", bad("Task payload is too long.")
	}
	return permission, nil
}
func (a *App) collabTasks(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "schedule.update")
	if err != nil {
		fail(w, err)
		return
	}
	ctx := r.Context()
	tx, _, err := a.collabLockSchedule(ctx, collabID(r.PathValue("schedule")), num(s["id"]))
	if err != nil {
		fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT * FROM tasks WHERE schedule_id=$1 ORDER BY sequence_id,id FOR UPDATE", collabID(r.PathValue("schedule")))
	if err != nil {
		fail(w, err)
		return
	}
	rr, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		fail(w, err)
		return
	}
	idx := -1
	for i, t := range rr {
		if num(t["id"]) == collabID(r.PathValue("task")) {
			idx = i
		}
	}
	if r.PathValue("task") != "" && idx < 0 {
		fail(w, notFound())
		return
	}
	// Move existing sequence numbers out of the positive range before reordering.
	// The database retains its uniqueness constraint throughout the transaction.
	if _, err = tx.Exec(ctx, "UPDATE tasks SET sequence_id=-sequence_id WHERE schedule_id=$1", collabID(r.PathValue("schedule"))); err != nil {
		fail(w, err)
		return
	}
	if r.Method == "DELETE" {
		_, err = tx.Exec(ctx, "DELETE FROM tasks WHERE id=$1", rr[idx]["id"])
		rr = append(rr[:idx], rr[idx+1:]...)
		if err == nil {
			for i, t := range rr {
				_, err = tx.Exec(ctx, "UPDATE tasks SET sequence_id=$1,updated_at=now() WHERE id=$2", i+1, t["id"])
				if err != nil {
					break
				}
			}
		}
		if err == nil {
			// Deleting the exact queued model cancels its pending job. Do not
			// accidentally dispatch whichever task moved into its sequence slot.
			var canceled int64
			tag, e := tx.Exec(ctx, "UPDATE schedule_runs SET status='completed',last_error='Queued task was deleted.',updated_at=now() WHERE schedule_id=$1 AND status IN ('pending','running') AND task_id IS NULL", collabID(r.PathValue("schedule")))
			if e != nil {
				err = e
			} else {
				canceled = tag.RowsAffected()
			}
			if err == nil && canceled > 0 {
				_, err = tx.Exec(ctx, "UPDATE schedules SET is_processing=false,last_run_at=now(),updated_at=now() WHERE id=$1", collabID(r.PathValue("schedule")))
				if err == nil {
					_, err = tx.Exec(ctx, "UPDATE tasks SET is_queued=false WHERE schedule_id=$1", collabID(r.PathValue("schedule")))
				}
			}
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			fail(w, err)
			return
		}
		a.audit(ctx, UserID(r), num(s["id"]), "server:task.delete", M{"id": r.PathValue("task")})
		w.WriteHeader(204)
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	p, err := collabValidateTask(d)
	if err != nil {
		fail(w, err)
		return
	}
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	if !a.can(ctx, u, s, p) {
		fail(w, forbidden())
		return
	}
	if str(d["action"]) == "backup" && num(s["backup_limit"]) < 1 {
		fail(w, bad("Backups are disabled for this server."))
		return
	}
	taskLimit := num(a.collabSetting(ctx, "pterodactyl:client_features:schedules:per_schedule_task_limit", int64(10)))
	if taskLimit < 1 {
		taskLimit = 10
	}
	if idx < 0 && int64(len(rr)) >= taskLimit {
		fail(w, bad(fmt.Sprintf("A schedule may contain at most %d tasks.", taskLimit)))
		return
	}
	sequence := len(rr) + 1
	if idx >= 0 {
		sequence = idx + 1
	}
	if v, ok := d["sequence_id"]; ok {
		sequence = int(num(v))
		if sequence < 1 {
			fail(w, bad("sequence_id must be at least 1."))
			return
		}
	}
	max := len(rr) + 1
	if idx >= 0 {
		max--
	}
	if sequence > max {
		sequence = max
	}
	var taskID int64
	if idx >= 0 {
		taskID = num(rr[idx]["id"])
		rr = append(rr[:idx], rr[idx+1:]...)
		_, err = tx.Exec(ctx, "UPDATE tasks SET action=$1,payload=$2,time_offset=$3,continue_on_failure=$4,updated_at=now() WHERE id=$5", d["action"], str(d["payload"]), num(d["time_offset"]), boolean(d["continue_on_failure"]), taskID)
	} else {
		err = tx.QueryRow(ctx, "INSERT INTO tasks(schedule_id,sequence_id,action,payload,time_offset,continue_on_failure) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", collabID(r.PathValue("schedule")), sequence, d["action"], str(d["payload"]), num(d["time_offset"]), boolean(d["continue_on_failure"])).Scan(&taskID)
	}
	if err != nil {
		fail(w, err)
		return
	}
	rr = append(rr, nil)
	copy(rr[sequence:], rr[sequence-1:])
	rr[sequence-1] = map[string]any{"id": taskID}
	for i, t := range rr {
		_, err = tx.Exec(ctx, "UPDATE tasks SET sequence_id=$1,updated_at=now() WHERE id=$2", i+1, t["id"])
		if err != nil {
			fail(w, err)
			return
		}
	}
	if err = tx.Commit(ctx); err != nil {
		fail(w, err)
		return
	}
	task, err := a.one(ctx, "SELECT * FROM tasks WHERE id=$1", taskID)
	if err != nil {
		fail(w, err)
		return
	}
	a.audit(ctx, UserID(r), num(s["id"]), "server:task.update", M{"action": d["action"], "id": taskID})
	writeJSON(w, 200, item("schedule_task", task))
}

// RunScheduler resumes persisted work on every tick. A transaction row lock is
// held while one task runs so multiple application processes cannot run it together.
// Daemon actions are at-least-once if a process dies after Wings accepts a request.
func (a *App) RunScheduler(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		a.collabSchedulerTick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (a *App) collabQueueSchedule(ctx context.Context, id int64, manual bool) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT * FROM schedules WHERE id=$1 FOR UPDATE", id)
	if err != nil {
		return err
	}
	rr, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return err
	}
	if len(rr) == 0 {
		return notFound()
	}
	s := M(rr[0])
	if boolean(s["is_processing"]) {
		return bad("The schedule is already processing.")
	}
	if !manual && !boolean(s["is_active"]) {
		return nil
	}
	if !manual {
		if due, ok := s["next_run_at"].(time.Time); ok && due.After(time.Now()) {
			return nil
		}
	}
	var taskID, sequence, offset int64
	err = tx.QueryRow(ctx, "SELECT id,sequence_id,time_offset FROM tasks WHERE schedule_id=$1 ORDER BY sequence_id,id LIMIT 1", id).Scan(&taskID, &sequence, &offset)
	if errors.Is(err, pgx.ErrNoRows) {
		return bad("A schedule requires at least one task before execution.")
	}
	if err != nil {
		return err
	}
	cr, err := collabScheduleCron(s)
	if err != nil {
		return err
	}
	next, err := a.collabNextRun(ctx, cr, time.Now())
	if err != nil {
		return err
	}
	if next.IsZero() {
		return bad("Cron expression does not have a future execution.")
	}
	if manual {
		offset = 0
	}
	_, err = tx.Exec(ctx, "INSERT INTO schedule_runs(schedule_id,server_id,task_id,status,next_task_sequence,run_after,manual) VALUES($1,$2,$6,'pending',$3,now()+make_interval(secs=>$4),$5)", id, s["server_id"], sequence, offset, manual, taskID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "UPDATE schedules SET is_processing=true,next_run_at=$1,updated_at=now() WHERE id=$2", next, id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "UPDATE tasks SET is_queued=(id=$1) WHERE schedule_id=$2", taskID, id)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (a *App) collabSchedulerTick(ctx context.Context) {
	due, err := a.query(ctx, "SELECT id FROM schedules WHERE is_active AND NOT is_processing AND next_run_at<=now() AND EXISTS(SELECT 1 FROM tasks WHERE schedule_id=schedules.id) ORDER BY next_run_at LIMIT 100")
	if err == nil {
		for _, s := range due {
			if e := a.collabQueueSchedule(ctx, num(s["id"]), false); e != nil {
				a.audit(ctx, 0, 0, "system:schedule.queue_failed", M{"schedule_id": s["id"], "error": e.Error()})
			}
		}
	}
	for i := 0; i < 100 && ctx.Err() == nil; i++ {
		ran, e := a.collabSchedulerStep(ctx)
		if e != nil {
			a.audit(ctx, 0, 0, "system:schedule.worker_failed", M{"error": e.Error()})
			return
		}
		if !ran {
			return
		}
	}
}
func (a *App) collabSchedulerStep(ctx context.Context) (bool, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, "SELECT * FROM schedule_runs WHERE status IN ('pending','running') AND run_after<=now() ORDER BY run_after,id FOR UPDATE SKIP LOCKED LIMIT 1")
	if err != nil {
		return false, err
	}
	rr, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return false, err
	}
	if len(rr) == 0 {
		return false, nil
	}
	run := M(rr[0])
	sid := num(run["schedule_id"])
	rows, err = tx.Query(ctx, "SELECT * FROM schedules WHERE id=$1 FOR UPDATE", sid)
	if err != nil {
		return true, err
	}
	rr, err = pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return true, err
	}
	if len(rr) == 0 {
		return true, notFound()
	}
	schedule := M(rr[0])
	rows, err = tx.Query(ctx, "SELECT * FROM servers WHERE id=$1", run["server_id"])
	if err != nil {
		return true, err
	}
	rr, err = pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return true, err
	}
	if len(rr) == 0 {
		return true, notFound()
	}
	server := M(rr[0])
	finish := func(status, detail string) error {
		_, e := tx.Exec(ctx, "UPDATE schedule_runs SET status=$1,last_error=NULLIF($2,''),updated_at=now() WHERE id=$3", status, detail, run["id"])
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, "UPDATE tasks SET is_queued=false,updated_at=now() WHERE schedule_id=$1", sid)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, "UPDATE schedules SET is_processing=false,last_run_at=now(),updated_at=now() WHERE id=$1", sid)
		if e != nil {
			return e
		}
		return tx.Commit(ctx)
	}
	if (!boolean(schedule["is_active"]) && !boolean(run["manual"])) || str(server["status"]) != "" {
		return true, finish("failed", "Schedule disabled or server unavailable.")
	}
	rows, err = tx.Query(ctx, "SELECT * FROM tasks WHERE schedule_id=$1 AND id=$2", sid, run["task_id"])
	if err != nil {
		return true, err
	}
	rr, err = pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return true, err
	}
	if len(rr) == 0 {
		return true, finish("completed", "")
	}
	task := M(rr[0])
	var first int64
	if err = tx.QueryRow(ctx, "SELECT min(sequence_id) FROM tasks WHERE schedule_id=$1", sid).Scan(&first); err != nil {
		return true, err
	}
	if boolean(schedule["only_when_online"]) && num(task["sequence_id"]) == first {
		resp, e := a.daemonServer(ctx, server, "GET", "", nil)
		if e != nil {
			return true, finish("failed", "Unable to check server online state: "+e.Error())
		}
		var state M
		e = json.NewDecoder(resp.Body).Decode(&state)
		resp.Body.Close()
		if e != nil {
			return true, finish("failed", e.Error())
		}
		st := str(state["state"])
		if st != "running" && st != "starting" {
			return true, finish("completed", "Skipped because server is offline.")
		}
	}
	_, err = tx.Exec(ctx, "UPDATE schedule_runs SET status='running',updated_at=now() WHERE id=$1", run["id"])
	if err != nil {
		return true, err
	}
	var actionErr error
	switch str(task["action"]) {
	case "power":
		var resp *http.Response
		resp, actionErr = a.daemonServer(ctx, server, "POST", "/power", M{"action": task["payload"]})
		if resp != nil {
			resp.Body.Close()
		}
	case "command":
		var resp *http.Response
		resp, actionErr = a.daemonServer(ctx, server, "POST", "/commands", M{"commands": []string{str(task["payload"])}})
		if resp != nil {
			resp.Body.Close()
		}
	case "backup":
		_, actionErr = a.createBackup(ctx, server, M{"name": "Scheduled backup " + str(schedule["id"]) + " at " + now(), "ignored": strings.Split(str(task["payload"]), "\n"), "truncate": true})
	default:
		actionErr = bad("Unknown task action.")
	}
	if actionErr != nil && !(boolean(task["continue_on_failure"]) && collabDaemonFailure(actionErr)) {
		return true, finish("failed", actionErr.Error())
	}
	_, err = tx.Exec(ctx, "UPDATE tasks SET is_queued=false,updated_at=now() WHERE id=$1", task["id"])
	if err != nil {
		return true, err
	}
	var nextID, nextSeq, offset int64
	err = tx.QueryRow(ctx, "SELECT id,sequence_id,time_offset FROM tasks WHERE schedule_id=$1 AND sequence_id>$2 ORDER BY sequence_id,id LIMIT 1", sid, task["sequence_id"]).Scan(&nextID, &nextSeq, &offset)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, finish("completed", "")
	}
	if err != nil {
		return true, err
	}
	_, err = tx.Exec(ctx, "UPDATE tasks SET is_queued=true,updated_at=now() WHERE id=$1", nextID)
	if err != nil {
		return true, err
	}
	detail := ""
	if actionErr != nil {
		detail = actionErr.Error()
	}
	_, err = tx.Exec(ctx, "UPDATE schedule_runs SET status='pending',next_task_sequence=$1,task_id=$5,run_after=now()+make_interval(secs=>$2),last_error=NULLIF($3,''),updated_at=now() WHERE id=$4", nextSeq, offset, detail, run["id"], nextID)
	if err != nil {
		return true, err
	}
	return true, tx.Commit(ctx)
}

func collabDaemonFailure(err error) bool {
	var value APIError
	if errors.As(err, &value) {
		return value.Code == "DaemonConnectionException" || value.Code == "DaemonRequestException"
	}
	var pointer *APIError
	return errors.As(err, &pointer) && (pointer.Code == "DaemonConnectionException" || pointer.Code == "DaemonRequestException")
}

var collabDBNameRE = regexp.MustCompile(`^[A-Za-z0-9_\-]{1,48}$`)
var collabRemoteRE = regexp.MustCompile(`^[A-Za-z0-9_.:%/\-]{1,255}$`)

func collabDatabaseName(serverID int64, name string) (string, error) {
	if !collabDBNameRE.MatchString(name) {
		return "", bad("Database names must contain 1 to 48 letters, digits, underscores or hyphens.")
	}
	prefix := fmt.Sprintf("s%d_", serverID)
	if strings.HasPrefix(name, prefix) {
		name = strings.TrimPrefix(name, prefix)
	}
	if len(name) > 48-len(prefix) {
		name = name[:48-len(prefix)]
	}
	return prefix + name, nil
}
func collabQuoteIdentifier(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
func collabQuoteString(value string) string {
	return "'" + strings.ReplaceAll(strings.ReplaceAll(value, "\\", "\\\\"), "'", "''") + "'"
}
func collabMySQLError(err error) error {
	if err == nil {
		return nil
	}
	var me *mysql.MySQLError
	if errors.As(err, &me) {
		return APIError{502, "DatabaseHostException", fmt.Sprintf("Database host rejected the operation, MySQL error %d.", me.Number)}
	}
	return APIError{502, "DatabaseHostException", "Unable to connect to or execute the operation on the game database host."}
}
func (a *App) collabMySQL(ctx context.Context, host M) (*sql.DB, error) {
	password, err := a.unseal(str(host["password"]))
	if err != nil {
		return nil, err
	}
	cfg := mysql.NewConfig()
	cfg.User = str(host["username"])
	cfg.Passwd = password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(str(host["host"]), strconv.FormatInt(num(host["port"]), 10))
	cfg.Timeout = 10 * time.Second
	cfg.ReadTimeout = 30 * time.Second
	cfg.WriteTimeout = 30 * time.Second
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, collabMySQLError(err)
	}
	db.SetMaxOpenConns(1)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, collabMySQLError(err)
	}
	return db, nil
}

// Provisioning spans PostgreSQL and MySQL DDL, which MySQL cannot roll back.
// Verify global cleanup rights before creating anything, so a rejected grant
// can be compensated with DROP DATABASE and DROP USER.
func collabMySQLCleanupPrivileges(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, "SHOW GRANTS")
	if err != nil {
		return collabMySQLError(err)
	}
	defer rows.Close()
	drop, createUser := false, false
	for rows.Next() {
		var grant string
		if err = rows.Scan(&grant); err != nil {
			return collabMySQLError(err)
		}
		upper := strings.ToUpper(grant)
		idx := strings.Index(upper, " ON *.* TO ")
		if idx < 0 {
			continue
		}
		privileges := strings.TrimPrefix(upper[:idx], "GRANT ")
		if privileges == "ALL PRIVILEGES" {
			drop, createUser = true, true
			continue
		}
		for _, priv := range strings.Split(privileges, ",") {
			switch strings.TrimSpace(priv) {
			case "DROP":
				drop = true
			case "CREATE USER":
				createUser = true
			}
		}
	}
	if err = rows.Err(); err != nil {
		return collabMySQLError(err)
	}
	if !drop || !createUser {
		return APIError{422, "DatabaseHostPermissionException", "The database host account requires global DROP and CREATE USER privileges so failed provisioning can be cleaned up safely."}
	}
	return nil
}
func (a *App) collabDatabaseView(ctx context.Context, d M, application, password bool, includeHost ...bool) (M, error) {
	host, err := a.one(ctx, "SELECT id,host,port,name FROM database_hosts WHERE id=$1", d["database_host_id"])
	if err != nil {
		return nil, err
	}
	var out M
	if application {
		out = M{"id": d["id"], "server": d["server_id"], "host": d["database_host_id"], "database": d["database"], "username": d["username"], "remote": d["remote"], "max_connections": d["max_connections"], "created_at": d["created_at"], "updated_at": d["updated_at"]}
	} else {
		out = M{"id": d["id"], "host": M{"address": host["host"], "port": host["port"]}, "name": d["database"], "username": d["username"], "connections_from": d["remote"], "max_connections": d["max_connections"]}
	}
	if password {
		plain, e := a.unseal(str(d["password"]))
		if e != nil {
			return nil, e
		}
		out["relationships"] = M{"password": item("database_password", M{"password": plain})}
	}
	if application && len(includeHost) > 0 && includeHost[0] {
		publicHost, e := a.one(ctx, "SELECT id,name,host,port,username,node_id AS node,created_at,updated_at FROM database_hosts WHERE id=$1", d["database_host_id"])
		if e != nil {
			return nil, e
		}
		relationships := asMap(out["relationships"])
		relationships["host"] = item("database_host", publicHost)
		out["relationships"] = relationships
	}
	return out, nil
}
func (a *App) collabDatabases(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	application := strings.HasPrefix(r.URL.Path, "/api/application/")
	perm := "database.read"
	if r.Method == "DELETE" {
		perm = "database.delete"
	}
	if r.Method == "POST" {
		perm = "database.create"
		if r.PathValue("database") != "" {
			perm = "database.update"
		}
	}
	var server M
	var err error
	var user M
	if application {
		user, err = a.requireAdmin(r)
		if err == nil {
			server, err = a.one(ctx, "SELECT * FROM servers WHERE id::text=$1 OR uuid=$1 OR uuid_short=$1", r.PathValue("server"))
		}
	} else {
		server, err = a.server(r, perm)
		if err == nil {
			user, err = a.user(r)
		}
	}
	if err != nil {
		fail(w, err)
		return
	}
	password := strings.Contains(r.URL.Query().Get("include"), "password") && (application || a.can(ctx, user, server, "database.view_password"))
	includeHost := application && strings.Contains(r.URL.Query().Get("include"), "host")
	if key, ok := r.Context().Value(apiKeyContextKey{}).(M); ok {
		includeHost = includeHost && applicationScopeAllowed(asMap(key["permissions"]), "GET", "/api/application/database-hosts")
	}
	object := "server_database"
	if !application {
		object = "server_database"
	}
	var database M
	if r.PathValue("database") != "" {
		database, err = a.one(ctx, "SELECT * FROM databases WHERE server_id=$1 AND id=$2", server["id"], collabID(r.PathValue("database")))
		if err != nil {
			fail(w, err)
			return
		}
	}
	if r.Method == "GET" {
		if database != nil {
			view, e := a.collabDatabaseView(ctx, database, application, password, includeHost)
			if e != nil {
				fail(w, e)
				return
			}
			writeJSON(w, 200, item(object, view))
			return
		}
		rows, e := a.query(ctx, "SELECT * FROM databases WHERE server_id=$1 ORDER BY id", server["id"])
		if e != nil {
			fail(w, e)
			return
		}
		for i := range rows {
			rows[i], e = a.collabDatabaseView(ctx, rows[i], application, password, includeHost)
			if e != nil {
				fail(w, e)
				return
			}
		}
		writeJSON(w, 200, collection(object, rows))
		return
	}
	if database != nil {
		if r.Method == "DELETE" {
			err = a.collabDeleteDatabase(ctx, database)
			if err != nil {
				fail(w, err)
				return
			}
			a.audit(ctx, num(user["id"]), num(server["id"]), "server:database.delete", M{"name": database["database"]})
			w.WriteHeader(204)
			return
		}
		database, err = a.collabRotateDatabase(ctx, database)
		if err != nil {
			fail(w, err)
			return
		}
		a.audit(ctx, num(user["id"]), num(server["id"]), "server:database.rotate-password", M{"name": database["database"]})
		if application {
			w.WriteHeader(204)
			return
		}
		view, e := a.collabDatabaseView(ctx, database, false, a.can(ctx, user, server, "database.view_password"))
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, item(object, view))
		return
	}
	d, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	database, err = a.collabCreateDatabase(ctx, server, d, application)
	if err != nil {
		fail(w, err)
		return
	}
	a.audit(ctx, num(user["id"]), num(server["id"]), "server:database.create", M{"name": database["database"]})
	view, err := a.collabDatabaseView(ctx, database, application, application || a.can(ctx, user, server, "database.view_password"), includeHost)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 201, item(object, view))
}
func (a *App) collabCreateDatabase(ctx context.Context, server, data M, application bool) (result M, resultErr error) {
	if !boolean(a.collabSetting(ctx, "pterodactyl:client_features:databases:enabled", true)) {
		return nil, bad("Game database provisioning is disabled.")
	}
	name, err := collabDatabaseName(num(server["id"]), str(data["database"]))
	if err != nil {
		return nil, err
	}
	remote := str(data["remote"])
	if remote == "" {
		remote = str(data["connections_from"])
	}
	if !collabRemoteRE.MatchString(remote) {
		return nil, bad("A valid remote address or SQL host wildcard is required.")
	}
	max := num(data["max_connections"])
	if max < 0 || max > 2147483647 {
		return nil, bad("max_connections must be between 0 and 2147483647.")
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var limit, count int64
	var serverStatus *string
	if err = tx.QueryRow(ctx, "SELECT database_limit,status FROM servers WHERE id=$1 FOR UPDATE", server["id"]).Scan(&limit, &serverStatus); err != nil {
		return nil, err
	}
	if serverStatus != nil && *serverStatus == "deleting" {
		return nil, bad("The server is being deleted.")
	}
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM databases WHERE server_id=$1", server["id"]).Scan(&count); err != nil {
		return nil, err
	}
	if count >= limit {
		return nil, bad("The server database limit has been reached.")
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM databases WHERE server_id=$1 AND database=$2)", server["id"], name).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		return nil, bad("A database with this name already exists.")
	}
	hostID := num(data["host"])
	if hostID == 0 {
		hostID = num(data["database_host_id"])
	}
	var rows pgx.Rows
	if application && hostID > 0 {
		rows, err = tx.Query(ctx, "SELECT * FROM database_hosts h WHERE id=$1 AND (max_databases IS NULL OR max_databases=0 OR (SELECT count(*) FROM databases WHERE database_host_id=h.id)<max_databases) FOR UPDATE", hostID)
	} else {
		allowRandom := boolean(a.collabSetting(ctx, "pterodactyl:client_features:databases:allow_random", true))
		rows, err = tx.Query(ctx, "SELECT * FROM database_hosts h WHERE ($2 OR node_id=$1) AND (max_databases IS NULL OR max_databases=0 OR (SELECT count(*) FROM databases WHERE database_host_id=h.id)<max_databases) ORDER BY (node_id=$1) DESC NULLS LAST,id FOR UPDATE LIMIT 1", server["node_id"], allowRandom)
	}
	if err != nil {
		return nil, err
	}
	rr, err := pgx.CollectRows(rows, pgx.RowToMap)
	if err != nil {
		return nil, err
	}
	if len(rr) == 0 {
		return nil, bad("No suitable database host is available, or the host database limit has been reached.")
	}
	host := M(rr[0])
	// Check capacity after obtaining the host row lock. Another creation may have
	// committed while this transaction was waiting for that lock.
	if maxHosts := num(host["max_databases"]); maxHosts > 0 {
		var hostCount int64
		if err = tx.QueryRow(ctx, "SELECT count(*) FROM databases WHERE database_host_id=$1", host["id"]).Scan(&hostCount); err != nil {
			return nil, err
		}
		if hostCount >= maxHosts {
			return nil, bad("The database host limit has been reached.")
		}
	}
	db, err := a.collabMySQL(ctx, host)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err = collabMySQLCleanupPrivileges(ctx, db); err != nil {
		return nil, err
	}
	username := fmt.Sprintf("u%d_%s", num(server["id"]), randomToken(5))
	if len(username) > 32 {
		return nil, bad("Generated database username exceeds the host limit.")
	}
	plain := randomToken(24)
	sealed, err := a.seal(plain)
	if err != nil {
		return nil, err
	}
	account := collabQuoteString(username) + "@" + collabQuoteString(remote)
	createdDB, createdUser := false, false
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			var cleanupErr error
			if createdUser {
				_, cleanupErr = db.ExecContext(cleanup, "DROP USER IF EXISTS "+account)
			}
			if createdDB {
				_, dropErr := db.ExecContext(cleanup, "DROP DATABASE IF EXISTS "+collabQuoteIdentifier(name))
				if dropErr != nil {
					cleanupErr = dropErr
				}
			}
			if cleanupErr != nil {
				a.audit(cleanup, 0, num(server["id"]), "server:database.cleanup_failed", M{"database": name, "username": username, "host_id": host["id"]})
				result = nil
				resultErr = APIError{502, "DatabaseCleanupException", "Database provisioning failed and the database host could not clean up the partial resources. Check the database host and server activity log."}
			}
		}
	}()
	// No IF NOT EXISTS here: never adopt or later delete an unrelated pre-existing database.
	if _, err = db.ExecContext(ctx, "CREATE DATABASE "+collabQuoteIdentifier(name)); err != nil {
		return nil, collabMySQLError(err)
	}
	createdDB = true
	q := "CREATE USER " + account + " IDENTIFIED BY " + collabQuoteString(plain)
	if max > 0 {
		q += fmt.Sprintf(" WITH MAX_USER_CONNECTIONS %d", max)
	}
	if _, err = db.ExecContext(ctx, q); err != nil {
		return nil, collabMySQLError(err)
	}
	createdUser = true
	grants := "SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, REFERENCES, INDEX, LOCK TABLES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE, CREATE TEMPORARY TABLES, CREATE VIEW, SHOW VIEW, EVENT, TRIGGER"
	if _, err = db.ExecContext(ctx, "GRANT "+grants+" ON "+collabQuoteIdentifier(name)+".* TO "+account); err != nil {
		return nil, collabMySQLError(err)
	}
	var id int64
	if err = tx.QueryRow(ctx, "INSERT INTO databases(server_id,database_host_id,database,username,remote,password,max_connections) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", server["id"], host["id"], name, username, remote, sealed, max).Scan(&id); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	committed = true
	return a.one(ctx, "SELECT * FROM databases WHERE id=$1", id)
}
func (a *App) collabRotateDatabase(ctx context.Context, d M) (M, error) {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var old string
	if err = tx.QueryRow(ctx, "SELECT password FROM databases WHERE id=$1 FOR UPDATE", d["id"]).Scan(&old); err != nil {
		return nil, err
	}
	host, err := a.one(ctx, "SELECT * FROM database_hosts WHERE id=$1", d["database_host_id"])
	if err != nil {
		return nil, err
	}
	db, err := a.collabMySQL(ctx, host)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	plain := randomToken(24)
	sealed, err := a.seal(plain)
	if err != nil {
		return nil, err
	}
	account := collabQuoteString(str(d["username"])) + "@" + collabQuoteString(str(d["remote"]))
	if _, err = db.ExecContext(ctx, "ALTER USER "+account+" IDENTIFIED BY "+collabQuoteString(plain)); err != nil {
		return nil, collabMySQLError(err)
	}
	_, err = tx.Exec(ctx, "UPDATE databases SET password=$1,updated_at=now() WHERE id=$2", sealed, d["id"])
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		oldPlain, e := a.unseal(old)
		if e == nil {
			cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			_, e = db.ExecContext(cleanup, "ALTER USER "+account+" IDENTIFIED BY "+collabQuoteString(oldPlain))
		}
		if e != nil {
			return nil, fmt.Errorf("password rotation persistence failed and host rollback failed: %w", err)
		}
		return nil, err
	}
	return a.one(ctx, "SELECT * FROM databases WHERE id=$1", d["id"])
}
func (a *App) collabDeleteDatabase(ctx context.Context, d M) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM databases WHERE id=$1 FOR UPDATE", d["id"]); err != nil {
		return err
	}
	host, err := a.one(ctx, "SELECT * FROM database_hosts WHERE id=$1", d["database_host_id"])
	if err != nil {
		return err
	}
	db, err := a.collabMySQL(ctx, host)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err = db.ExecContext(ctx, "DROP DATABASE IF EXISTS "+collabQuoteIdentifier(str(d["database"]))); err != nil {
		return collabMySQLError(err)
	}
	if _, err = db.ExecContext(ctx, "DROP USER IF EXISTS "+collabQuoteString(str(d["username"]))+"@"+collabQuoteString(str(d["remote"]))); err != nil {
		return collabMySQLError(err)
	}
	if _, err = tx.Exec(ctx, "DELETE FROM databases WHERE id=$1", d["id"]); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// deleteServerDatabases is used before server deletion so cascading panel rows
// never leave database users and schemas running on the game database host.
func (a *App) deleteServerDatabases(ctx context.Context, server M) error {
	rows, err := a.query(ctx, "SELECT * FROM databases WHERE server_id=$1 ORDER BY id", server["id"])
	if err != nil {
		return err
	}
	for _, database := range rows {
		if err = a.collabDeleteDatabase(ctx, database); err != nil {
			return err
		}
	}
	return nil
}

func collabRedactProperties(properties M, hideIP bool) M {
	out := M{}
	for key, value := range properties {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "password") || strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "authorization") {
			out[key] = "[hidden]"
			continue
		}
		if lower == "ip" && hideIP {
			out[key] = "[hidden]"
			continue
		}
		switch v := value.(type) {
		case map[string]any:
			out[key] = collabRedactProperties(v, hideIP)
		case []any:
			values := make([]any, len(v))
			for i, entry := range v {
				if m, ok := entry.(map[string]any); ok {
					values[i] = collabRedactProperties(m, hideIP)
				} else {
					values[i] = entry
				}
			}
			out[key] = values
			out[key+"_count"] = len(v)
		default:
			out[key] = value
		}
	}
	return out
}
func (a *App) collabActivity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	where := "actor_id=$1"
	args := []any{user["id"]}
	var server M
	if r.PathValue("server") != "" {
		server, err = a.server(r, "activity.read")
		if err != nil {
			fail(w, err)
			return
		}
		where = "server_id=$1"
		args = []any{server["id"]}
	}
	if filter := r.URL.Query().Get("filter[event]"); filter != "" {
		args = append(args, "%"+filter+"%")
		where += fmt.Sprintf(" AND event ILIKE $%d", len(args))
	}
	where += " AND event NOT IN ('server:file.upload')"
	if server != nil && !boolean(user["root_admin"]) {
		where += " AND NOT EXISTS (SELECT 1 FROM settings WHERE key='activity:hide_admin_activity' AND value='true'::jsonb AND EXISTS (SELECT 1 FROM users au WHERE au.id=activity_logs.actor_id AND au.root_admin AND NOT EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=$1 AND su.user_id=au.id) AND au.id<>(SELECT owner_id FROM servers WHERE id=$1)))"
	}
	page := collabID(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	per := collabID(r.URL.Query().Get("per_page"))
	if per < 1 {
		per = 25
	}
	if per > 100 {
		per = 100
	}
	var total int64
	if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM activity_logs WHERE "+where, args...).Scan(&total); err != nil {
		fail(w, err)
		return
	}
	direction := "DESC"
	if r.URL.Query().Get("sort") == "timestamp" {
		direction = "ASC"
	}
	qargs := append(append([]any{}, args...), per, (page-1)*per)
	logs, err := a.query(ctx, "SELECT * FROM activity_logs WHERE "+where+fmt.Sprintf(" ORDER BY created_at %s,id %s LIMIT $%d OFFSET $%d", direction, direction, len(args)+1, len(args)+2), qargs...)
	if err != nil {
		fail(w, err)
		return
	}
	for i, log := range logs {
		own := num(log["actor_id"]) == num(user["id"])
		ip := log["ip"]
		if !own && !boolean(user["root_admin"]) {
			ip = nil
		}
		hash := sha1.Sum([]byte(str(log["id"])))
		props := collabRedactProperties(asMap(log["properties"]), !own)
		out := M{"id": hex.EncodeToString(hash[:]), "batch": log["batch"], "event": log["event"], "is_api": false, "ip": ip, "description": log["description"], "properties": props, "has_additional_metadata": len(props) > 0, "timestamp": log["created_at"]}
		if strings.Contains(r.URL.Query().Get("include"), "actor") {
			actor, e := a.one(ctx, "SELECT id,uuid,username,email,created_at FROM users WHERE id=$1", log["actor_id"])
			if e == nil {
				out["relationships"] = M{"actor": item("user", collabUser(actor))}
			}
		}
		logs[i] = out
	}
	out := collection("activity_log", logs)
	pages := (total + per - 1) / per
	if pages < 1 {
		pages = 1
	}
	out["meta"] = M{"pagination": M{"total": total, "count": len(logs), "per_page": per, "current_page": page, "total_pages": pages, "links": M{}}}
	writeJSON(w, 200, out)
}
