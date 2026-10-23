export type SteamGame = string;
export type GameProfile = {id: string; name: string; description: string; after_setup: string; ports: number; consecutive_ports: boolean; password: {enabled: boolean; required: boolean; min_length: number; max_length: number}};
export type Choice = {value: string; label: string};
export type GameHelp = {label: string; url?: string; text?: string};
export type SteamAdvancedField = {key: string; label: string; type: 'text' | 'integer' | 'number' | 'boolean'; default: string; secret?: boolean; min?: number; max?: number; description?: string};
export type SetupNode = {id: string | number; name: string; free_allocations?: number; setup_available?: boolean; unavailable_reason?: string; available_memory?: number};
export type SteamOptions = GameProfile & {
  id: SteamGame; name: string; can_install: boolean;
  nodes: SetupNode[];
  defaults: {memory: number; max_players: number};
  minimum_memory: number; maximum_memory: number;
  minimum_players: number; maximum_players: number;
  presets: Choice[]; help: GameHelp[];
  advanced_fields?: SteamAdvancedField[];
};

export function steamAdvancedEnvironment(fields: SteamAdvancedField[], draft: Record<string, string | boolean>): Record<string, string | boolean> {
  return Object.fromEntries(fields.map(field => {
    const value = draft[field.key] ?? (field.type === 'boolean' ? field.default === '1' : field.default);
    if (field.type === 'boolean') return [field.key, value === true];
    const text = String(value);
    if (/[\u0000-\u001f\u007f]/.test(text) || text.length > 4096) throw new Error(`Enter a single value for ${field.label}.`);
    if (field.secret && new TextEncoder().encode(text).length > 1024) throw new Error(`${field.label} must be at most 1024 UTF-8 bytes.`);
    if (field.type === 'integer' || field.type === 'number') {
      const number = text.trim() ? Number(text) : NaN;
      if (!Number.isFinite(number) || (field.type === 'integer' && !Number.isSafeInteger(number)) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) throw new Error(`Enter a valid value for ${field.label}.`);
    }
    return [field.key, text];
  }));
}
export type QuickValue = string | number | boolean | null;
export type QuickField = {key: string; label: string; type: 'text' | 'number' | 'boolean' | 'select'; value: QuickValue; options?: Choice[]; min?: number; max?: number; secret?: boolean};
export type QuickSetup = {game: string; fields: QuickField[]; folders: {label: string; path: string; description?: string}[]; help: GameHelp[]; requires_stop: boolean; revision: string};
export type SteamJob = {id: string; operation: string; status: string; stage: string; detail: string; created_at: string; restart?: boolean; started_at?: string | null; completed_at?: string | null; error?: string; logs?: {stage: string; detail: string; created_at: string}[]};
export type SteamStatus = {supported: boolean; game: string; app_id: number; branch: string; mode: 'on_start' | 'scheduled' | 'off'; check_interval_seconds: number; last_checked_at?: string | null; last_attempt_at?: string | null; last_failed_at?: string | null; installed_build: string; latest_build: string; update_available: boolean; needs_repair: boolean; current_job?: SteamJob | null; jobs: SteamJob[]; node_available: boolean};

export function managedSteamServer(server: {steam_managed?: boolean; game?: unknown; egg_features?: unknown}): boolean {
  if (typeof server.steam_managed === 'boolean') return server.steam_managed;
  // Compatibility with earlier panel responses. New profiles use the explicit
  // backend flag and never require another game-name list in React.
  return typeof server.game === 'string' && !!server.game && Array.isArray(server.egg_features) && server.egg_features.includes('steam');
}
export function memoryMiB(gib: string): number | null {
  if (!gib.trim()) return null;
  const value = Number(gib) * 1024;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function gameMemoryBudget(maximum: number, node?: SetupNode): number {
  const available = node?.available_memory;
  return typeof available === 'number' && Number.isFinite(available) ? Math.max(0, Math.min(maximum, Math.floor(available))) : maximum;
}
export function gameInitialNode(nodes: SetupNode[]): SetupNode | undefined {
  return nodes.find(node => node.setup_available !== false && (node.free_allocations === undefined || node.free_allocations > 0)) ?? nodes[0];
}
export function steamMemoryWarning(options: SteamOptions, memory: number | null): string | null {
  if (memory === null || memory < options.minimum_memory || memory > options.maximum_memory || memory >= options.defaults.memory) return null;
  return `${options.name} defaults to ${options.defaults.memory / 1024} GiB of memory. Using less memory increases the risk of crashes, especially with more players or larger saves.`;
}
export function safeFolderLink(server: string, path: string): string | null {
  if (!path || path.includes('\\') || /[\u0000-\u001f]/.test(path) || path.split('/').some(part => part === '..')) return null;
  return `/server/${encodeURIComponent(server)}/files?${new URLSearchParams({directory: '/' + path.split('/').filter(part => part && part !== '.').join('/')})}`;
}
export function activeSteamJob(job?: SteamJob | null): boolean {
  return !!job && !job.completed_at && !['completed', 'succeeded', 'success', 'failed', 'cancelled', 'canceled', 'interrupted'].includes(job.status);
}
export function steamJobLabel(job: SteamJob): string {
  if (job.operation === 'start') return job.restart || /restart/.test(job.stage) ? 'Preparing restart' : 'Preparing server';
  return ({install: 'Installing game', check: 'Checking Steam', verify: 'Verifying and repairing', update: 'Updating game'} as Record<string, string>)[job.operation] || 'Steam maintenance';
}
export function stoppedServer(state: string, updated: number, error: string, lifecycle?: unknown): boolean {
  return !lifecycle && !!updated && !error && ['offline', 'stopped'].includes(state);
}
export function checkDue(status: SteamStatus): string {
  if (status.mode === 'off') return 'Automatic checks are off.';
  const job = activeSteamJob(status.current_job) ? status.current_job : status.jobs.find(activeSteamJob);
  if (job) return `Steam maintenance is ${job.status === 'queued' ? 'queued' : 'in progress'}. Automatic checks wait for the current job to finish.`;
  const checked = Date.parse(status.last_checked_at || '');
  const failed = Date.parse(status.last_failed_at || '');
  // Match steamCheckDue: both the success interval and failure backoff apply.
  const interval = Number.isFinite(status.check_interval_seconds) && status.check_interval_seconds >= 300 ? status.check_interval_seconds : 3600;
  const next = Number.isFinite(checked) ? checked + interval * 1000 : 0;
  if (Number.isFinite(failed) && (!Number.isFinite(checked) || failed > checked)) {
    const retry = Math.max(failed + 300000, next);
    return `Failed checks retry after ${new Date(retry).toLocaleString()}.`;
  }
  if (!Number.isFinite(checked)) return 'No successful check yet.';
  return Number.isFinite(next) ? `Next automatic check eligible ${new Date(next).toLocaleString()}.` : 'Automatic checks respect the configured cooldown.';
}
export function quickSettings(fields: QuickField[], draft: Record<string, QuickValue>): Record<string, string | number | boolean> {
  // Save only changed values. Missing/unparseable native properties remain absent
  // until the user explicitly chooses a value, preserving game defaults.
  return Object.fromEntries(fields.filter(field => Object.hasOwn(draft, field.key) && String(draft[field.key]) !== String(field.value)).map(field => {
    const value = draft[field.key];
    if (field.type === 'number') {
      const number = typeof value === 'string' && !value.trim() ? NaN : Number(value);
      if (!Number.isFinite(number) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) throw new Error(`Enter a valid value for ${field.label}.`);
      return [field.key, number];
    }
    if (field.type === 'select' && !field.options?.some(option => option.value === String(value))) throw new Error(`Choose an available value for ${field.label}.`);
    return [field.key, field.type === 'boolean' ? value === true : String(value ?? '')];
  }));
}
