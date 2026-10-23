# Shared implementation contract

## Backend

Go module voltra; all handlers are package panel, under internal/panel. Each owner defines func (a *App) registerAccounts(mux *http.ServeMux), registerEggs, registerInfrastructure, registerLifecycle, registerOperations, registerCollaboration respectively. Go 1.27.3 ServeMux patterns use METHOD /path/{param}; r.PathValue("server"). Register direct native routes with full /api/client, /api/application, /api/remote paths. Additional admin CRUD routes may use /api/admin but reuse same service behavior. Root wraps the mux with session/API authentication, optional pre-setup loopback development identity and common error/panic/CORS controls. Do not blanket require user identity on /api/remote: daemon authentication belongs to lifecycle. Application/admin APIs must call a.requireAdmin(r) or require an appropriately scoped application API key. UserID defaults to admin1 on loopback dev only before first-run setup. First-run administrator/password sessions are implemented; Cloudflare Access remains deferred.

App fields: DB *pgxpool.Pool; Config Config; HTTP *http.Client. Config fields Listen, DatabaseURL, PublicURL, DaemonURL, WebDir, LocalesDir, Timezone string; DevMode bool; DevUserID int64; EncryptionKey string. Core supplies DB helpers a.query(ctx,sql,args...) ([]M,error), a.one(ctx,sql,args...) (M,error), a.exec(ctx,sql,args...) error, a.insert(ctx,table string,data M)(M,error), a.update(ctx,table string,id int64,data M)(M,error). Helpers whitelist SQL identifiers. All row numeric integer values normalize to int64. JSONB values decode to maps/slices. M = map[string]any. Helpers num(any) int64, str(any) string, boolean(any) bool, asMap(any) M, asSlice(any) []any, now() string, newUUID() string, randomToken(bytes int) string.

HTTP helpers: writeJSON(w,status,value), item(object string,attributes M) M returning {object,attributes}, collection(object string, rows []M) M returning {object:"list",data:[item(...)]}, fail(w,err) writes structured errors. APIError{Status int,Code,Detail string}; bad(detail) error, forbidden() error, notFound() error. decode(r) (M,error), max 4MiB JSON. Handler methods call err handling explicitly. All SQL uses PostgreSQL $n arguments.

Context identity: a.user(r) (M,error), a.requireAdmin(r) (M,error), a.server(r,permission string)(M,error), a.can(ctx,user M,server M,permission string) bool. Implemented by accounts owner, signatures stable. a.server resolves {server} by UUID, uuid_short or numeric id and enforces owner/admin/subuser and suspended/install states when appropriate. App key scopes can be checked by accounts helpers. user ID from context is supplied root; root exports UserID(r) int64, WithUser(r,id int64)*http.Request; key context coordinated with accounts.

Audit helper root: a.audit(ctx,userID,serverID int64,event string,properties M) error.

Daemon integration lifecycle owner: a.node(ctx,id int64)(M,error); a.daemon(ctx,node M,method,path string,body any)(*http.Response,error); a.serverConfig(ctx,server M)(M,error); a.clientServer(ctx,user M,server M)(M,error); a.syncServer(ctx,server M) error; a.createServer(ctx,data M)(M,error). Daemon body can be nil, M/other JSON value or io.Reader for raw data. Caller closes response body. Daemon helper rejects non-2xx with safe APIError, supports encoded path/query, authenticates outbound bearer daemon_token. Inbound Wings callbacks authenticate token_id.token. a.daemonServer(ctx,server M,method,pathSuffix string,body any) same response helper prepends /api/servers/{uuid}. Operations owner supplies websocket JWT and signed file/download upload tokens using node daemon_token with HS256 based on upstream code; coordinate external browser websocket URL through same-origin /api/wings proxy if needed.

## Database tables

Root supplies PostgreSQL schema with native-style snake_case fields. All IDs bigserial except UUIDs stored text. Every table has created_at/updated_at timestamptz defaults unless noted.

users: id, uuid, external_id nullable, access_subject nullable, username unique, email unique, name_first, name_last, root_admin bool, disabled bool, language default en.
api_keys: id,user_id FK,identifier unique,token_hash,type default client,memo,allowed_ips jsonb [],permissions jsonb {},last_used_at nullable.
ssh_keys: id,user_id,name,public_key,fingerprint unique.
locations: id,short unique,long.
nodes: id,uuid,name,description,location_id,fqdn,scheme default http,behind_proxy bool,public bool,memory,memory_overallocate,disk,disk_overallocate,upload_size,daemon_listen,daemon_sftp,daemon_base,daemon_token_id,daemon_token,maintenance_mode bool,allowed_origins jsonb [].
allocations: id,node_id,server_id nullable,ip,ip_alias nullable,port,notes nullable; unique node_id,ip,port.
nests: id,uuid,author,name,description.
eggs: id,uuid,nest_id,author,name,description,features jsonb [],docker_images jsonb {},file_denylist jsonb [],startup,config_files jsonb {},config_startup jsonb {},config_logs jsonb {},config_stop,config_from nullable FK,script_install,script_entry default bash,script_container,script_is_privileged bool,copy_script_from nullable FK,force_outgoing_ip bool,update_url nullable.
egg_variables: id,egg_id,name,description,env_variable,default_value,user_viewable bool,user_editable bool,rules,field_type default text. Duplicate environment names are preserved in import order, matching native eggs.
servers: id,uuid,uuid_short unique,identifier unique,external_id nullable,name,description,owner_id,node_id,nest_id,egg_id,allocation_id nullable,startup,image,status nullable,skip_scripts bool,installed_at nullable,memory,swap,disk,io,cpu,threads nullable,oom_disabled bool,allocation_limit,database_limit,backup_limit; statuses installing,install_failed,suspended,restoring_backup or null.
server_variables: id,server_id,variable_id,variable_value; unique server_id,variable_id.
subusers: id,user_id,server_id,permissions jsonb []; unique server_id,user_id.
backups: id,uuid,server_id,name,ignored_files jsonb [],disk default wings,checksum nullable,bytes bigint,is_successful bool,is_locked bool,completed_at nullable,upload_id nullable.
schedules: id,server_id,name,cron_minute,cron_hour,cron_day_of_month,cron_month,cron_day_of_week,is_active bool,is_processing bool,only_when_online bool,last_run_at nullable,next_run_at nullable.
tasks: id,schedule_id,sequence_id,action,payload,time_offset,continue_on_failure bool,is_queued bool.
database_hosts: id,name,host,port,username,password,node_id nullable,max_databases nullable.
databases: id,server_id,database_host_id,database,username,remote,password,max_connections default 0.
mounts: id,uuid,name,description,source,target,read_only bool,user_mountable bool.
mount_nodes: mount_id,node_id; mount_eggs: mount_id,egg_id; mount_servers: mount_id,server_id.
activity_logs: id,batch nullable,event,ip,description nullable,actor_id nullable,server_id nullable,properties jsonb {},created_at.
settings: key text primary key,value jsonb.
server_transfers: id,server_id,old_node,new_node,old_allocation,new_allocation,old_additional_allocations jsonb [],new_additional_allocations jsonb [],successful nullable bool,archived bool.

Additions required by owners: message root; root will extend schema. Use transactions for dependent mutations. No migrations/deletions against original MariaDB database.

## Frontend

React19 + Vite modern TypeScript, new web directory. Client owner exports default Client from web/src/Client.tsx; admin owner default Admin from web/src/Admin.tsx. Root shell routes /admin/* to Admin, everything else Client. Owners may use react-router-dom v7 BrowserRouter route hooks and Routes. Root provides web/src/lib.tsx:
- api<T=any>(path:string,options?:RequestInit):Promise<T>, JSON/string request bodies use JSON.stringify at caller; throws Error with server errors; handles 204.
- unwrap(response:any):any => response.attributes; rows(response:any):any[] => response.data.map(x=>({...x.attributes,...(x.meta?{_meta:x.meta}:{})})).
- useAPI<T=any>(path:string|null): {data:T|null,error:string,loading:boolean,reload:()=>void}.
- Button, Input, Select, Textarea, Field, Card, ErrorBox, Loading, Empty, Modal shared components. Standard HTML props plus children; Field props label:string,hint?:string,children. Modal props title:string,onClose:()=>void,children. Button accepts variant default/secondary/danger. Root styles classes .page,.page-header,.toolbar,.grid,.grid-2,.card,.table,.form-grid,.muted,.badge,.danger,.success,.tabs,.error,.field,.actions. Root supplies app shell nav; domain owner handles subnavigation. API paths same upstream wherever possible. New admin screen APIs may /api/admin; coordinate with backend owners. Functional controls must call real backend; do not make pretty fake pages or inactive buttons.

Auth UI: the approved first-run setup and password/session sign-in are implemented by setup.tsx and setup.go. Cloudflare Access and 2FA remain deferred. Existing local development defaults to admin until setup is explicitly completed. Configured installations must authenticate browser sessions. Setup bootstrap requires a direct loopback request. API/SSH keys stay functional.

## Testing/runtime

Root brings new PostgreSQL localhost:55432, new app localhost:8088 and Vite localhost:5180. Existing PHP panel8090 and Wings18083 remain reference only. New real Wings separate ports18084/12023, daemon remote URL Go app8088 accessible host.docker.internal. Do not expose dev admin publicly. Root will provide environment variables, per-domain tests should use TEST_DATABASE_URL and isolated rollback/cleanup. Run `go test ./...` after dependencies exist; while other domains incomplete use focused file tests or report compile dependencies. No fake-success tests or unsupported behavior silently skipped. The reference route inventory and eggs corpus are under ../pterodactyl-vite/artifacts and upstream/game-eggs.
