import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { client } from './api-adapter.mjs';
import { serverbrowserReadback } from './gtac-checks.mjs';
import { verify as verifyFixture } from './campaign-adapter.mjs';
export { park } from './campaign-adapter.mjs';

export async function verify(ctx) {
  ctx.game.checksModule = 'tools/runtime/validator/gtac-checks.mjs';
  return verifyFixture(ctx);
}

export async function run(ctx) {
  const pin = ctx.game.nativeEvidence;
  if (!pin?.path || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Reviewed prior retention pin required');
  const bytes = await readFile(pin.path);
  if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw Error('Prior retention changed');
  const prior = JSON.parse(bytes);
  if (prior.game !== 'gtac' || prior.status !== 'PASS' || prior.fixture?.server?.uuid !== ctx.fixture?.server?.uuid
      || !prior.checks.some(c => c.name === 'reinstall-native-reload' && c.status === 'PASS')) throw Error('Exact retained GTAC fixture required');
  await ctx.reserve(ctx.game.peakMiB);
  await ctx.check('native-serverbrowser-readback', () => serverbrowserReadback(ctx, client(ctx), prior.fixture.retentionBaseline));
}
