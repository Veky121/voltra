/** File-only manifest preparation. Does not import or contact the campaign. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const build = 'c86a1b2a87fb7ec733c10caa2ff8e56ce3464b8eefd49fe5c0dfd73d49c2f0a4';
const outputRoot = resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go/.local/validator-campaign');
export async function pinManifest(templatePath, outputPath) {
  const config = JSON.parse(await readFile(resolve(templatePath), 'utf8'));
  const destination = resolve(outputPath), within = relative(outputRoot, destination);
  if (!within || within.startsWith('..') || isAbsolute(within) || destination === resolve(templatePath) || config.build !== build || config.games?.length !== 2) throw Error('Exact Waterdog native template/new output path required');
  for (const game of config.games) {
    const raw = await readFile(game.canonicalPass.path), report = JSON.parse(raw);
    if (report.status !== 'PASS' || report.game !== game.id || report.build !== build || report.fixture?.name !== 'validator-' + game.id || report.fixture.install?.rawExit !== '0' || report.fixture.install.callback?.success !== true || report.checks?.some(c => c.status !== 'PASS')) throw Error('Archive both exact canonical PASS reports before preparing native manifest');
    game.canonicalPass.sha256 = createHash('sha256').update(raw).digest('hex');
    game.inputs = [...new Set([...game.inputs, game.canonicalPass.path])];
  }
  config.status = 'Root-reviewed canonical PASS inputs pinned; fresh native acceptance pending';
  await writeFile(destination, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  return { path: destination, canonicalPins: config.games.map(g => ({ id: g.id, ...g.canonicalPass })) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [template, output, ...extra] = process.argv.slice(2);
  if (!template || !output || extra.length) throw Error('Usage: node waterdog-pin-native-manifest.mjs TEMPLATE NEW_OUTPUT');
  console.log(JSON.stringify(await pinManifest(template, output)));
}
