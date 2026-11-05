/** GET-only served Puck capability check. Importing performs no operations.
 * Root must verify candidate14 is served and supply frozen canonical identities.
 * This creates no fixture, starts no installer/game, and changes no power state.
 */
import { createHash } from 'node:crypto';

const digest = x => createHash('sha256').update(x).digest('hex');
const attrs = x => x?.attributes ?? x;
const uuid = x => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x ?? '');
const sha = x => /^[a-f0-9]{64}$/.test(x ?? '');
function require(ok, message) { if (!ok) throw Error(message); }

// expectedEggUUID must be derived from the exact frozen catalog override, not
// copied from an imported/ad-hoc egg. expectedExternalID comes from canonical
// creation's persisted intent. Caller retains that intent and served build proof.
export async function checkPuckConsole(plan, { signal } = {}) {
  require(plan?.recipe === 'puck/egg-puck.json', 'Exact Puck recipe required');
  require(uuid(plan.serverUUID) && uuid(plan.expectedEggUUID), 'Exact fixture and canonical egg UUID required');
  require(['serverID', 'eggID', 'nestID', 'ownerID'].every(k => Number.isSafeInteger(plan[k]) && plan[k] > 0), 'Fixture numeric identity missing');
  require(plan.expectedServerName === 'validator-puck-canonical', 'Owned canonical fixture name required');
  require(typeof plan.expectedExternalID === 'string' && plan.expectedExternalID.startsWith('catalog:' + plan.ownerID + ':'), 'Canonical creation external identity required');
  require(typeof plan.expectedStartup === 'string' && plan.expectedStartup.includes('puck') && !/[\r\n\0]/.test(plan.expectedStartup), 'Frozen Puck startup required');
  require(sha(plan.expectedInstallerSHA256) && sha(plan.expectedBuildSHA256), 'Frozen installer/build hashes required');
  async function get(path) {
    const response = await fetch('http://127.0.0.1:18099' + path, {
      method: 'GET', redirect: 'error', signal: signal ?? AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    require(response.ok, 'Puck read-only API returned HTTP ' + response.status);
    return response.json();
  }
  const server = attrs(await get('/api/application/servers/' + plan.serverID));
  require(server.uuid === plan.serverUUID && server.name === plan.expectedServerName &&
    server.egg === plan.eggID && server.nest === plan.nestID && server.user === plan.ownerID &&
    server.external_id === plan.expectedExternalID, 'Owned canonical server identity differs');
  require(server.container?.startup_command === plan.expectedStartup, 'Server startup differs from frozen canonical source');
  const egg = attrs(await get('/api/application/nests/' + plan.nestID + '/eggs/' + plan.eggID));
  require(egg.uuid === plan.expectedEggUUID && egg.startup === plan.expectedStartup, 'Canonical egg UUID/startup mismatch');
  require(typeof egg.script?.install === 'string' && digest(egg.script.install) === plan.expectedInstallerSHA256, 'Canonical installer mismatch');
  const client = attrs(await get('/api/client/servers/' + plan.serverUUID));
  require(client.uuid === plan.serverUUID && client.internal_id === plan.serverID && client.name === plan.expectedServerName, 'Client fixture mismatch');
  require(client.console_input_supported === false, 'Stock Puck still advertises terminal command input');
  const resources = attrs(await get('/api/client/servers/' + plan.serverUUID + '/resources'));
  require(resources.current_state === 'offline', 'Keep capability fixture offline');
  return {
    recipe: plan.recipe, fixture: plan.serverUUID, canonicalEggUUID: egg.uuid,
    installerSHA256: plan.expectedInstallerSHA256,
    rootAssertedBuildSHA256: plan.expectedBuildSHA256,
    console_input_supported: false, offline: true,
    scope: 'Actual GET capability on exact canonical fixture. Caller must separately bind served backend identity. No terminal command, install, native lifecycle or signal execution performed.',
    powerAndSignal: 'Unchanged by this check; prior native stop evidence remains reused, not rerun',
  };
}
