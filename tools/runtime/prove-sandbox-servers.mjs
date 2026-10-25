import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),dir='.local/sandbox-servers';fs.mkdirSync(dir,{recursive:true});
function command(exe,args){
 const result=spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:60000});
 if(result.error||result.status!==0)throw Error((result.stdout||'')+(result.stderr||'')+(result.error||''));
 return (result.stdout||'')+(result.stderr||'');
}
command(process.execPath,['--max-old-space-size=192','tools/runtime/stage-sandbox-servers.mjs']);
const parity=command(process.execPath,['--max-old-space-size=192','tools/runtime/test-sandbox-servers.mjs']);
const scripts=path.join(root,'internal/panel/game_library/scripts').replaceAll('\\','/');
const fixture=path.join(root,'tools/runtime/test-sandbox-servers.py').replaceAll('\\','/');
const tests=command('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--read-only','--tmpfs','/tmp:rw,size=64m','-e','PYTHONDONTWRITEBYTECODE=1','-v',scripts+':/scripts:ro','-v',fixture+':/test.py:ro','python:3.13-slim','python','/test.py']);
fs.writeFileSync(dir+'/source-proof.log',parity+tests);
const profiles=JSON.parse(fs.readFileSync(dir+'/profiles.json')),catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const owned=['internal/panel/game_library/scripts/sandbox-servers.py','internal/panel/game_library/scripts/sandbox-servers-release.py','internal/panel/game_library/scripts/sandbox-servers-defaults.json','internal/panel/game_library/scripts/sandbox-servers-modiverse-seed.json','tools/runtime/stage-sandbox-servers.mjs','tools/runtime/test-sandbox-servers.mjs','tools/runtime/test-sandbox-servers.py','tools/runtime/research-sandbox-servers.mjs','tools/runtime/prove-sandbox-servers.mjs','tools/runtime/sandbox-servers.md'];
const receipt={schema_version:1,checked_at:new Date().toISOString(),scope:'source_only',frozen:true,verification:'not_verified',native_acceptance:false,profiles:Object.keys(profiles),
 tests:{python_fixtures:30,result:'pass',source_parity:parity.trim(),actual_process_fixture:'Only tiny Python utility child. Supervisor SIGTERM forwards SIGINT; handler exits7 and exact raw status is preserved. No game or Wine proof.',limits:{memory_mib:256,cpus:1,network:'none',read_only:true,tmpfs_mib:64,pull:'never'},log:dir+'/source-proof.log'},
 source:{repository:catalog.repository,revision:catalog.revision,license:'internal/panel/game_library/upstream/LICENSE',original_sha256:Object.fromEntries(Object.entries(profiles).map(([p,v])=>[p,v.upstream_sha256])),embedded_sha256:JSON.parse(fs.readFileSync(dir+'/source-hashes.json')),owned_files_sha256:Object.fromEntries(owned.map(file=>[file,sha(file)])),stage_sha256:sha(dir+'/profiles.json')},
 provenance:JSON.parse(fs.readFileSync(dir+'/research.json')),original_controls:13,original_metadata_changes:[],
 behavior_deltas:[
  'Generic adds explicit checksum-bound HTTPS download or operator-uploaded archive/extracted-files mode. Original DOWNLOAD_URL/INSTALL_DIR/SERVER_EXECUTABLE metadata remains exact. ZIP/gzip-tar/XZ-tar and root-relative executable semantics are retained.',
  'Literal JSON-array arguments replace any need for shell fragments. Private console redactions and preserved paths are shared form metadata. Original stable/staging/devel Wine choices remain separately pinned.',
  'The placeholder Generic marker change me is replaced by optional operator READINESS_MARKER observing actual child stdout and a fixed emitted signal. Empty never claims readiness; there is no timer/spawn readiness.',
  'All three originals use ^C. Stop now requests explicit shared native supervisor SIGINT, not an ETX-only assumption. Actual Wine/game save/exit behavior remains unverified.',
  'Nova managed startup values update typed JSON while preserving all native admin/whitelist/map/shop/save/unknown fields. Existing/explicit additional listeners require selected distinct allocations; absent fields are not invented.',
  'Modiverse default configuration is a pinned MIT source snapshot, not an unpinned runtime HTTP fetch. Existing config/UGC/mods remain unchanged. Locked original query27015 is not remapped. Unused publisher launcher is retained.',
  'State restoration replaces destructive publisher configuration overwrites, retaining profile databases, saves, configuration, plugins/mods and ownership/modes even when Steam fails.'
 ],
 limits:[
  'No runtime/game binaries or container layers downloaded; registry metadata and small source/docs only. No Steam/Wine/game launched, no native lease, services/restarts, live API/DB mutations, canonical overrides, web/dist or shared-helper edits.',
  'Current publisher depot/layout/licensing availability, Windows prerequisites, private Steam transport, native console/clean Stop/save behavior, protocols/listing/joins, mod/Workshop/RCON functionality and gameplay remain unverified.',
  'Private Steam transport fails closed before copies/processes. Legal operator files with AUTO_UPDATE=0 avoid that transport; no credentials or license bypass is supplied.',
  'Generic default historical URL is unchanged but not downloaded/proved. A trusted archive SHA is required. Config/schema/listeners/licenses for an arbitrary executable remain operator-managed.',
  'Archive bounds: 8GiB compressed, 32GiB expanded,100000entries. Unsafe links/special files, traversal, case collisions, modified/unmanaged program collisions and adapter-control overwrites fail. Exact owned program leaves/receipt roll back; newly created empty directories may remain after failure.',
  'Generic console redaction covers supplied UTF-8 secret values. Arbitrary application output encodings/undisclosed credentials and nonstandard shutdown protocols need native acceptance; no universal compatibility claim.',
  'Nova extra listener fields/current listing semantics remain native/publisher unverified. Original native configuration seeds and readiness messages are retained as source behavior, not current runtime observations.',
  'Source fixtures are not game acceptance. Memory/disk defaults are unmeasured estimates. Publisher assets and Windows prerequisites retain separate license obligations.'
 ]};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/sandbox-servers-source-acceptance.json',JSON.stringify(receipt,null,2)+'\n');
console.log('FROZEN: exact3 sandbox source profiles;30 offline fixtures +13 original-control parity PASS. '+receipt.source.stage_sha256);
