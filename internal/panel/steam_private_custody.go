package panel

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"unicode/utf8"
	"voltra/internal/steamapi"
	"voltra/internal/steamexec"
)

type privateEnvelope struct {
	Version       int    `json:"version"`
	Purpose       string `json:"purpose"`
	Server        string `json:"server"`
	Actor         int64  `json:"actor"`
	Authorization string `json:"authorization"`
	Generation    string `json:"generation"`
	Job           string `json:"job,omitempty"`
	Digest        string `json:"digest,omitempty"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	BetaPassword  string `json:"beta_password,omitempty"`
}

func (a *App) sealPrivate(v privateEnvelope) (string, error) {
	v.Version = 1
	b, e := json.Marshal(v)
	defer clear(b)
	if e != nil || len(b) > 65536 {
		return "", bad("Private Steam credential frame is too large.")
	}
	return a.seal(string(b))
}
func (a *App) openPrivate(cipher string, want privateEnvelope) (privateEnvelope, error) {
	plain, e := a.unseal(cipher)
	if e != nil {
		return privateEnvelope{}, errPrivateResupply
	}
	var v privateEnvelope
	if json.Unmarshal([]byte(plain), &v) != nil || v.Version != 1 || v.Purpose != want.Purpose || v.Server != want.Server || v.Actor != want.Actor || v.Authorization != want.Authorization || v.Generation != want.Generation || v.Job != want.Job || v.Digest != want.Digest {
		return privateEnvelope{}, errPrivateResupply
	}
	return v, nil
}
func privateProfilePublic(row M) M {
	return M{"id": row["id"], "saved_password": str(row["credential_cipher"]) != "", "revoked": boolean(row["revoked"]), "created_at": row["created_at"]}
}
func (a *App) privateAuthorizations(w http.ResponseWriter, r *http.Request) {
	s, u, e := a.privateServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	rows, e := a.query(r.Context(), "SELECT id,credential_cipher,revoked,created_at FROM steam_private_authorizations WHERE server_id=$1 AND actor_id=$2 ORDER BY created_at", s["id"], u["id"])
	if e != nil {
		fail(w, e)
		return
	}
	out := []M{}
	for _, row := range rows {
		out = append(out, privateProfilePublic(row))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, collection("steam_private_authorization", out))
}

type privateProfileInput struct {
	Username     string  `json:"username"`
	Password     *string `json:"password,omitempty"`
	SavePassword bool    `json:"save_password"`
}

func (a *App) privateAuthorizationCreate(w http.ResponseWriter, r *http.Request) {
	s, u, e := a.privateServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	var in privateProfileInput
	if e = privateDecode(r, &in); e != nil {
		fail(w, e)
		return
	}
	if in.Username == "" || !utf8.ValidString(in.Username) || (in.SavePassword && in.Password == nil) {
		fail(w, bad("Supply the account name and explicit saved-password choice."))
		return
	}
	controls, err := privateServerSteamControls(r.Context(), a.DB, s)
	if err != nil {
		fail(w, err)
		return
	}
	if err = validatePrivateOriginal(controls, "username", in.Username); err == nil && in.SavePassword {
		err = validatePrivateOriginal(controls, "password", *in.Password)
	}
	if err != nil {
		fail(w, err)
		return
	}
	id, generation, owner := newUUID(), newUUID(), randomToken(32)
	binding := privateEnvelope{Purpose: "identity", Server: str(s["uuid"]), Actor: num(u["id"]), Authorization: id, Generation: generation, Username: in.Username}
	identity, e := a.sealPrivate(binding)
	if e != nil {
		fail(w, bad("Private Steam credential encryption is unavailable."))
		return
	}
	saved := ""
	if in.SavePassword {
		binding.Purpose = "profile"
		binding.Password = *in.Password
		saved, e = a.sealPrivate(binding)
		if e != nil {
			fail(w, bad("Private Steam credential encryption is unavailable."))
			return
		}
	}
	row, e := a.one(r.Context(), `INSERT INTO steam_private_authorizations(id,server_id,actor_id,owner_scope,generation,identity_cipher,credential_cipher) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,credential_cipher,revoked,created_at`, id, s["id"], u["id"], owner, generation, identity, saved)
	if e != nil {
		fail(w, e)
		return
	}
	a.opAudit(r, s, "server:steam.private.authorization.created", M{"authorization_id": id, "saved_password": in.SavePassword})
	writeJSON(w, 201, item("steam_private_authorization", privateProfilePublic(row)))
}
func (a *App) privateAuthorizationUpdate(w http.ResponseWriter, r *http.Request) {
	s, u, e := a.privateServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	var in privateProfileInput
	if e = privateDecode(r, &in); e != nil {
		fail(w, e)
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	row, e := queryRowMap(tx.QueryRow(r.Context(), "SELECT row_to_json(p) FROM steam_private_authorizations p WHERE id=$1 AND server_id=$2 AND actor_id=$3 AND NOT revoked FOR UPDATE", r.PathValue("authorization"), s["id"], u["id"]))
	if e != nil {
		fail(w, notFound())
		return
	}
	old, e := a.openPrivate(str(row["identity_cipher"]), privateEnvelope{Purpose: "identity", Server: str(s["uuid"]), Actor: num(u["id"]), Authorization: str(row["id"]), Generation: str(row["generation"])})
	if e != nil {
		fail(w, bad("The account profile could not be unlocked."))
		return
	}
	if in.Username == "" || !utf8.ValidString(in.Username) || in.SavePassword && in.Password == nil {
		fail(w, bad("Supply the account name and saved-password choice."))
		return
	}
	controls, err := privateServerSteamControls(r.Context(), tx, s)
	if err != nil {
		fail(w, err)
		return
	}
	if err = validatePrivateOriginal(controls, "username", in.Username); err == nil && in.SavePassword {
		err = validatePrivateOriginal(controls, "password", *in.Password)
	}
	if err != nil {
		fail(w, err)
		return
	}
	owner := str(row["owner_scope"])
	if in.Username != old.Username {
		owner = randomToken(32)
	}
	generation := newUUID()
	binding := privateEnvelope{Purpose: "identity", Server: str(s["uuid"]), Actor: num(u["id"]), Authorization: str(row["id"]), Generation: generation, Username: in.Username}
	identity, e := a.sealPrivate(binding)
	if e != nil {
		fail(w, bad("Private Steam credential encryption is unavailable."))
		return
	}
	saved := ""
	if in.SavePassword {
		binding.Purpose = "profile"
		binding.Password = *in.Password
		saved, e = a.sealPrivate(binding)
		if e != nil {
			fail(w, bad("Private Steam credential encryption is unavailable."))
			return
		}
	}
	_, e = tx.Exec(r.Context(), "UPDATE steam_private_authorizations SET owner_scope=$2,generation=$3,identity_cipher=$4,credential_cipher=$5,updated_at=now() WHERE id=$1", row["id"], owner, generation, identity, saved)
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE steam_private_jobs SET cancel_requested=true,input_cipher='',updated_at=now() WHERE authorization_id=$1 AND job_id IN(SELECT id FROM steam_jobs WHERE status IN('queued','running'))", row["id"])
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.opAudit(r, s, "server:steam.private.authorization.rotated", M{"authorization_id": row["id"]})
	writeJSON(w, 200, item("steam_private_authorization", M{"id": row["id"], "saved_password": in.SavePassword, "revoked": false}))
}
func (a *App) privateAuthorizationDelete(w http.ResponseWriter, r *http.Request) {
	s, u, e := a.privateServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	row, e := a.one(r.Context(), "SELECT actor_id FROM steam_private_authorizations WHERE id=$1 AND server_id=$2", r.PathValue("authorization"), s["id"])
	if e != nil {
		fail(w, notFound())
		return
	}
	if num(row["actor_id"]) != num(u["id"]) && num(s["owner_id"]) != num(u["id"]) && !boolean(u["root_admin"]) {
		fail(w, forbidden())
		return
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "UPDATE steam_private_authorizations SET revoked=true,identity_cipher='',credential_cipher='',generation=$2,updated_at=now() WHERE id=$1", r.PathValue("authorization"), newUUID())
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE steam_private_jobs SET cancel_requested=true,input_cipher='',updated_at=now() WHERE authorization_id=$1", r.PathValue("authorization"))
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.opAudit(r, s, "server:steam.private.authorization.revoked", M{"authorization_id": r.PathValue("authorization")})
	w.WriteHeader(204)
}

type privateJobInput struct {
	Authorization string                   `json:"authorization_id"`
	Operation     string                   `json:"operation"`
	Branch        string                   `json:"branch"`
	Password      *string                  `json:"password,omitempty"`
	BetaPassword  string                   `json:"beta_password,omitempty"`
	Previous      *steamapi.PrivateReceipt `json:"previous,omitempty"`
}

func (a *App) privateQueueJob(ctx context.Context, s, u M, kind, authID string, in privateJobInput) (M, error) {
	if in.Operation != "install" && in.Operation != "update" && in.Operation != "verify" {
		return nil, bad("Choose install, update or verify.")
	}
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	server, e := queryRowMap(tx.QueryRow(ctx, "SELECT row_to_json(s) FROM servers s WHERE id=$1 FOR UPDATE", s["id"]))
	if e != nil {
		return nil, e
	}
	s = server
	// Recheck after the row lock: the request may have waited while ownership,
	// permissions or its authenticated session changed.
	actor, actorErr := a.one(ctx, "SELECT * FROM users WHERE id=$1", u["id"])
	if actorErr != nil || boolean(actor["disabled"]) || !a.can(ctx, actor, server, "startup.update") {
		return nil, forbidden()
	}
	var authLive bool
	e = tx.QueryRow(ctx, `SELECT CASE WHEN $1='session' THEN EXISTS(SELECT 1 FROM browser_sessions WHERE token_hash=$2 AND user_id=$3 AND expires_at>now()) ELSE EXISTS(SELECT 1 FROM api_keys WHERE id::text=$2 AND user_id=$3 AND type='client' AND (expires_at IS NULL OR expires_at>now())) END`, kind, authID, u["id"]).Scan(&authLive)
	if e != nil || !authLive {
		return nil, forbidden()
	}
	if str(server["status"]) != "" && str(server["status"]) != "reinstall_failed" {
		return nil, APIError{409, "PrivateSteamServerState", "Finish the current server operation first."}
	}
	var blocked bool
	e = tx.QueryRow(ctx, "SELECT n.maintenance_mode OR EXISTS(SELECT 1 FROM server_transfers WHERE server_id=$1 AND successful IS NULL) FROM nodes n WHERE n.id=$2", s["id"], server["node_id"]).Scan(&blocked)
	if e != nil || blocked {
		return nil, APIError{409, "PrivateSteamServerState", "The node or server is unavailable for private content."}
	}
	profile, defaultBranch, e := privateContentProfile(ctx, tx, server)
	if e != nil {
		return nil, APIError{409, "PrivateSteamProfileUnavailable", "This server has no reviewed private content profile."}
	}
	app := profile.AppID
	if !a.privateReady(ctx, num(server["node_id"]), app) {
		return nil, APIError{409, "PrivateSteamNodeNotReady", "A production-trusted private Steam worker and reviewed game policy are required."}
	}
	authorization, e := queryRowMap(tx.QueryRow(ctx, "SELECT row_to_json(p) FROM steam_private_authorizations p WHERE id=$1 AND server_id=$2 AND actor_id=$3 AND NOT revoked FOR UPDATE", in.Authorization, s["id"], u["id"]))
	if e != nil {
		return nil, forbidden()
	}
	binding := privateEnvelope{Purpose: "identity", Server: str(server["uuid"]), Actor: num(u["id"]), Authorization: in.Authorization, Generation: str(authorization["generation"])}
	identity, e := a.openPrivate(str(authorization["identity_cipher"]), binding)
	if e != nil {
		return nil, errPrivateResupply
	}
	password := ""
	if in.Password != nil {
		password = *in.Password
	} else if str(authorization["credential_cipher"]) != "" {
		binding.Purpose = "profile"
		saved, err := a.openPrivate(str(authorization["credential_cipher"]), binding)
		if err != nil {
			return nil, err
		}
		password = saved.Password
	} else {
		return nil, bad("Supply the account password for this job.")
	}
	branch := in.Branch
	if branch == "" {
		branch = defaultBranch
	}
	controls, err := privateServerSteamControls(ctx, tx, server)
	if err != nil {
		return nil, err
	}
	for role, value := range map[string]string{"username": identity.Username, "password": password, "branch": branch, "beta_password": in.BetaPassword} {
		if err = validatePrivateOriginal(controls, role, value); err != nil {
			return nil, err
		}
	}
	disk := num(server["disk"])
	if disk <= 0 || disk > 1048576 {
		return nil, bad("A bounded server disk limit is required for private content.")
	}
	r := steamapi.PrivateRequest{Version: steamapi.PrivateVersion, Job: newUUID(), Server: str(server["uuid"]), Owner: str(authorization["owner_scope"]), Nonce: randomToken(32), Selection: steamapi.PrivateSelection{App: app, Branch: branch, Platform: profile.Platform, Architecture: profile.Architecture, Language: "english", DLC: []uint32{}, Protected: profile.ProtectedPaths}, ContentBudget: strconv.FormatInt(disk*1048576, 10), RollbackReserve: strconv.FormatInt(disk*262144, 10), CacheQuota: strconv.FormatInt(disk*524288, 10), DeadlineSeconds: 7200}
	var previous []byte
	var previousNode, previousOwner, previousEgg int64
	var previousInstallation string
	e = tx.QueryRow(ctx, "SELECT receipt,node_id,server_owner_id,egg_id,installation_id FROM steam_private_publications WHERE server_id=$1", s["id"]).Scan(&previous, &previousNode, &previousOwner, &previousEgg, &previousInstallation)
	if e == nil {
		if previousNode != num(server["node_id"]) || previousOwner != num(server["owner_id"]) || previousEgg != num(server["egg_id"]) || previousInstallation != str(server["installation_id"]) {
			return nil, APIError{409, "PrivateSteamContentMigrationRequired", "The server's placement or installation changed after private publication; review content migration before continuing."}
		}
		var receipt steamapi.PrivateReceipt
		if json.Unmarshal(previous, &receipt) != nil {
			return nil, errPrivateResupply
		}
		if receipt.Scope.Owner != r.Scope().Owner {
			return nil, APIError{409, "PrivateSteamAccountMigrationRequired", "Existing private files belong to another account authorization; use the original profile or review migration."}
		}
		r.Previous = &receipt
		if in.Previous != nil {
			left, _ := json.Marshal(in.Previous)
			right, _ := json.Marshal(&receipt)
			if string(left) != string(right) {
				return nil, bad("The prior publication reference does not match this server.")
			}
		}
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	} else if in.Previous != nil {
		return nil, bad("A prior publication must come from this server's verified job history.")
	}
	if e = r.Validate(); e != nil {
		return nil, bad("Invalid private Steam selection or credential policy.")
	}
	test := r
	test.Username = identity.Username
	test.Password = password
	test.BetaPassword = in.BetaPassword
	if e = test.Validate(); e != nil {
		return nil, bad("Invalid private Steam selection or credential policy.")
	}
	encoded, _ := json.Marshal(steamexec.PrivateContentRequest{Operation: "private_content", Username: test.Username, Password: test.Password, Branch: test.Selection.Branch, BetaPassword: test.BetaPassword, AppID: test.Selection.App, ParentFieldsValidated: true, Content: map[string]any{"target_fd": 6, "work_fd": 7, "cache_fd": 8, "scope": test.Scope(), "platform": test.Selection.Platform, "architecture": test.Selection.Architecture, "language": test.Selection.Language, "dlc_apps": test.Selection.DLC, "protected_roots": test.Selection.Protected, "content_budget": test.ContentBudget, "rollback_reserve": test.RollbackReserve, "cache_quota": test.CacheQuota, "deadline_seconds": test.DeadlineSeconds, "previous": test.Previous}})
	defer clear(encoded)
	if len(encoded) > 65536 {
		return nil, bad("Private Steam request is too large.")
	}
	input, e := a.sealPrivate(privateEnvelope{Purpose: "job", Server: r.Server, Actor: num(u["id"]), Authorization: in.Authorization, Generation: str(authorization["generation"]), Job: r.Job, Digest: r.Scope().RequestDigest, Username: identity.Username, Password: password, BetaPassword: in.BetaPassword})
	if e != nil {
		return nil, bad("Private Steam credential encryption is unavailable.")
	}
	job, e := queryRowMap(tx.QueryRow(ctx, "INSERT INTO steam_jobs(id,server_id,operation,executor) VALUES($1,$2,$3,'steamkit-depot-v1') RETURNING row_to_json(steam_jobs)", r.Job, s["id"], in.Operation))
	if e != nil {
		return nil, e
	}
	request, _ := json.Marshal(r)
	// Retain only the non-secret original scope/selection for authenticated
	// read-only reconciliation if its credential-dependent row is later removed.
	_, e = tx.Exec(ctx, `INSERT INTO steam_private_attempts(job_id,server_id,node_id,server_owner_id,egg_id,installation_id,request) VALUES($1,$2,$3,$4,$5,$6,$7)`, r.Job, s["id"], server["node_id"], server["owner_id"], server["egg_id"], str(server["installation_id"]), request)
	if e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO steam_private_jobs(job_id,authorization_id,actor_id,actor_auth_kind,actor_auth_id,authorization_generation,node_id,server_owner_id,egg_id,installation_id,request,input_cipher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, r.Job, in.Authorization, u["id"], kind, authID, authorization["generation"], server["node_id"], server["owner_id"], server["egg_id"], str(server["installation_id"]), request, input)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return job, nil
}
func (a *App) privateJobCreate(w http.ResponseWriter, r *http.Request) {
	s, u, e := a.privateServer(r)
	if e != nil {
		fail(w, e)
		return
	}
	kind, authID, e := a.privateAuthBinding(r, num(u["id"]))
	if e != nil {
		fail(w, e)
		return
	}
	var in privateJobInput
	if e = privateDecode(r, &in); e != nil {
		fail(w, e)
		return
	}
	job, e := a.privateQueueJob(r.Context(), s, u, kind, authID, in)
	if e != nil {
		fail(w, e)
		return
	}
	a.opAudit(r, s, "server:steam.private.job.queued", M{"job_id": job["id"]})
	writeJSON(w, 202, item("steam_private_job", steamJobPublic(job)))
}
