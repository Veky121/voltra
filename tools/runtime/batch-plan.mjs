import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function buildPlan(catalog, checklist, managedReviews = []) {
  const checked = new Map(checklist.games.map(g => [g.path, g]));
  const reviewedManaged = new Map(managedReviews.map(review => [review.path, review.evidence]));
  const workers = {
    'source-engine': /^(counter_strike|half_life_2_deathmatch|left4dead|left4dead_2|team_fortress_2|team_fortress_2_classic)\//,
    'small-native': /^(cubeengine|cs2d|doom|quake_live|soldat|soldat2|warsow|warfork|urbanterror|wolfenstein_enemy_territory)\//,
    'release-services': /^(among_us|beamng|openrct2|openttd|v_rising|vrising)\//,
    'steam-survival': /^(core_keeper|barotrauma|necesse|enshrouded|v_rising|vrising)\//,
  };
  const games = catalog.entries.map(entry => {
    const g = checked.get(entry.path) || {};
    const egg = entry.egg;
    const steam = /steamcmd|app_update/.test(egg.scripts?.installation?.script || '') || Object.values(egg.docker_images || {}).some(v => /steamcmd/.test(v));
    const app = (egg.variables || []).find(v => /^(SRCDS_APPID|STEAM_APP_ID|STEAMAPPID|APP_ID)$/.test(v.env_variable));
    // An implemented adapter still needs its first native acceptance. Merely
    // having a profile must not prevent its reserved owner from acquiring a lease.
    const managedReview = reviewedManaged.get(entry.path);
    const reserved = Boolean(managedReview) || entry.path.startsWith('dont_starve/') ||
      ['runtime_verified', 'runtime_partial', 'runtime_failed'].includes(g.runtime_status);
    return {
      id: g.id, path: entry.path, name: egg.name, catalog_sha256: entry.sha256,
      state: reserved ? 'reserved_reviewed' : 'queued', runtime_status: g.runtime_status || 'not_started',
      ...(managedReview ? {managed_native_review: managedReview} : {}),
      family: steam ? 'steam' : Object.values(egg.docker_images || {}).some(v => /java/.test(v)) ? 'java' : 'release',
      suggested_worker: reserved ? null : Object.entries(workers).find(([, re]) => re.test(entry.path))?.[0] || 'backlog',
      cache_keys: [...Object.values(egg.docker_images || {}).map(v => `image:${v}`), ...(steam ? ['steamcmd-bootstrap', ...(app?.default_value ? [`steam-app:${app.default_value}`] : [])] : [])],
      prerequisites_review_required: true,
    };
  });
  return { schema_version: 1, revision: catalog.revision, total: games.length, games,
    cache_policy: 'Reuse Docker layers and checksum-addressed immutable public downloads. Steam content must be keyed by app, branch, build, platform and depot selection. Copy or reflink into separate writable volumes. Never cache credentials, cluster keys, generated configuration or saves. Mutable image tags require digest resolution before acceptance.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const managedReviews=[];
  const candidates=[
    ['7_days_to_die/egg-7-days-to-die.json','artifacts/managed-steam-seven-days-root-review.json',r=>r.checked?.native_restart_generation && r.checked?.namespace_removed && r.checked?.protected_file_rows>0],
    ['satisfactory/egg-satisfactory.json','artifacts/managed-steam-satisfactory-root-review.json',r=>r.real_steam_helpers_exact && r.namespace_removed && r.native_client_reinstall_status===202 && r.native_application_reinstall_status===204],
    ['palworld/egg-palworld.json','artifacts/managed-steam-palworld-root-review.json',r=>r.managed_id==='palworld-native' && r.game_container_absent && r.protected_rows_per_reinstall>0 && r.reinstall_routes?.includes(202) && r.reinstall_routes?.includes(204)],
    ['palworld/egg-palworld-proton.json','artifacts/managed-steam-palworld-proton-root-review.json',r=>r.managed_id==='palworld-proton' && r.verified_windows_before_login_helpers===3 && r.protected_files_each_failure_and_two_reinstalls===96 && r.independently_absent_game_containers && r.cleanup_receipt_verified && r.lease_released],
  ];
  for(const [recipe,evidence,valid]of candidates){
    if(!fs.existsSync(path.join(root,evidence)))continue;
    if(!valid(read(evidence)))throw Error('Managed native review is incomplete: '+evidence);
    managedReviews.push({path:recipe,evidence});
  }
  const plan = buildPlan(read('internal/panel/game_library/upstream/catalog.json'), read('artifacts/game-setup-checklist.json'),managedReviews);
  fs.writeFileSync(path.join(root, 'artifacts/game-batch-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({total: plan.total, queued: plan.games.filter(g => g.state === 'queued').length}));
}
