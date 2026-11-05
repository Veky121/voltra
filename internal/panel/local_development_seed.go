package panel

// This file prepares ordinary panel records for the isolated workspace runtime.
// It does not replace handlers, daemon calls, resource readings or game files.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const LocalDevelopmentMarker = "dev:workspace"
const localDevelopmentVersion = "voltra.local-dev.v1"

type LocalDevelopmentOptions struct {
	AdminPassword, MemberPassword string
	WingsTokenID, WingsToken      string
}

// ValidateLocalDevelopmentURL rejects environment-driven connection overrides.
// Run it before connecting, including before New applies schema migrations.
func ValidateLocalDevelopmentURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u == nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host != "127.0.0.1:55440" || u.Path != "/voltra_dev" || u.Fragment != "" || u.User == nil || u.User.Username() != "voltra_dev" {
		return errors.New("local development requires voltra_dev at 127.0.0.1:55440/voltra_dev")
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(query) != 1 || query.Get("sslmode") != "disable" || len(query["sslmode"]) != 1 {
		return errors.New("local development permits only sslmode=disable in the database URL")
	}
	return nil
}

// CheckLocalDevelopmentDatabase runs before migrations and refuses existing
// unmarked databases. The command never resets or adopts an arbitrary database.
func CheckLocalDevelopmentDatabase(ctx context.Context, raw string) error {
	if err := ValidateLocalDevelopmentURL(raw); err != nil {
		return err
	}
	config, err := pgx.ParseConfig(raw)
	if err != nil {
		return errors.New("invalid local development connection")
	}
	config.RuntimeParams = map[string]string{"search_path": "public"}
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return errors.New("cannot connect to local development PostgreSQL")
	}
	defer conn.Close(ctx)
	var count int
	if err = conn.QueryRow(ctx, "SELECT count(*) FROM pg_tables WHERE schemaname='public'").Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return nil
	}
	var exists bool
	if err = conn.QueryRow(ctx, "SELECT to_regclass('public.settings') IS NOT NULL").Scan(&exists); err != nil || !exists {
		return errors.New("refusing existing unmarked local database")
	}
	var version string
	if err = conn.QueryRow(ctx, "SELECT value->>'version' FROM public.settings WHERE key=$1", LocalDevelopmentMarker).Scan(&version); err != nil || version != localDevelopmentVersion {
		return errors.New("refusing existing database without the workspace development marker")
	}
	return nil
}

// SeedLocalDevelopment is idempotent. Completed seeds return without updating
// accounts, configuration, games or schedules that a developer has changed.
func (a *App) SeedLocalDevelopment(ctx context.Context, options LocalDevelopmentOptions) (M, M, error) {
	if err := ValidateLocalDevelopmentURL(a.Config.DatabaseURL); err != nil {
		return nil, nil, err
	}
	if a.Config.DevMode || a.Config.Listen != "127.0.0.1:18089" || a.Config.PublicURL != "http://127.0.0.1:5181" || a.Config.DaemonURL != "http://host.docker.internal:18089" {
		return nil, nil, errors.New("local development requires the isolated listeners and normal password authentication")
	}
	for _, password := range []string{options.AdminPassword, options.MemberPassword} {
		if len(password) < 1 || len(password) > 72 {
			return nil, nil, errors.New("local development passwords must be 1 to 72 bytes")
		}
	}
	if len(options.WingsTokenID) < 16 || len(options.WingsToken) < 32 || strings.ContainsAny(options.WingsTokenID+options.WingsToken, "\r\n\t ") {
		return nil, nil, errors.New("local Wings credentials are missing or invalid")
	}
	conn, err := a.DB.Acquire(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended('voltra-local-dev-seed',0))"); err != nil {
		return nil, nil, err
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock(hashtextextended('voltra-local-dev-seed',0))")
	var complete bool
	err = conn.QueryRow(ctx, "SELECT COALESCE((value->>'complete')::boolean,false) FROM settings WHERE key=$1", LocalDevelopmentMarker).Scan(&complete)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	if !complete {
		if err = a.seedLocalDevelopmentBase(ctx, options); err != nil {
			return nil, nil, err
		}
		if err = a.seedLocalDevelopmentGames(ctx); err != nil {
			return nil, nil, err
		}
		if _, err = a.DB.Exec(ctx, "UPDATE settings SET value=value || '{\"complete\":true}'::jsonb WHERE key=$1", LocalDevelopmentMarker); err != nil {
			return nil, nil, err
		}
	}
	return a.localDevelopmentInventory(ctx)
}

func (a *App) seedLocalDevelopmentBase(ctx context.Context, options LocalDevelopmentOptions) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var marked bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM settings WHERE key=$1 AND value->>'version'=$2)", LocalDevelopmentMarker, localDevelopmentVersion).Scan(&marked); err != nil {
		return err
	}
	if marked {
		return nil
	}
	var occupied bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM nodes) OR EXISTS(SELECT 1 FROM servers) OR EXISTS(SELECT 1 FROM settings)").Scan(&occupied); err != nil {
		return err
	}
	if occupied {
		return errors.New("refusing to seed existing unmarked panel data")
	}
	for _, account := range []struct {
		username, password, first string
		admin                     bool
	}{{"admin", options.AdminPassword, "Local administrator", true}, {"member", options.MemberPassword, "Local member", false}} {
		hash, err := bcrypt.GenerateFromPassword([]byte(account.password), 12)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO users(uuid,username,email,name_first,password_hash,root_admin) VALUES($1,$2,$3,$4,$5,$6)", newUUID(), account.username, account.username+"@local.invalid", account.first, string(hash), account.admin); err != nil {
			return err
		}
	}
	var locationID int64
	if err = tx.QueryRow(ctx, "INSERT INTO locations(short,long) VALUES('local-dev','Local development on this computer') RETURNING id").Scan(&locationID); err != nil {
		return err
	}
	sealedToken, err := a.seal(options.WingsToken)
	if err != nil {
		return err
	}
	var nodeID int64
	err = tx.QueryRow(ctx, `INSERT INTO nodes(uuid,name,description,location_id,fqdn,scheme,memory,disk,daemon_listen,daemon_sftp,daemon_base,daemon_token_id,daemon_token,allowed_origins) VALUES($1,'Local Wings','Isolated workspace development node',$2,'127.0.0.1','http',6144,32768,18085,12025,'/var/lib/voltra-dev/volumes',$3,$4,'["http://127.0.0.1:5181","http://127.0.0.1:18089"]') RETURNING id`, newUUID(), locationID, options.WingsTokenID, sealedToken).Scan(&nodeID)
	if err != nil {
		return err
	}
	for port := 25590; port <= 25599; port++ {
		if _, err = tx.Exec(ctx, "INSERT INTO allocations(node_id,ip,port) VALUES($1,'127.0.0.1',$2)", nodeID, port); err != nil {
			return err
		}
	}
	setup := M{"completed": true, "public_url": a.Config.PublicURL, "access_mode": "local", "tls_mode": "proxy", "pending_tls": false}
	if _, err = tx.Exec(ctx, "INSERT INTO settings(key,value) VALUES('panel:setup',$1),($2,$3)", setup, LocalDevelopmentMarker, M{"version": localDevelopmentVersion, "complete": false, "node_id": nodeID, "source": "bundled-catalog", "created_at": now()}); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO activity_logs(event,description) VALUES('dev:workspace.created','Created the isolated local development workspace')"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (a *App) seedLocalDevelopmentGames(ctx context.Context) error {
	var ownerID, memberID, nodeID int64
	if err := a.DB.QueryRow(ctx, "SELECT id FROM users WHERE username='admin'").Scan(&ownerID); err != nil {
		return err
	}
	if err := a.DB.QueryRow(ctx, "SELECT id FROM users WHERE username='member'").Scan(&memberID); err != nil {
		return err
	}
	if err := a.DB.QueryRow(ctx, "SELECT (value->>'node_id')::bigint FROM settings WHERE key=$1", LocalDevelopmentMarker).Scan(&nodeID); err != nil {
		return err
	}
	games := []struct {
		path, name   string
		port, memory int
	}{
		{"minecraft/java/paper/egg-paper.json", "Minecraft development", 25590, 2048},
		{"terraria/vanilla/egg-terraria-vanilla.json", "Terraria development", 25591, 1024},
		{"mindustry/egg-mindustry.json", "Mindustry development", 25592, 512},
	}
	for _, game := range games {
		externalID := "local-dev:" + game.path
		var exists bool
		if err := a.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM servers WHERE external_id=$1)", externalID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		var entry gameTemplate
		for _, candidate := range gameTemplates().Entries {
			if candidate.Path == game.path {
				entry = candidate
				break
			}
		}
		if entry.Path == "" {
			return fmt.Errorf("bundled game recipe is missing: %s", game.path)
		}
		egg, variables, err := parseEggDocument(entry.Egg)
		if err != nil {
			return err
		}
		imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, variables)
		if err != nil {
			return err
		}
		labels := []string{}
		images := asMap(egg["docker_images"])
		for label := range images {
			labels = append(labels, label)
		}
		sort.Strings(labels)
		if len(labels) == 0 {
			return fmt.Errorf("bundled game has no runtime image: %s", game.path)
		}
		label := labels[0]
		for _, candidate := range labels {
			if strings.Contains(strings.ToLower(candidate), "reviewed default") {
				label = candidate
				break
			}
		}
		tx, err := a.DB.Begin(ctx)
		if err != nil {
			return err
		}
		err = func() error {
			defer tx.Rollback(ctx)
			var allocationID, serverID int64
			if err := tx.QueryRow(ctx, "SELECT id FROM allocations WHERE node_id=$1 AND port=$2 AND server_id IS NULL FOR UPDATE", nodeID, game.port).Scan(&allocationID); err != nil {
				return err
			}
			serverUUID := newUUID()
			err := tx.QueryRow(ctx, `INSERT INTO servers(uuid,uuid_short,identifier,external_id,name,description,owner_id,node_id,nest_id,egg_id,allocation_id,startup,image,memory,disk,cpu,backup_limit,allocation_limit) VALUES($1,$2,$2,$3,$4,'Local game record. Install through Runtime before starting.',$5,$6,$7,$8,$9,$10,$11,$12,4096,100,3,2) RETURNING id`, serverUUID, serverUUID[:8], externalID, game.name, ownerID, nodeID, imported["nest_id"], imported["id"], allocationID, egg["startup"], images[label], game.memory).Scan(&serverID)
			if err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, "UPDATE allocations SET server_id=$1 WHERE id=$2", serverID, allocationID); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, "INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,default_value FROM egg_variables WHERE egg_id=$2", serverID, imported["id"]); err != nil {
				return err
			}
			// Consent defaults remain exactly as published. Installing a game must
			// still go through its normal agreement and license checks.
			if _, err = tx.Exec(ctx, `INSERT INTO subusers(user_id,server_id,permissions) VALUES($1,$2,'["control.console","control.start","control.stop","control.restart","file.read","file.read-content","file.update","file.create","backup.read","schedule.read","startup.read"]')`, memberID, serverID); err != nil {
				return err
			}
			var scheduleID int64
			if err = tx.QueryRow(ctx, "INSERT INTO schedules(server_id,name,cron_minute,cron_hour,is_active,only_when_online) VALUES($1,'Nightly local backup','0','3',false,true) RETURNING id", serverID).Scan(&scheduleID); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, "INSERT INTO tasks(schedule_id,sequence_id,action,payload) VALUES($1,1,'backup','')", scheduleID); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, "INSERT INTO activity_logs(event,actor_id,server_id,description) VALUES('dev:server.created',$1,$2,'Created local server metadata from the bundled game recipe; installation has not run')", ownerID, serverID); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}()
		if err != nil {
			return err
		}
	}
	return nil
}

func (a *App) localDevelopmentInventory(ctx context.Context) (M, M, error) {
	var nodeID int64
	if err := a.DB.QueryRow(ctx, "SELECT (value->>'node_id')::bigint FROM settings WHERE key=$1", LocalDevelopmentMarker).Scan(&nodeID); err != nil {
		return nil, nil, err
	}
	node, err := a.node(ctx, nodeID)
	if err != nil {
		return nil, nil, err
	}
	if str(node["fqdn"]) != "127.0.0.1" || num(node["daemon_listen"]) != 18085 || str(node["daemon_base"]) != "/var/lib/voltra-dev/volumes" {
		return nil, nil, errors.New("local Wings node address or volume root was changed; refusing to generate an unsafe configuration")
	}
	servers, err := a.query(ctx, "SELECT id,uuid,uuid_short,name,status,installed_at,external_id FROM servers ORDER BY id")
	if err != nil {
		return nil, nil, err
	}
	config := M{"debug": false, "uuid": node["uuid"], "token_id": node["daemon_token_id"], "token": node["daemon_token"], "api": M{"host": "0.0.0.0", "port": 18085, "ssl": M{"enabled": false}, "upload_limit": 100}, "system": M{"root_directory": "/var/lib/voltra-dev", "log_directory": "/var/lib/voltra-dev/logs", "data": "/var/lib/voltra-dev/volumes", "archive_directory": "/var/lib/voltra-dev/archives", "backup_directory": "/var/lib/voltra-dev/backups", "tmp_directory": "/var/lib/voltra-dev/tmp", "username": "pterodactyl", "machine_id": M{"directory": "/var/lib/voltra-dev/machine-id"}, "sftp": M{"bind_address": "0.0.0.0", "bind_port": 12025}}, "docker": M{"network": M{"name": "voltra_dev", "interface": "127.0.0.1", "network_mode": "voltra_dev", "driver": "bridge", "is_internal": false, "enable_icc": true, "interfaces": M{"v4": M{"subnet": "172.30.95.0/24", "gateway": "172.30.95.1"}}}}, "remote": "http://host.docker.internal:18089", "allowed_origins": []string{"http://127.0.0.1:5181", "http://127.0.0.1:18089"}}
	// Marshal here catches unsupported configuration values before returning.
	if _, err = json.Marshal(config); err != nil {
		return nil, nil, err
	}
	return M{"version": localDevelopmentVersion, "source": "bundled-catalog", "node_id": nodeID, "servers": servers, "admin_username": "admin", "member_username": "member", "url": a.Config.PublicURL}, config, nil
}
