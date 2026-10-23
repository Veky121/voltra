// Usage: node tools/game-library/update-catalog.mjs <reviewed 40-character commit>
// Downloads definitions only. Never imports eggs, installs games, or executes
// fetched scripts. Run the catalog tests and inspect the diff before shipping.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isMinecraftModpackRecipe} from './catalog-policy.mjs';

const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || '')) throw Error('Pass an explicit reviewed upstream commit SHA.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(`Download failed: ${response.status} ${url}`);
  const body = await response.text();
  if (body.length > 4 * 1024 * 1024) throw Error('Upstream response exceeds catalog limits.');
  return body;
}
const repository = 'https://github.com/pterodactyl/game-eggs';
const tree = JSON.parse(await download(`https://api.github.com/repos/pterodactyl/game-eggs/git/trees/${revision}?recursive=1`));
if (tree.truncated || tree.sha !== revision || !Array.isArray(tree.tree)) throw Error('Upstream tree is incomplete or does not match the requested commit.');
const files = tree.tree.filter(entry => entry.type === 'blob' && /(?:^|\/)eggs?-[^/]+\.json$/.test(entry.path) && !isMinecraftModpackRecipe(entry.path));
const entries = [];
let next = 0;
await Promise.all(Array.from({length: 6}, async () => {
  while (next < files.length) {
    const filename = files[next++].path;
    const raw = await download(`https://raw.githubusercontent.com/pterodactyl/game-eggs/${revision}/${filename.split('/').map(encodeURIComponent).join('/')}`);
    const egg = JSON.parse(raw);
    if (!egg.name || !['PTDL_v1', 'PTDL_v2'].includes(egg.meta?.version)) throw Error(`Invalid egg: ${filename}`);
    entries.push({path: filename, sha256: crypto.createHash('sha256').update(raw).digest('hex'), egg});
  }
}));
if (!entries.length) throw Error('No game recipes were found.');
entries.sort((a, b) => a.path.localeCompare(b.path));
const license = await download(`https://raw.githubusercontent.com/pterodactyl/game-eggs/${revision}/LICENSE`);
if (!license.startsWith('MIT License')) throw Error('Upstream license changed; review before updating.');
const target = path.join(root, 'internal/panel/game_library/upstream');
await fs.mkdir(target, {recursive: true});
await fs.writeFile(path.join(target, 'catalog.json.next'), JSON.stringify({repository, revision, entries}));
await fs.writeFile(path.join(target, 'LICENSE'), license);
await fs.rename(path.join(target, 'catalog.json.next'), path.join(target, 'catalog.json'));
console.log(`Pinned ${entries.length} recipes at ${revision}. Run TestGameTemplateCatalogCompatibility and TestGameTemplateEveryRecipeImports, then update the rollout checklist and third-party notice.`);

