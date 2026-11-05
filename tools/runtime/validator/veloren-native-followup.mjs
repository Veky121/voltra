import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verify as verifyFixture, park } from './campaign-adapter.mjs';
import { run as lifecycle } from './api-adapter.mjs';
import { campaign as h } from './campaign-session.mjs';
import { registration } from './veloren-checks.mjs';
export { park };

export async function verify(ctx) {
  const pin = ctx.game.canonicalEvidence;
  if (!pin?.path || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Canonical Veloren receipt pin required');
  const raw = await readFile(pin.path);
  if (createHash('sha256').update(raw).digest('hex') !== pin.sha256) throw Error('Canonical receipt changed');
  const prior = JSON.parse(raw);
  if (prior.status !== 'PASS' || prior.game !== 'veloren-canonical' || prior.fixture?.server?.uuid !== ctx.fixture?.server?.uuid
      || prior.fixture?.egg?.uuid !== ctx.game.canonicalEggUUID || !prior.checks.some(c => c.name === 'served-game-settings' && c.status === 'PASS')) throw Error('Exact canonical Veloren setup required');
  return verifyFixture(ctx);
}
export async function run(ctx) {
  await ctx.reserve(ctx.game.peakMiB);
  await ctx.check('reviewed-native-startup', async () => {
    const id = ctx.fixture.server.id, uuid = ctx.fixture.server.uuid;
    const resources = (await h.api('/api/client/servers/' + uuid + '/resources')).attributes;
    if (resources.current_state !== 'offline') throw Error('Startup edit requires parked fixture');
    const environment = registration.veloren.environment;
    await ctx.artifact('veloren-native-startup-intent.json', { fixture: uuid, environment, scope: 'Owned native test controls; canonical defaults preserved in prior receipt' });
    await h.api('/api/application/servers/' + id + '/startup', 'PATCH', { environment });
    const actual = (await h.api('/api/application/servers/' + id)).attributes;
    if (actual.uuid !== uuid || Object.entries(environment).some(([k, v]) => String(actual.container?.environment?.[k]) !== v)) throw Error('Native startup readback mismatch');
    return { confirmed: true, fixture: uuid };
  });
  return lifecycle(ctx);
}
