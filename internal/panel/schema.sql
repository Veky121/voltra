CREATE TABLE IF NOT EXISTS users (
 id bigserial PRIMARY KEY, uuid text NOT NULL UNIQUE, external_id text UNIQUE, access_subject text UNIQUE,
 username text NOT NULL UNIQUE, email text NOT NULL UNIQUE, name_first text NOT NULL DEFAULT '', name_last text NOT NULL DEFAULT '',
 root_admin boolean NOT NULL DEFAULT false, disabled boolean NOT NULL DEFAULT false, language text NOT NULL DEFAULT 'en',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sftp_password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS browser_sessions (
 token_hash text PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS browser_sessions_expiry ON browser_sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
 bucket text PRIMARY KEY,attempts int NOT NULL DEFAULT 0,window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS desktop_pairings (
 code_hash text PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS desktop_devices (
 id text PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz,revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS desktop_devices_user ON desktop_devices(user_id);
CREATE TABLE IF NOT EXISTS api_keys (
 id bigserial PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,identifier text NOT NULL UNIQUE,
 token_hash text NOT NULL,type text NOT NULL DEFAULT 'client',memo text NOT NULL DEFAULT '',allowed_ips jsonb NOT NULL DEFAULT '[]',permissions jsonb NOT NULL DEFAULT '{}',last_used_at timestamptz,expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE TABLE IF NOT EXISTS ssh_keys (
 id bigserial PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,name text NOT NULL,public_key text NOT NULL,fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ssh_keys DROP CONSTRAINT IF EXISTS ssh_keys_fingerprint_key;
CREATE UNIQUE INDEX IF NOT EXISTS ssh_keys_user_fingerprint ON ssh_keys(user_id,fingerprint);
CREATE INDEX IF NOT EXISTS api_keys_token_hash ON api_keys(token_hash);
CREATE TABLE IF NOT EXISTS locations (
 id bigserial PRIMARY KEY,short text NOT NULL UNIQUE,long text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nodes (
 id bigserial PRIMARY KEY,uuid text NOT NULL UNIQUE,name text NOT NULL,description text NOT NULL DEFAULT '',location_id bigint NOT NULL REFERENCES locations(id),
 fqdn text NOT NULL,scheme text NOT NULL DEFAULT 'http',behind_proxy boolean NOT NULL DEFAULT false,public boolean NOT NULL DEFAULT true,
 memory bigint NOT NULL DEFAULT 4096,memory_overallocate bigint NOT NULL DEFAULT 0,disk bigint NOT NULL DEFAULT 20480,disk_overallocate bigint NOT NULL DEFAULT 0,
 upload_size bigint NOT NULL DEFAULT 100,daemon_listen bigint NOT NULL DEFAULT 8080,daemon_sftp bigint NOT NULL DEFAULT 2022,daemon_base text NOT NULL DEFAULT '/var/lib/voltra/volumes',
 daemon_token_id text NOT NULL UNIQUE,daemon_token text NOT NULL,maintenance_mode boolean NOT NULL DEFAULT false,allowed_origins jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE nodes ALTER COLUMN daemon_base SET DEFAULT '/var/lib/voltra/volumes';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS connection_mode text NOT NULL DEFAULT 'direct';
CREATE TABLE IF NOT EXISTS node_enrollments (
 id text PRIMARY KEY,token_hash text NOT NULL UNIQUE,location_id bigint REFERENCES locations(id),
 max_nodes bigint NOT NULL DEFAULT 0 CHECK(max_nodes>=0),approved_count bigint NOT NULL DEFAULT 0,
 closed boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS node_requests (
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES node_enrollments(id) ON DELETE CASCADE,
 request_token_hash text NOT NULL,hostname text NOT NULL,platform text NOT NULL,architecture text NOT NULL,
 memory_mib bigint NOT NULL,disk_mib bigint NOT NULL,verification_code text NOT NULL,remote_ip text NOT NULL,
 status text NOT NULL DEFAULT 'pending',node_id bigint REFERENCES nodes(id) ON DELETE SET NULL,
 connector_secret text,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS node_requests_session ON node_requests(session_id,created_at);
CREATE TABLE IF NOT EXISTS node_connectors (
 node_id bigint PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,
 revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE node_enrollments ADD COLUMN IF NOT EXISTS recovery_node_id bigint REFERENCES nodes(id) ON DELETE CASCADE;
ALTER TABLE node_connectors ADD COLUMN IF NOT EXISTS setup_stage text NOT NULL DEFAULT 'starting';
ALTER TABLE node_connectors ADD COLUMN IF NOT EXISTS setup_detail text NOT NULL DEFAULT '';
ALTER TABLE node_connectors ADD COLUMN IF NOT EXISTS maintenance_before_revoke boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS nests (
 id bigserial PRIMARY KEY,uuid text NOT NULL UNIQUE,author text NOT NULL,name text NOT NULL,description text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eggs (
 id bigserial PRIMARY KEY,uuid text NOT NULL UNIQUE,nest_id bigint NOT NULL REFERENCES nests(id),author text NOT NULL,name text NOT NULL,description text DEFAULT '',
 features jsonb DEFAULT '[]',docker_images jsonb NOT NULL DEFAULT '{}',file_denylist jsonb DEFAULT '[]',startup text NOT NULL DEFAULT '',
 config_files jsonb DEFAULT '{}',config_startup jsonb DEFAULT '{}',config_logs jsonb DEFAULT '{}',config_stop text DEFAULT '',
 config_from bigint REFERENCES eggs(id),script_install text DEFAULT '',script_entry text NOT NULL DEFAULT 'bash',script_container text NOT NULL DEFAULT 'alpine:3.23',
 script_is_privileged boolean NOT NULL DEFAULT false,copy_script_from bigint REFERENCES eggs(id),force_outgoing_ip boolean NOT NULL DEFAULT false,update_url text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE eggs ADD COLUMN IF NOT EXISTS java_config jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS egg_variables (
 id bigserial PRIMARY KEY,egg_id bigint NOT NULL REFERENCES eggs(id) ON DELETE CASCADE,name text NOT NULL,description text NOT NULL DEFAULT '',env_variable text NOT NULL,
 default_value text NOT NULL DEFAULT '',user_viewable boolean NOT NULL DEFAULT true,user_editable boolean NOT NULL DEFAULT true,rules text NOT NULL DEFAULT 'nullable|string',field_type text NOT NULL DEFAULT 'text',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE egg_variables DROP CONSTRAINT IF EXISTS egg_variables_egg_id_env_variable_key;
CREATE INDEX IF NOT EXISTS egg_variables_environment ON egg_variables(egg_id,env_variable);
CREATE TABLE IF NOT EXISTS servers (
 id bigserial PRIMARY KEY,uuid text NOT NULL UNIQUE,uuid_short text NOT NULL UNIQUE,identifier text NOT NULL UNIQUE,external_id text UNIQUE,name text NOT NULL,description text NOT NULL DEFAULT '',
 owner_id bigint NOT NULL REFERENCES users(id),node_id bigint NOT NULL REFERENCES nodes(id),nest_id bigint NOT NULL REFERENCES nests(id),egg_id bigint NOT NULL REFERENCES eggs(id),allocation_id bigint,
 startup text NOT NULL DEFAULT '',image text NOT NULL,status text,skip_scripts boolean NOT NULL DEFAULT false,installed_at timestamptz,installation_id text,
 memory bigint NOT NULL DEFAULT 1024,swap bigint NOT NULL DEFAULT 0,disk bigint NOT NULL DEFAULT 10240,io bigint NOT NULL DEFAULT 500,cpu bigint NOT NULL DEFAULT 100,threads text,
 oom_disabled boolean NOT NULL DEFAULT true,allocation_limit bigint NOT NULL DEFAULT 0,database_limit bigint NOT NULL DEFAULT 0,backup_limit bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS installation_id text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS java_config jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS servers_owner_id ON servers(owner_id);
CREATE INDEX IF NOT EXISTS servers_node_id ON servers(node_id);
CREATE TABLE IF NOT EXISTS allocations (
 id bigserial PRIMARY KEY,node_id bigint NOT NULL REFERENCES nodes(id),server_id bigint REFERENCES servers(id) ON DELETE SET NULL,ip text NOT NULL,ip_alias text,port bigint NOT NULL CHECK(port BETWEEN 1 AND 65535),notes text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(node_id,ip,port)
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='servers_allocation_fk' AND conrelid='servers'::regclass) THEN ALTER TABLE servers ADD CONSTRAINT servers_allocation_fk FOREIGN KEY(allocation_id) REFERENCES allocations(id); END IF; END $$;
CREATE TABLE IF NOT EXISTS server_variables (
 id bigserial PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,variable_id bigint NOT NULL REFERENCES egg_variables(id) ON DELETE CASCADE,variable_value text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(server_id,variable_id)
);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS configuration_overrides jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS subusers (
 id bigserial PRIMARY KEY,user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,permissions jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(server_id,user_id)
);
CREATE TABLE IF NOT EXISTS backups (
 id bigserial PRIMARY KEY,uuid text NOT NULL UNIQUE,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,name text NOT NULL,ignored_files jsonb NOT NULL DEFAULT '[]',disk text NOT NULL DEFAULT 'wings',
 checksum text,bytes bigint NOT NULL DEFAULT 0,is_successful boolean NOT NULL DEFAULT false,is_locked boolean NOT NULL DEFAULT false,completed_at timestamptz,upload_id text,deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE backups ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS schedules (
 id bigserial PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,name text NOT NULL,cron_minute text NOT NULL DEFAULT '*',cron_hour text NOT NULL DEFAULT '*',cron_day_of_month text NOT NULL DEFAULT '*',cron_month text NOT NULL DEFAULT '*',cron_day_of_week text NOT NULL DEFAULT '*',
 is_active boolean NOT NULL DEFAULT true,is_processing boolean NOT NULL DEFAULT false,only_when_online boolean NOT NULL DEFAULT false,last_run_at timestamptz,next_run_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedules_due ON schedules(next_run_at) WHERE is_active;
CREATE TABLE IF NOT EXISTS tasks (
 id bigserial PRIMARY KEY,schedule_id bigint NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,sequence_id bigint NOT NULL,action text NOT NULL,payload text NOT NULL DEFAULT '',time_offset bigint NOT NULL DEFAULT 0,
 continue_on_failure boolean NOT NULL DEFAULT false,is_queued boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,sequence_id)
);
CREATE TABLE IF NOT EXISTS schedule_runs (
 id bigserial PRIMARY KEY,schedule_id bigint NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,task_id bigint REFERENCES tasks(id) ON DELETE SET NULL,status text NOT NULL DEFAULT 'pending',next_task_sequence bigint NOT NULL DEFAULT 1,
 run_after timestamptz NOT NULL DEFAULT now(),last_error text,manual boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS task_id bigint REFERENCES tasks(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS schedule_runs_one_active ON schedule_runs(schedule_id) WHERE status IN ('pending','running');
CREATE TABLE IF NOT EXISTS database_hosts (
 id bigserial PRIMARY KEY,name text NOT NULL,host text NOT NULL,port bigint NOT NULL DEFAULT 3306,username text NOT NULL,password text NOT NULL,node_id bigint REFERENCES nodes(id) ON DELETE SET NULL,max_databases bigint,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS databases (
 id bigserial PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,database_host_id bigint NOT NULL REFERENCES database_hosts(id),database text NOT NULL,username text NOT NULL,remote text NOT NULL DEFAULT '%',password text NOT NULL,max_connections bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(database_host_id,database),UNIQUE(database_host_id,username)
);
CREATE TABLE IF NOT EXISTS mounts (
 id bigserial PRIMARY KEY,uuid text NOT NULL UNIQUE,name text NOT NULL,description text NOT NULL DEFAULT '',source text NOT NULL,target text NOT NULL,read_only boolean NOT NULL DEFAULT true,user_mountable boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mount_nodes (mount_id bigint REFERENCES mounts(id) ON DELETE CASCADE,node_id bigint REFERENCES nodes(id) ON DELETE CASCADE,PRIMARY KEY(mount_id,node_id));
CREATE UNIQUE INDEX IF NOT EXISTS mounts_name_unique ON mounts(name);
CREATE TABLE IF NOT EXISTS mount_eggs (mount_id bigint REFERENCES mounts(id) ON DELETE CASCADE,egg_id bigint REFERENCES eggs(id) ON DELETE CASCADE,PRIMARY KEY(mount_id,egg_id));
CREATE TABLE IF NOT EXISTS mount_servers (mount_id bigint REFERENCES mounts(id) ON DELETE CASCADE,server_id bigint REFERENCES servers(id) ON DELETE CASCADE,PRIMARY KEY(mount_id,server_id));
CREATE TABLE IF NOT EXISTS activity_logs (
 id bigserial PRIMARY KEY,batch text,event text NOT NULL,ip text NOT NULL DEFAULT '',description text,actor_id bigint REFERENCES users(id) ON DELETE SET NULL,server_id bigint REFERENCES servers(id) ON DELETE SET NULL,
 properties jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_logs_server_created ON activity_logs(server_id,created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_actor_created ON activity_logs(actor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS integrations (
 id bigserial PRIMARY KEY,name text NOT NULL,provider text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 egg_id bigint REFERENCES eggs(id) ON DELETE CASCADE,credentials text NOT NULL,bindings jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS server_integration_secrets (
 server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 variable_id bigint NOT NULL REFERENCES egg_variables(id) ON DELETE CASCADE,
 value text NOT NULL,PRIMARY KEY(server_id,variable_id)
);
ALTER TABLE server_integration_secrets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'integration';
CREATE TABLE IF NOT EXISTS server_transfers (
 id bigserial PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,old_node bigint NOT NULL,new_node bigint NOT NULL,old_allocation bigint,new_allocation bigint,
 old_additional_allocations jsonb NOT NULL DEFAULT '[]',new_additional_allocations jsonb NOT NULL DEFAULT '[]',successful boolean,archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE server_transfers DROP CONSTRAINT IF EXISTS server_transfers_old_node_fkey;
ALTER TABLE server_transfers DROP CONSTRAINT IF EXISTS server_transfers_new_node_fkey;
ALTER TABLE server_transfers DROP CONSTRAINT IF EXISTS server_transfers_old_allocation_fkey;
ALTER TABLE server_transfers DROP CONSTRAINT IF EXISTS server_transfers_new_allocation_fkey;
ALTER TABLE database_hosts DROP CONSTRAINT IF EXISTS database_hosts_node_id_fkey;
ALTER TABLE database_hosts ADD CONSTRAINT database_hosts_node_id_fkey FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL;
-- Outbound panel email was removed. Retire its queue and transport credentials.
DROP TABLE IF EXISTS notification_jobs;
DELETE FROM settings WHERE key LIKE 'mail:%' OR key LIKE 'pterodactyl:email:%';
CREATE TABLE IF NOT EXISTS daemon_revocations (
 id bigserial PRIMARY KEY,node_id bigint NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,server_uuid text NOT NULL,user_uuid text NOT NULL,generation bigint NOT NULL DEFAULT 1,attempts bigint NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,lease_token text,last_error text,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE daemon_revocations ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS daemon_revocations_pending ON daemon_revocations(node_id,server_uuid,user_uuid) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS daemon_revocations_due ON daemon_revocations(next_attempt_at) WHERE completed_at IS NULL;
CREATE TABLE IF NOT EXISTS steam_servers (
 server_id bigint PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,game text NOT NULL,app_id bigint NOT NULL CHECK(app_id>0),branch text NOT NULL DEFAULT 'public',
 mode text NOT NULL DEFAULT 'on_start' CHECK(mode IN ('on_start','scheduled','off')),check_interval_seconds bigint NOT NULL DEFAULT 3600 CHECK(check_interval_seconds BETWEEN 300 AND 86400),
 installed_build text NOT NULL DEFAULT '',latest_build text NOT NULL DEFAULT '',update_available boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz,last_attempt_at timestamptz,last_failed_at timestamptz,last_error text NOT NULL DEFAULT '',needs_repair boolean NOT NULL DEFAULT true,initialized boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE steam_servers ADD COLUMN IF NOT EXISTS beta_password_encrypted text NOT NULL DEFAULT '';
ALTER TABLE steam_servers ADD COLUMN IF NOT EXISTS console_password_encrypted text NOT NULL DEFAULT '';
ALTER TABLE steam_servers ADD COLUMN IF NOT EXISTS join_password_encrypted text NOT NULL DEFAULT '';
ALTER TABLE steam_servers ADD COLUMN IF NOT EXISTS validate_on_start boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS steam_jobs (
 id text PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,operation text NOT NULL CHECK(operation IN ('install','check','update','verify','start')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),stage text NOT NULL DEFAULT 'queued',detail text NOT NULL DEFAULT 'Waiting for maintenance.',error text NOT NULL DEFAULT '',
 start_after boolean NOT NULL DEFAULT false,force boolean NOT NULL DEFAULT false,restart boolean NOT NULL DEFAULT false,files_changed boolean NOT NULL DEFAULT false,lease_token text,lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS steam_jobs_one_active ON steam_jobs(server_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS steam_jobs_pending ON steam_jobs(created_at) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS steam_job_events (
 id bigserial PRIMARY KEY,job_id text NOT NULL REFERENCES steam_jobs(id) ON DELETE CASCADE,stage text NOT NULL,detail text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steam_job_events_job ON steam_job_events(job_id,id);
ALTER TABLE steam_jobs ADD COLUMN IF NOT EXISTS executor text NOT NULL DEFAULT 'steamcmd-v1' CHECK(executor IN ('steamcmd-v1','steamkit-depot-v1'));
CREATE TABLE IF NOT EXISTS steam_private_authorizations (
 id text PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,actor_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 owner_scope text NOT NULL CHECK(owner_scope ~ '^[a-f0-9]{64}$'),generation text NOT NULL,identity_cipher text NOT NULL,credential_cipher text NOT NULL DEFAULT '',revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steam_private_authorizations_actor ON steam_private_authorizations(server_id,actor_id);
CREATE TABLE IF NOT EXISTS steam_private_jobs (
 job_id text PRIMARY KEY REFERENCES steam_jobs(id) ON DELETE CASCADE,authorization_id text NOT NULL REFERENCES steam_private_authorizations(id) ON DELETE CASCADE,actor_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_auth_kind text NOT NULL CHECK(actor_auth_kind IN ('session','api_key')),actor_auth_id text NOT NULL,
 authorization_generation text NOT NULL,node_id bigint NOT NULL,server_owner_id bigint NOT NULL,egg_id bigint NOT NULL,installation_id text NOT NULL DEFAULT '',
 request jsonb NOT NULL,input_cipher text NOT NULL DEFAULT '',input_consumed boolean NOT NULL DEFAULT false,cancel_requested boolean NOT NULL DEFAULT false,
 receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
-- Publication ownership outlives credential records and terminal job outcomes.
CREATE TABLE IF NOT EXISTS steam_private_attempts (
 job_id text PRIMARY KEY,server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 node_id bigint NOT NULL,server_owner_id bigint NOT NULL,egg_id bigint NOT NULL,installation_id text NOT NULL,
 request jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steam_private_attempts_server ON steam_private_attempts(server_id,created_at DESC);
INSERT INTO steam_private_attempts(job_id,server_id,node_id,server_owner_id,egg_id,installation_id,request,created_at)
 SELECT p.job_id,j.server_id,p.node_id,p.server_owner_id,p.egg_id,p.installation_id,p.request,p.created_at
 FROM steam_private_jobs p JOIN steam_jobs j ON j.id=p.job_id
 ON CONFLICT(job_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS steam_private_publications (
 server_id bigint PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
 job_id text NOT NULL,node_id bigint NOT NULL,server_owner_id bigint NOT NULL,egg_id bigint NOT NULL,installation_id text NOT NULL,
 receipt jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO steam_private_publications(server_id,job_id,node_id,server_owner_id,egg_id,installation_id,receipt,updated_at)
 SELECT DISTINCT ON(j.server_id) j.server_id,p.job_id,p.node_id,p.server_owner_id,p.egg_id,p.installation_id,p.receipt,p.updated_at
 FROM steam_private_jobs p JOIN steam_jobs j ON j.id=p.job_id WHERE p.receipt IS NOT NULL
 ORDER BY j.server_id,p.updated_at DESC,p.job_id DESC
 ON CONFLICT(server_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS user_server_navigation (
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 favorite boolean NOT NULL DEFAULT false,last_visited_at timestamptz,
 PRIMARY KEY(user_id,server_id)
);
CREATE TABLE IF NOT EXISTS steam_game_provisions (
 actor_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id text NOT NULL,game text NOT NULL,input_hash text NOT NULL,
 server_id bigint REFERENCES servers(id) ON DELETE SET NULL,settings jsonb NOT NULL DEFAULT '{}',stage text NOT NULL DEFAULT 'reserved',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,request_id)
);

-- FRP gateway desired state. Reservations survive failed remote operations.
CREATE TABLE IF NOT EXISTS proxy_gateways (
 id bigserial PRIMARY KEY, name text NOT NULL, public_host text NOT NULL,
 public_port_start integer NOT NULL CHECK(public_port_start BETWEEN 1 AND 65535),
 public_port_end integer NOT NULL CHECK(public_port_end BETWEEN public_port_start AND 65535),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS proxy_node_clients (
 id bigserial PRIMARY KEY, gateway_id bigint NOT NULL REFERENCES proxy_gateways(id), node_id bigint NOT NULL REFERENCES nodes(id),
 admin_url text NOT NULL, credentials_encrypted text NOT NULL,
 local_port_start integer NOT NULL CHECK(local_port_start BETWEEN 1 AND 65535),
 local_port_end integer NOT NULL CHECK(local_port_end BETWEEN local_port_start AND 65535),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(gateway_id,node_id), UNIQUE(id,gateway_id)
);
CREATE TABLE IF NOT EXISTS proxy_routes (
 id bigserial PRIMARY KEY, gateway_id bigint NOT NULL REFERENCES proxy_gateways(id), client_id bigint NOT NULL,
 server_id bigint NOT NULL REFERENCES servers(id), allocation_id bigint NOT NULL REFERENCES allocations(id),
 protocol text NOT NULL CHECK(protocol IN ('tcp','udp')), public_port integer NOT NULL CHECK(public_port BETWEEN 1 AND 65535),
 local_ip text NOT NULL, local_port integer NOT NULL CHECK(local_port BETWEEN 1 AND 65535), proxy_name text NOT NULL UNIQUE,
 desired_present boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','error')), last_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(client_id,gateway_id) REFERENCES proxy_node_clients(id,gateway_id),
 UNIQUE(gateway_id,protocol,public_port), UNIQUE(client_id,allocation_id,protocol)
);
ALTER TABLE proxy_gateways ADD COLUMN IF NOT EXISTS server_host text NOT NULL DEFAULT '';
ALTER TABLE proxy_gateways ADD COLUMN IF NOT EXISTS server_port integer NOT NULL DEFAULT 7000 CHECK(server_port BETWEEN 1 AND 65535);
ALTER TABLE proxy_gateways ADD COLUMN IF NOT EXISTS auth_token_encrypted text NOT NULL DEFAULT '';
ALTER TABLE proxy_node_clients ADD COLUMN IF NOT EXISTS setup_complete boolean NOT NULL DEFAULT false;
ALTER TABLE proxy_node_clients ADD COLUMN IF NOT EXISTS test_status text NOT NULL DEFAULT 'pending';
ALTER TABLE proxy_node_clients ADD COLUMN IF NOT EXISTS test_error text NOT NULL DEFAULT '';
ALTER TABLE proxy_node_clients ADD COLUMN IF NOT EXISTS test_public_port integer;
ALTER TABLE proxy_node_clients ADD COLUMN IF NOT EXISTS test_proxy_name text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION proxy_guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.node_id,NEW.server_id,NEW.ip,NEW.port) IS DISTINCT FROM (OLD.node_id,OLD.server_id,OLD.ip,OLD.port) AND EXISTS(SELECT 1 FROM proxy_routes WHERE allocation_id=OLD.id) THEN RAISE EXCEPTION 'Remove and reconcile proxy routes before changing allocation target'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proxy_guard_allocation ON allocations;
CREATE TRIGGER proxy_guard_allocation BEFORE UPDATE ON allocations FOR EACH ROW EXECUTE FUNCTION proxy_guard_allocation();
CREATE OR REPLACE FUNCTION proxy_guard_server() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.node_id IS DISTINCT FROM OLD.node_id AND EXISTS(SELECT 1 FROM proxy_routes WHERE server_id=OLD.id) THEN RAISE EXCEPTION 'Remove and reconcile proxy routes before transferring server'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proxy_guard_server ON servers;
CREATE TRIGGER proxy_guard_server BEFORE UPDATE ON servers FOR EACH ROW EXECUTE FUNCTION proxy_guard_server();
CREATE UNIQUE INDEX IF NOT EXISTS proxy_node_clients_admin_origin ON proxy_node_clients(admin_url);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS minecraft_pack jsonb NOT NULL DEFAULT '{}';

-- Disposable bounded console history, retained across panel and game restarts.
CREATE TABLE IF NOT EXISTS console_log_entries (
 id bigserial PRIMARY KEY, server_id bigint NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 event text NOT NULL CHECK(event IN ('console output','daemon message','install output','panel message')),
 line text NOT NULL CHECK(octet_length(line)<=17000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS console_log_entries_server ON console_log_entries(server_id,id DESC);
CREATE TABLE IF NOT EXISTS console_log_collectors (
 server_id bigint PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
 lease_owner text NOT NULL DEFAULT '', lease_until timestamptz NOT NULL DEFAULT '-infinity',
 connected boolean NOT NULL DEFAULT false, last_event_at timestamptz
);
