// Offline coverage and integrity audit for the library's original image downloads.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const readJSON=relative=>JSON.parse(readFileSync(path.join(root,relative),'utf8'));
const catalog=readJSON('internal/panel/game_library/upstream/catalog.json');
const manifest=readJSON('web/src/client/gameArtwork.json');
const ledger=readJSON('web/public/game-artwork/sources.json');
const digest=data=>createHash('sha256').update(data).digest('hex');
const publicRoot=path.join(root,'web/public');
assert.deepEqual(ledger.artworks,manifest.assets,'Source ledger differs from the card manifest');
for(const entry of catalog.entries){
  const id=digest(entry.path).slice(0,16);
  assert(manifest.assets[manifest.templates[id]],`Missing template artwork: ${entry.path}`);
}
for(const group of ['templates','categories','steam']){
  for(const [id,asset] of Object.entries(manifest[group])){
    assert(manifest.assets[asset],`Unknown artwork ${asset} for ${group}/${id}`);
  }
}
assert(manifest.assets[manifest.categories.minecraft],'Missing guided Minecraft artwork');
for(const game of ['satisfactory','palworld','valheim','7days']){
  assert(manifest.assets[manifest.steam[game]],`Missing guided artwork: ${game}`);
}
for(const [id,asset] of Object.entries(manifest.assets)){
  assert(/^\/(artwork|game-artwork)\/[a-z0-9._-]+$/i.test(asset.src),`Invalid local path: ${id}`);
  assert(asset.title&&asset.credit&&asset.downloadedAt,`Missing source metadata: ${id}`);
  for(const key of ['sourcePage','imageUrl'])assert(['https:','http:'].includes(new URL(asset[key]).protocol),`Invalid source: ${id}/${key}`);
  const file=path.join(publicRoot,asset.src.slice(1));
  const data=readFileSync(file);
  assert.equal(data.length,asset.bytes,`Image size changed: ${id}`);
  assert.equal(digest(data),asset.sha256,`Image content changed: ${id}`);
}
console.log(JSON.stringify({templates:catalog.entries.length,guidedGames:5,artworks:Object.keys(manifest.assets).length,result:'All images mapped, sources recorded, file sizes and SHA-256 hashes match.'},null,2));
