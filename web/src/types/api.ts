// Shapes the panel returns, as built by internal/panel (see CONTRACT.md).
// Only fields the web app reads are listed; a response may carry more.

/** One resource, as built by `item(object, attributes)`. */
export type Resource<T, M = unknown> = {object: string; attributes: T; meta?: M};

/** `meta.pagination` from `listPage.Meta`. */
export type Pagination = {
  total: number;
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
  links?: Record<string, string>;
};
export type ListMeta = {pagination?: Pagination};

/** A list, as built by `collection(object, rows)`. */
export type ResourceList<T, M = unknown> = {object: 'list'; data: Resource<T, M>[]; meta?: ListMeta};

/** A row from `rows()`/`items()`: the attributes plus the item's own meta. */
export type Row<T, M = unknown> = T & {_meta?: M};

/** A response whose fields are not described here. Read it with a guard. */
export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structured error body written by `fail(w, err)`. */
export type APIErrorBody = {
  errors?: {code?: string; detail?: string; message?: string; request_id?: string}[];
  message?: string;
  error?: string;
};

/** `GET /api/auth/session` (`browserSession`). */
export type Session = {
  authenticated: boolean;
  auth_provider?: 'password' | 'cloudflare';
  csrf_token?: string;
  user?: {id?: number; username?: string; nickname?: string; root_admin: boolean};
};

/** `GET /api/client/account` (`accountAttributes`). The only response that carries the user's own email. */
export type Account = {
  id: number;
  uuid: string;
  admin: boolean;
  root_admin: boolean;
  username: string;
  nickname: string;
  email: string;
  first_name: string;
  last_name: string;
  language: string;
  auth_provider: 'development' | 'password' | 'cloudflare';
  cloudflare_pending: boolean;
  sftp_password_set: boolean;
};

/** Admin user lists and pickers (`userAttributes`). No email. */
export type User = {
  id: number;
  uuid: string;
  external_id: string | null;
  username: string;
  nickname: string;
  first_name: string;
  last_name: string;
  language: string;
  root_admin: boolean;
  disabled: boolean;
  sftp_password_set: boolean;
  created_at: string;
  updated_at: string;
};

/** `serverLimits`: integer MiB for memory, swap and disk. */
export type ServerLimits = {
  memory: number;
  swap: number;
  disk: number;
  io: number;
  cpu: number;
  threads: string | null;
  oom_disabled: boolean;
};
/** `serverFeatures`. */
export type ServerFeatureLimits = {databases: number; allocations: number; backups: number};

export type Allocation = {
  id: number;
  node_id: number;
  server_id: number | null;
  ip: string;
  ip_alias: string | null;
  alias: string | null;
  port: number;
  notes: string | null;
  /** Client server responses: the server's primary allocation. */
  is_default?: boolean;
  /** Admin node responses: taken by a server. */
  assigned?: boolean;
};

export type EggVariable = {
  id: number;
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  server_value?: string;
  user_viewable: boolean;
  user_editable: boolean;
  rules: string;
  field_type: string;
};

/** `clientArtworkMetadata`: empty unless the server runs Minecraft. */
export type ServerArtwork = {game?: 'minecraft'; server_icon?: string; pack_name?: string; pack_icon?: string};

/** `GET /api/client/servers/{server}` and `GET /api/client` (`clientServer`). */
export type Server = {
  server_owner: boolean;
  identifier: string;
  __deprecated_uuid_short: string;
  server_identifier: string;
  internal_id: number;
  uuid: string;
  name: string;
  /** The node's name. */
  node: string;
  is_node_under_maintenance: boolean;
  sftp_details: {ip: string; port: number};
  description: string;
  limits: ServerLimits;
  feature_limits: ServerFeatureLimits;
  invocation: string;
  java_managed?: boolean;
  java_effective_error?: string;
  docker_image: string;
  game: string;
  minecraft_content_supported: boolean;
  steam_managed: boolean;
  egg_features: string[] | null;
  console_input_supported: boolean;
  status: string | null;
  is_suspended: boolean;
  is_installing: boolean;
  is_transferring: boolean;
  skip_scripts: boolean;
  artwork: ServerArtwork;
  relationships?: {allocations?: ResourceList<Allocation>; variables?: ResourceList<EggVariable>};
};

/** `meta` on `GET /api/client/servers/{server}`. */
export type ServerMeta = {is_server_owner: boolean; user_permissions: string[]};

/** `GET /api/admin/servers` and `/api/application/servers` (`applicationServerAttributes`). Relationships follow `include`. */
export type AdminServer = {
  id: number;
  uuid: string;
  identifier: string;
  external_id: string | null;
  name: string;
  description: string;
  status: string | null;
  suspended: boolean;
  limits: ServerLimits;
  feature_limits: ServerFeatureLimits;
  java_config: Record<string, unknown>;
  /** Owner id. */
  user: number;
  /** Node id. */
  node: number;
  allocation: number | null;
  nest: number;
  egg: number;
  container: {
    startup_command: string;
    image: string;
    installed: 0 | 1;
    environment: Record<string, string>;
    skip_scripts: boolean;
  };
  created_at: string;
  updated_at: string;
  relationships?: {
    node?: Resource<Node>;
    user?: Resource<User>;
    egg?: Resource<Egg>;
    allocations?: ResourceList<Allocation>;
    variables?: ResourceList<EggVariable>;
  };
};

/** `GET /api/admin/nodes` (`infraPresent`): the nodes row without its daemon token. */
export type Node = {
  id: number;
  uuid: string;
  name: string;
  description: string;
  location_id: number;
  fqdn: string;
  scheme: 'http' | 'https';
  behind_proxy: boolean;
  public: boolean;
  memory: number;
  memory_overallocate: number;
  disk: number;
  disk_overallocate: number;
  upload_size: number;
  daemon_listen: number;
  daemon_sftp: number;
  daemon_base: string;
  maintenance_mode: boolean;
  allowed_origins: string[];
  connection_mode: 'direct' | 'outbound';
  allocated_resources?: {memory: number; disk: number};
  servers_count?: number;
  created_at: string;
  updated_at: string;
};

export type Location = {
  id: number;
  short: string;
  long: string;
  nodes_count?: number;
  created_at: string;
  updated_at: string;
};

/** `GET /api/client/settings` (`clientSiteSettings`). */
export type SiteSettings = {name?: string; locale?: string; timezone?: string};

/** A row of the tasks table, in `relationships.tasks` of a schedule. */
export type ScheduleTask = {
  id: number;
  schedule_id: number;
  sequence_id: number;
  action: 'command' | 'power' | 'backup' | string;
  payload: string;
  time_offset: number;
  continue_on_failure: boolean;
  is_queued: boolean;
};

/** `GET /api/client/servers/{server}/schedules` (`collabScheduleView`). */
export type Schedule = {
  id: number;
  name: string;
  is_active: boolean;
  is_processing: boolean;
  only_when_online: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  cron: {minute: string; hour: string; day_of_month: string; month: string; day_of_week: string};
  relationships: {tasks: ResourceList<ScheduleTask>};
  created_at: string;
  updated_at: string;
};

export type BackupOrigin = {type?: 'manual' | 'scheduled' | 'unknown'; created_by?: string; schedule_name?: string};
/** `GET /api/client/servers/{server}/backups` (`opBackupTransform`). */
export type Backup = {
  uuid: string;
  is_successful: boolean;
  is_locked: boolean;
  name: string;
  ignored_files: string[];
  checksum: string | null;
  bytes: number;
  created_at: string;
  completed_at: string | null;
  disk: string;
  origin?: BackupOrigin;
};
/** `meta.storage` of the backup list (`backupStorageSummary`). */
export type BackupStorageSummary = {
  local_bytes: number;
  remote_bytes: number;
  other_bytes: number;
  total_bytes: number;
  pending_count: number;
  failed_count: number;
  latest_successful_backup: {uuid: string; name: string; completed_at: string; bytes: number} | null;
};
export type BackupList = ResourceList<Backup> & {meta?: {backup_count?: number; storage?: BackupStorageSummary}};

/** `resources` in `GET {server}/resources` (`clientResourceResponse`): bytes, CPU percent, uptime in ms. */
export type ServerResources = {
  memory_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  uptime: number;
};
/** `GET /api/client/servers/{server}/resources`. */
/** `fs25_services` is present only for Farming Simulator 25 servers. */
export type ServerStats = {
  current_state: string;
  is_suspended: boolean;
  fs25_services?: {portal: string; game: string};
  resources: ServerResources;
};

/** `GET /api/client?summary=overview` (`serverSummary`): a lighter server for the overview cards. */
export type ServerSummary = Pick<
  Server,
  | 'identifier'
  | 'uuid'
  | 'name'
  | 'description'
  | 'node'
  | 'is_node_under_maintenance'
  | 'limits'
  | 'game'
  | 'docker_image'
  | 'status'
  | 'is_installing'
  | 'is_suspended'
  | 'is_transferring'
  | 'artwork'
> & {
  egg_name: string;
  relationships: {variables: ResourceList<Pick<EggVariable, 'env_variable' | 'server_value'>>};
};
/** `GET /api/client?summary=overview&states=1`. */
export type ServerState = {uuid: string; status: string | null};

/** One saved console line in `GET {server}/console-history`. Ids are decimal strings. */
export type ConsoleHistoryEntry = {id: string; event: string; line: string; created_at: string};
/** `GET {server}/console-history` (`console_logs.go`). Cursors are decimal strings. */
export type ConsoleHistoryPage = {
  data: ConsoleHistoryEntry[] | null;
  after: string;
  head: string;
  cursor: string;
  more: boolean;
  reset: boolean;
  truncated: boolean;
  limits: {lines: number; bytes: number};
  run_start: string;
  capture: {connected: boolean; last_event_at: string | null};
};

/** A proxy route. `GET {server}/proxy-routes` sends id, public_host, public_port, local_port, protocol and status. */
export type ProxyRoute = {
  id: number;
  gateway_id?: number;
  client_id?: number;
  allocation_id?: number;
  local_ip?: string;
  local_port: number;
  public_host: string;
  public_port: number;
  protocol: string;
  status: string;
  desired_present?: boolean;
  last_error?: string | null;
  gateway_name?: string;
};
/** A gateway connector on the server's node, in `GET /api/admin/servers/{server}/proxy`. */
export type ProxySetupClient = {
  id: number;
  gateway_id: number;
  local_port_start: number;
  local_port_end: number;
  setup_complete: boolean;
  test_status: string;
  name: string;
  public_host: string;
  public_port_start: number;
  public_port_end: number;
};
export type ProxySetupAllocation = {
  id: number;
  ip: string;
  port: number;
  notes: string | null;
  is_default: boolean;
  forward_client_ids: number[];
};
/** `GET /api/admin/servers/{server}/proxy` (`serverProxySetup`). */
export type ServerProxySetup = {
  allocations: ProxySetupAllocation[];
  clients: ProxySetupClient[];
  routes: ProxyRoute[];
  primary_protocol: string;
};

/** `GET {server}/subdomain` (`subdomainServer`). */
/** A route a join name can point at. */
export type SubdomainChoice = {
  id: number;
  gateway_id: number;
  public_port: number;
  protocol: string;
  status: string;
  public_host: string;
  domain: string;
  integration_id: number;
};
export type ServerSubdomain = {
  choices: SubdomainChoice[];
  hostname: string;
  label: string;
  dns_matches: boolean;
  dns_status?: string;
  detail: string;
  cleanup_pending: boolean;
  route?: SubdomainChoice;
};

/** What the game-library install endpoints answer with: the new server. */
export type InstalledServer = Partial<Pick<Server, 'identifier' | 'uuid' | 'name'>>;

/** `GET {server}/databases` (`collabDatabaseView`, client form). */
export type ServerDatabase = {
  id: number;
  host: {address: string; port: number};
  name: string;
  username: string;
  connections_from: string;
  max_connections: number;
  relationships?: {password?: Resource<{password: string}>};
};

/** `GET {server}/users` (`collabUser` plus access flags). No email. */
export type Subuser = {
  id: number;
  uuid: string;
  identifier: string;
  username: string;
  nickname: string;
  created_at: string;
  permissions: string[] | null;
  is_owner: boolean;
  is_admin: boolean;
  is_current_user: boolean;
  inherited_access: boolean;
};

/** `GET /api/client/permissions` (`permissionCatalog`). */
export type PermissionCatalog = {permissions: Record<string, {description: string; keys: Record<string, string>}>};

/** `GET {server}/network/allocations` (`clientAllocations`): with the protocols each port forwards. */
export type ServerAllocation = Allocation & {protocols: string[]; protocol_source: string};

/** `GET .../activity` (`collabActivity`). `relationships.actor` is present with `include=actor`. */
export type ActivityLog = {
  id: string;
  batch: string | null;
  event: string;
  is_api: boolean;
  ip: string;
  description: string | null;
  properties: Record<string, unknown> & {nickname?: string};
  has_additional_metadata: boolean;
  timestamp: string;
  relationships?: {
    actor?: Resource<
      Pick<Subuser, 'id' | 'uuid' | 'identifier' | 'username' | 'nickname' | 'created_at' | 'permissions'>
    >;
  };
};

/** `GET /api/client/account/api-keys` (`apiKeyAttributes`). */
export type ApiKey = {
  identifier: string;
  user_id: number;
  description: string;
  allowed_ips: string[] | null;
  permissions: Record<string, unknown>;
  type: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};
/** `GET /api/client/account/ssh-keys`. */
export type SSHKey = {name: string; public_key: string; fingerprint: string; created_at: string};

/** `GET /api/admin/eggs/{egg}` (`eggAttributes`). */
export type Egg = {
  id: number;
  uuid: string;
  nest: number;
  nest_id: number;
  name: string;
  author: string;
  description: string;
  docker_image: string;
  docker_images: Record<string, string>;
  startup: string;
  features: string[] | null;
  force_outgoing_ip: boolean;
  update_url: string | null;
  download_headers: Record<string, unknown>;
  java_config: Record<string, unknown>;
  relationships?: {variables?: ResourceList<EggVariable>};
};

/** A mounts row; `attached` in `GET /api/admin/servers/{server}/mounts`. */
export type Mount = {
  id: number;
  uuid: string;
  name: string;
  description: string;
  source: string;
  target: string;
  read_only: boolean;
  user_mountable: boolean;
  attached?: boolean;
};

export type Nest = {
  id: number;
  uuid: string;
  author: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

/** `GET /api/admin/integrations` (`integrations.go`). Secrets are reported only as configured. */
export type Integration = {
  id: number;
  name: string;
  provider: string;
  enabled: boolean;
  egg_id: number | null;
  bindings: Record<string, string[]> | null;
  configured_fields: Record<string, boolean>;
  created_at: string;
  updated_at: string;
};

/** A server_transfers row (`GET /api/admin/servers/{server}/transfer`). */
export type ServerTransfer = {
  id: number;
  server_id: number;
  old_node: number;
  new_node: number;
  old_allocation: number;
  new_allocation: number;
  old_additional_allocations: number[];
  new_additional_allocations: number[];
  successful: boolean | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
