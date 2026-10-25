import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/aapg-native';
const profile=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json'));
const manifest=JSON.parse(fs.readFileSync(dir+'/installed-source-first/manifest.json'));
const files=JSON.parse(fs.readFileSync(dir+'/preboot-files.json'));
const deps=JSON.parse(fs.readFileSync(dir+'/preboot-ldd-result.json'));
const events=JSON.parse(fs.readFileSync(dir+'/first-installer-die-events.json'));
const helpers=[];
for(const [name,value]of Object.entries(manifest)){
 const pattern=new RegExp('cat > \\.voltra/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1\\n");
 const match=profile.egg.scripts.installation.script.replace(/\r\n/g,'\n').match(pattern);
 if(!match||crypto.createHash('sha256').update(match[2]+'\n').digest('hex')!==value.sha256)throw Error('Installed helper differs from canonical '+name);
 helpers.push({name,sha256:value.sha256});
}
if(events.events.length!==1||events.events[0].Actor.Attributes.exitCode!=='0')throw Error('Exact first installer DIE0 missing');
const gameLegal=files.legal_files.filter(x=>!x.path.startsWith('Steam/')&&!x.path.startsWith('.voltra/'));
const report={scope:'first clean install/preboot only; first Start held for root review',recipe:'americas_army/proving_grounds/egg-america-s-army--proving-grounds.json',
 native_started:false,installer_die_exit:events.events[0].Actor.Attributes.exitCode,installer_container_id:events.events[0].Actor.ID,
 actual_installed_helpers:helpers,binary:files.binary,native_dependencies:{...deps,log:dir+'/preboot-ldd.log'},release:files.release,files:files.files,volume_bytes:files.volume_bytes,
 legal_discovery:{scan:files.legal_scan,all_candidates:files.legal_files.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256})),game_candidates:gameLegal,interpretation:'Filename/ancestor discovery only. Absence of a named game agreement is not blanket legal absence. No acceptance or game startup performed.'},
 limits:{memory_mib:4096,disk_mib:16384,ports:3},source_controls:'Original4 canonical fields/defaults unchanged; per-instance test SERVER_NAME and selected QUERY/AUTH ports, AUTO_UPDATE0. No original public-listing-off control exists; no unreviewed flag added. Allocations bind loopback.',
 terms_encountered_for_acceptance:false,terms_accepted:false,game_content_acquired:true,gameplay_tested:false,
 limitations:['Anonymous install succeeded despite visibleonlywhensubscribed metadata; this does not prove publisher online backend/client authentication.','Native runtime is not authorized until independent preboot review.','Optional node-container cat log recovery returned127 because that image has no cat; actual installer DIE0/websocket and helper-byte archives are independent.']};
fs.writeFileSync(dir+'/preboot-report.json',JSON.stringify(report,null,2)+'\n');
console.log({installer_exit:report.installer_die_exit,helpers:helpers.length,elf64:files.binary.header.startsWith('7f454c460201'),dependency_exit:deps.status,missing_libraries:deps.contains_missing_library,legal_candidates:files.legal_files.length,game_legal_candidates:gameLegal.length,native_started:false});
