#!/usr/bin/env node
// Acquire one public upstream bootstrap. This records identity, not a publisher signature.
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
const directory = resolve('.local/cache-steamcmd');
fs.mkdirSync(directory, { recursive: true });
const archive = join(directory, 'steamcmd_linux.tar.gz');
const receipt = join(directory, 'acquisition.json');
if (fs.existsSync(receipt)) {
  const previous = JSON.parse(fs.readFileSync(receipt));
  if (previous.source !== source || createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== previous.sha256) throw Error('Existing acquisition needs review');
} else {
  if (fs.existsSync(archive)) throw Error('Unreceipted bootstrap archive exists; review it before acquiring');
  const temporary = join(directory, '.incoming-' + randomUUID());
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
    if (!response.ok || !response.body) throw Error('SteamCMD bootstrap acquisition failed with HTTP ' + response.status);
    let bytes = 0;
    const hash = createHash('sha256');
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > 128 * 1024 ** 2) return callback(Error('Bootstrap archive exceeds 128 MiB'));
      hash.update(chunk); callback(null, chunk);
    } }), fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const record = { source, acquired_at: new Date().toISOString(), sha256: hash.digest('hex'), bytes,
      etag: response.headers.get('etag'), last_modified: response.headers.get('last-modified'),
      publisher_signature_verified: false, provenance: 'Existing reviewed profile HTTPS bootstrap source; byte identity captured on acquisition',
      bootstrap_cache_scope: 'Public uninitialized SteamCMD only; game downloads and launcher self-updates remain enabled' };
    fs.renameSync(temporary, archive);
    fs.writeFileSync(receipt, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } finally { fs.rmSync(temporary, { force: true }); }
}
const record = JSON.parse(fs.readFileSync(receipt));
const result = spawnSync(process.execPath, ['tools/runtime/cache-artifact.mjs', '--sha256', record.sha256, '--source', archive, '--max-bytes', String(128 * 1024 ** 2)], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Could not seed bootstrap cache');
console.log(JSON.stringify(record));
