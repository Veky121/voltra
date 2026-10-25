import path from 'node:path';
import { artifact, loadJSON, jsonFile } from './common.mjs';

const inventory = await loadJSON(path.join(artifact, 'inventory.json'));
const mappings = [];
const target = (method, endpoint, screen, note = '') => ({ api: [{ method, path: endpoint }], react_screen: screen, note });
for (const route of inventory.routes.filter(r => r.path.startsWith('/admin'))) {
  const controller = route.controller.split('\\').pop().split('@')[0];
  const action = route.controller.split('@')[1] ?? '__invoke'; let equivalent;
  if (controller === 'BaseController') equivalent = target('GET', '/api/application/servers', '/admin', 'Overview also queries nodes, users and nests.');
  if (controller === 'ApiController') equivalent = target(action === 'store' ? 'POST' : action === 'delete' ? 'DELETE' : 'GET', `/api/admin/api-keys${action === 'delete' ? '/{identifier}' : ''}`, '/admin/api-keys', 'Creation is a React form on the API keys screen.');
  if (controller === 'DatabaseController') equivalent = target(({ create: 'POST', update: 'PATCH', delete: 'DELETE' })[action] ?? 'GET', `/api/admin/database-hosts${['view', 'update', 'delete'].includes(action) ? '/{host}' : ''}`, '/admin/database-hosts/{host}', 'Game database host CRUD; server databases use their separate server endpoints.');
  if (controller === 'LocationController') equivalent = target(({ create: 'POST', update: 'PATCH' })[action] ?? 'GET', `/api/application/locations${['view', 'update'].includes(action) ? '/{location}' : ''}`, '/admin/locations/{location}');
  if (controller === 'UserController') equivalent = target(({ store: 'POST', update: 'PATCH', delete: 'DELETE' })[action] ?? 'GET', `/api/application/users${['view', 'update', 'delete'].includes(action) ? '/{user}' : ''}`, '/admin/users/{user}', action === 'json' ? 'React uses the paginated/filterable account API instead of a separate autocomplete response.' : 'Create form is on the account list; password/email login flows are deferred.');
  if (controller === 'MountController') {
    const relations = { addNodes: ['POST', 'nodes'], addEggs: ['POST', 'eggs'], deleteNode: ['DELETE', 'nodes/{node_id}'], deleteEgg: ['DELETE', 'eggs/{egg_id}'] };
    equivalent = relations[action] ? target(relations[action][0], `/api/admin/mounts/{mount}/${relations[action][1]}`, '/admin/mounts/{mount}') : target(({ create: 'POST', update: 'PATCH' })[action] ?? 'GET', `/api/admin/mounts${['view', 'update'].includes(action) ? '/{mount}' : ''}`, '/admin/mounts/{mount}');
  }
  if (controller === 'NestController') equivalent = target(({ store: 'POST', update: 'PATCH', destroy: 'DELETE' })[action] ?? 'GET', `/api/admin/nests${['view', 'update', 'destroy'].includes(action) ? '/{nest}' : ''}`, '/admin/nests/{nest}');
  if (controller === 'EggController') equivalent = target(({ store: 'POST', update: 'PATCH', destroy: 'DELETE' })[action] ?? 'GET', action === 'store' ? '/api/admin/nests/{nest}/eggs' : `/api/admin/eggs${['view', 'update', 'destroy'].includes(action) ? '/{egg}' : ''}`, '/admin/eggs/{egg}');
  if (controller === 'EggShareController') equivalent = action === 'export' ? target('GET', '/api/admin/eggs/{egg}/export', '/admin/eggs/{egg}') : target('POST', action === 'import' ? '/api/admin/nests/{nest}/eggs/import' : '/api/admin/eggs/{egg}/import', '/admin/eggs/{egg}', 'PTDL JSON document or multipart file; updating preserves the egg identity.');
  if (controller === 'EggScriptController') equivalent = target(action === 'update' ? 'PATCH' : 'GET', `/api/admin/eggs/{egg}${action === 'update' ? '/scripts' : ''}`, '/admin/eggs/{egg}');
  if (controller === 'EggVariableController') equivalent = target(({ store: 'POST', update: 'PATCH', destroy: 'DELETE' })[action] ?? 'GET', `/api/admin/eggs/{egg}/variables${['update', 'destroy'].includes(action) ? '/{variable}' : ''}`, '/admin/eggs/{egg}');
  if (controller === 'NodeController') equivalent = target('GET', '/api/application/nodes', '/admin/nodes');
  if (controller === 'NodeViewController') {
    const suffix = { index: '', settings: '', configuration: '/configuration', allocations: '/allocations', servers: '/servers' }[action] ?? '';
    equivalent = target('GET', `${action === 'servers' ? '/api/admin' : '/api/application'}/nodes/{node}${suffix}`, '/admin/nodes/{node}');
  }
  if (controller === 'SystemInformationController') equivalent = target('GET', '/api/admin/nodes/{node}/system-information', '/admin/nodes/{node}');
  if (controller === 'NodeAutoDeployController') equivalent = target('POST', '/api/admin/nodes/{node}/deploy-token', '/admin/nodes/{node}');
  if (controller === 'NodesController') {
    const operations = {
      create: ['GET', '/api/application/locations'], store: ['POST', '/api/application/nodes'], updateSettings: ['PATCH', '/api/application/nodes/{node}'], delete: ['DELETE', '/api/application/nodes/{node}'],
      createAllocation: ['POST', '/api/application/nodes/{node}/allocations'], allocationSetAlias: ['PATCH', '/api/admin/nodes/{node}/allocations/{allocation}'], allocationRemoveBlock: ['DELETE', '/api/admin/nodes/{node}/allocations'], allocationRemoveSingle: ['DELETE', '/api/application/nodes/{node}/allocations/{allocation}'], allocationRemoveMultiple: ['DELETE', '/api/admin/nodes/{node}/allocations'],
    };
    if (operations[action]) equivalent = target(...operations[action], '/admin/nodes/{node}', 'Bulk deletion sends selected allocation IDs; creation accepts an IP/CIDR and port list/ranges.');
  }
  if (controller === 'CreateServerController') equivalent = target(action === 'store' ? 'POST' : 'GET', action === 'store' ? '/api/application/servers' : '/api/application/nodes', '/admin/servers', 'React creation queries users, nodes, nests/eggs and available allocations.');
  if (controller === 'ServerController') equivalent = target('GET', '/api/application/servers', '/admin/servers');
  if (controller === 'ServerViewController') equivalent = target('GET', '/api/application/servers/{server}', '/admin/servers/{server}', 'Details, build, startup, manage, database, mounts and delete are tabs/sections of the server page.');
  if (controller === 'ServerTransferController') equivalent = target('POST', '/api/admin/servers/{server}/transfer', '/admin/servers/{server}', 'Destination node, default/additional allocations and transfer state retain separate validation.');
  if (controller === 'ServersController') {
    const operations = {
      updateBuild: ['PATCH', '/api/application/servers/{server}/build'], saveStartup: ['PATCH', '/api/application/servers/{server}/startup'], setDetails: ['PATCH', '/api/application/servers/{server}/details'],
      newDatabase: ['POST', '/api/application/servers/{server}/databases'], resetDatabasePassword: ['POST', '/api/application/servers/{server}/databases/{database}/reset-password'], deleteDatabase: ['DELETE', '/api/application/servers/{server}/databases/{database}'],
      addMount: ['POST', '/api/admin/servers/{server}/mounts'], deleteMount: ['DELETE', '/api/admin/servers/{server}/mounts/{mount}'], toggleInstall: ['POST', '/api/admin/servers/{server}/install'],
      manageSuspension: ['POST', '/api/application/servers/{server}/suspend'], reinstallServer: ['POST', '/api/application/servers/{server}/reinstall'], delete: ['DELETE', '/api/application/servers/{server}'],
    };
    if (operations[action]) equivalent = target(...operations[action], '/admin/servers/{server}', action === 'manageSuspension' ? 'Unsuspend uses POST /api/application/servers/{server}/unsuspend.' : action === 'delete' ? 'Forced deletion adds /force to the server API path.' : 'React sends JSON; the old Blade form encoding and redirects are replaced.');
  }
  if (['IndexController', 'AdvancedController'].includes(controller)) equivalent = target(action === 'test' ? 'POST' : action === 'update' ? 'PATCH' : 'GET', '/api/admin/settings', '/admin/settings', 'General and advanced settings share a validated typed settings resource. Outbound email has been removed.');
  mappings.push({ original: { method: route.method, path: route.path, controller: route.controller }, ...equivalent, mapping_status: equivalent ? 'mapped_semantic_replacement' : 'unmapped', behavior_status: 'not_exercised_by_mapping', browser_status: 'not_exercised_by_mapping' });
}
await jsonFile(path.join(artifact, 'admin-equivalence.json'), { schema_version: 1, generated_at: new Date().toISOString(), policy: 'This file documents semantic replacements. A mapping does not prove behavior, route compatibility, working UI controls or browser verification.', counts: { original_admin_routes: mappings.length, mapped: mappings.filter(x => x.mapping_status === 'mapped_semantic_replacement').length, unmapped: mappings.filter(x => x.mapping_status === 'unmapped').length }, mappings });
console.log(JSON.stringify({ admin_routes: mappings.length, unmapped: mappings.filter(x => x.mapping_status === 'unmapped').map(x => x.original) }));
