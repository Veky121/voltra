#!/usr/bin/env node
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';
const directory=resolve('.local/cache-steamcmd-updated');
const preparation=JSON.parse(fs.readFileSync(join(directory,'preparation.json')));
if(preparation.phase!=='native_quit_complete'||preparation.forbidden_login_output||preparation.command.join(' ')!=='steamcmd.sh +quit'||!/^[a-f0-9-]{36}$/.test(preparation.request_id)||preparation.root!=='/var/lib/voltra-batch-20261023/cache/steamcmd-prep/'+preparation.request_id)throw Error('Fresh public preparation provenance is required');
if(fs.existsSync(join(directory,'updated.tar.gz'))||fs.existsSync(join(directory,'public-manifest.json')))throw Error('Existing bundle requires inspection; no automatic overwrite');
const helper=fileURLToPath(new URL('./cache-steamcmd-public.py',import.meta.url));
const built=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${preparation.root},target=/source,readonly`,'--mount',`type=bind,source=${directory},target=/output`,'--mount',`type=bind,source=${helper},target=/helper/cache-steamcmd-public.py,readonly`,'python:3.13-slim','python3','-B','/helper/cache-steamcmd-public.py','--source','/source/.voltra/steamcmd','--archive','/output/updated.tar.gz','--manifest','/output/public-manifest.json','--version',preparation.version],{encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});
if(built.status)throw Error('Public-only bundle build failed: '+built.stderr);
const manifest=JSON.parse(fs.readFileSync(join(directory,'public-manifest.json')));
const seeded=spawnSync(process.execPath,['tools/runtime/cache-artifact.mjs','--sha256',manifest.archive_sha256,'--source',join(directory,'updated.tar.gz'),'--max-bytes',String(128*1024**2)],{stdio:'inherit',windowsHide:true});
if(seeded.status)throw Error('Updated public archive could not be seeded');
const receipt={source:preparation.official.source,acquired_at:new Date().toISOString(),sha256:manifest.archive_sha256,bytes:manifest.archive_bytes,kind:manifest.kind,steamcmd_version:manifest.steamcmd_version,public_manifest:join(directory,'public-manifest.json'),fresh_preparation:preparation.request_id,official_bootstrap_sha256:preparation.official.sha256,refresh_after_days:7,scope:manifest.source_scope,steamcmd_self_updates_enabled:true};
fs.writeFileSync(join(directory,'acquisition.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log({version:receipt.steamcmd_version,public_files:Object.keys(manifest.files).length,excluded_files:manifest.excluded_files.length,sha256:receipt.sha256,bytes:receipt.bytes});
