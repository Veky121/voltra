import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { artifact, reference, project, jsonFile, loadJSON } from './common.mjs';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}
function relative(file) { return path.relative(reference, file).replaceAll('\\', '/'); }
const upstream = await loadJSON(path.join(reference, 'tools/parity-upstream.json'));
const raw = await loadJSON(path.join(reference, 'artifacts/routes-original.json'));
const deferred = uri => uri.startsWith('auth/') || /^api\/client\/account\/(email|password|two-factor)(\/|$)/.test(uri);
const tooling = route => !route.action.startsWith('Pterodactyl\\') && route.uri !== 'storage/{path}';
const routeInventory = raw.map(route => ({
  id: `route:${route.method.split('|')[0]} /${route.uri.replace(/^\/+/, '')}`,
  kind: 'route', method: route.method.split('|')[0], path: `/${route.uri.replace(/^\/+/, '')}`,
  source: 'artifacts/routes-original.json', controller: route.action, name: route.name,
  category: route.uri.startsWith('api/') ? route.uri.split('/')[1] : route.uri.startsWith('admin') ? 'admin' : 'web',
  required: !deferred(route.uri) && !tooling(route),
  status: deferred(route.uri) ? 'deferred_auth' : tooling(route) ? 'reference_tooling' : 'not_exercised',
  reason: deferred(route.uri) ? 'User explicitly deferred login/password/email identity/TOTP to Cloudflare Access.' : tooling(route) ? 'Upstream framework/development tooling, retained in inventory but not a Pterodactyl product feature.' : null,
  evidence: [],
}));

const controllers = [];
for (const file of (await walk(path.join(reference, 'app/Http/Controllers'))).filter(x => x.endsWith('.php'))) {
  const source = await readFile(file, 'utf8');
  controllers.push({ path: relative(file), methods: [...source.matchAll(/public\s+function\s+(\w+)\s*\(/g)].map(m => m[1]), status: 'not_exercised' });
}
const controls = [];
for (const file of (await walk(path.join(reference, 'resources'))).filter(x => /\.(tsx|blade\.php)$/.test(x))) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/<(button|Button(?:\.\w+)?|SubmitButton|form|input|select|textarea|Can)(?=[\s>])/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    const authControl = relative(file).startsWith('resources/scripts/components/auth/') || /dashboard\/forms\/(ConfigureTwoFactorForm|UpdateEmailAddressForm|UpdatePasswordForm)\.tsx$/.test(relative(file));
    controls.push({ id: `control:${relative(file)}:${line}:${match[1]}`, source: relative(file), line, control: match[1], required: !authControl, status: authControl ? 'deferred_auth' : 'not_exercised' });
  }
}
const clientRouter = await readFile(path.join(reference, 'resources/scripts/routers/routes.ts'), 'utf8');
const uiRoutes = [...clientRouter.matchAll(/path:\s*'([^']+)'[\s\S]*?component:\s*(\w+)/g)].map(m => ({ path: m[1], component: m[2], source: 'resources/scripts/routers/routes.ts', status: 'not_exercised' }));
const commands = [];
for (const file of (await walk(path.join(reference, 'app/Console/Commands'))).filter(x => x.endsWith('.php'))) {
  const source = await readFile(file, 'utf8');
  const signature = source.match(/(?:protected\s+\$signature|protected\s+string\s+\$signature)\s*=\s*'([\s\S]*?)';/);
  const authCommand = /DisableTwoFactor/.test(file);
  commands.push({ id: `cli:${relative(file)}`, source: relative(file), command: signature?.[1].trim().replace(/\s+/g, ' ') ?? null, status: authCommand ? 'deferred_auth' : 'not_exercised', required: !authCommand });
}
const permissions = [...(await readFile(path.join(reference, 'app/Models/Permission.php'), 'utf8')).matchAll(/public const ACTION_\w+\s*=\s*'([^']+)'/g)].map(m => ({ permission: m[1], status: 'not_exercised' }));
const eggs = [];
const eggFiles = (await Promise.all(['game-eggs', 'application-eggs', 'generic-eggs'].map(root => walk(path.join(reference, 'upstream', root))))).flat();
for (const file of eggFiles.filter(x => x.endsWith('.json'))) {
  const value = await loadJSON(file).catch(() => null);
  if (value?.meta?.version?.startsWith('PTDL_')) eggs.push({ path: relative(file), version: value.meta.version, name: value.name, variables: value.variables?.length ?? 0, status: 'not_exercised' });
}
const domains = [
  ['accounts', ['users CRUD, disable and ownership protection', 'client and application API keys, IP and resource scopes', 'SSH public keys and unique fingerprints', 'permission matrix and cross-server access denial', 'pagination, filtering, sorting and includes']],
  ['infrastructure', ['locations CRUD', 'nodes CRUD, deployment selection and system information', 'node configuration and auto-deploy tokens', 'allocation IPv4/IPv6/ranges/aliases/bulk delete', 'mounts and node/egg/server associations', 'general, mail and advanced settings']],
  ['eggs', ['nests CRUD and relations', 'eggs CRUD and PTDL v1/v2 import/export/update', 'startup/config/log/stop parsing and inherited configuration', 'installation scripts, inheritance and privileged flags', 'variable rules, visibility and editability', 'complete supplied game egg corpus import/export']],
  ['lifecycle', ['server create, Docker install, install failure and reinstall', 'server details/build/startup/environment and ownership changes', 'suspension and unsuspension', 'normal and forced server deletion', 'transfers between two real Wings daemons and failure recovery', 'remote machine authentication and signed daemon configuration', 'remote SFTP public-key authentication and permissions']],
  ['operations', ['console input/output and websocket resource events', 'start/stop/restart/kill and crash restart', 'real CPU/memory/network/disk resource values', 'files list/read/write/mkdir/copy/rename/delete/chmod', 'files archive/unarchive/pull/upload/download and path boundaries', 'local and S3 backups create/complete/lock/download/restore/delete', 'network allocation assign/notes/primary/unassign and limits', 'startup variables validation/image selection and reinstall']],
  ['collaboration', ['subusers CRUD and anti-escalation/self-edit restrictions', 'schedules CRUD and cron validation', 'ordered delayed schedule tasks and continue-on-failure', 'automatic cron execution and only-when-online', 'real MySQL/MariaDB database/user/grants create/password rotation/delete', 'activity records, filters and actor/server visibility']],
  ['ui', ['all client navigation and working controls', 'all admin navigation and working controls', 'file editor/upload/archive controls', 'console websocket reconnect and power state', 'egg import/export/scripts/variables controls', 'responsive accessible validation, loading and error states', 'locale translations and language selection']],
  ['operations_admin', ['scheduled backup pruning and orphan cleanup', 'bulk server power operations', 'CLI provisioning/configuration and maintenance', 'upgrade and database migration/data preservation', 'persistent server/files/settings/account data after app and daemon restart']],
];
const features = domains.flatMap(([owner, descriptions]) => descriptions.map((description, index) => ({ id: `feature:${owner}:${index + 1}`, owner, description, required: true, status: 'not_exercised', evidence: [] })));
const report = {
  schema_version: 1, generated_at: new Date().toISOString(),
  reference: { repository: upstream.repository, tag: upstream.tag, commit: upstream.commit, root: '../pterodactyl-vite' },
  policy: { full_parity_verified: false, passed_status_requires_behavior_assertions: true, route_presence_does_not_prove_parity: true, UI_controls_require_browser_evidence: true, deferred: 'User-managed browser login, password/email identity changes and TOTP; Cloudflare last. Accounts, machine credentials, SSH/API keys and permissions remain required.' },
  counts: { routes: routeInventory.length, required_routes: routeInventory.filter(r => r.required).length, controllers: controllers.length, controls: controls.length, client_ui_routes: uiRoutes.length, cli_commands: commands.length, permissions: permissions.length, game_eggs: eggs.length, feature_groups: features.length },
  routes: routeInventory, controllers, controls, client_ui_routes: uiRoutes, cli_commands: commands, permissions, game_eggs: eggs, features,
};
await jsonFile(path.join(artifact, 'inventory.json'), report);
console.log(JSON.stringify(report.counts));
