-- Root merges this fragment into canonical schema; no live migration here.
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

