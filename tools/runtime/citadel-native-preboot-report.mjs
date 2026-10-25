import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/citadel-native';
const profile=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json'));
const manifest=JSON.parse(fs.readFileSync(dir+'/installed-source-first/manifest.json'));
const actual=JSON.parse(fs.readFileSync(dir+'/preboot-files.json'));
const ldd=JSON.parse(fs.readFileSync(dir+'/preboot-ldd-result.json'));
const matches=[];
for(const [name,value]of Object.entries(manifest)){
 const pattern=new RegExp('cat > \\.voltra/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1\\n");
 const match=profile.egg.scripts.installation.script.replace(/\r\n/g,'\n').match(pattern);
 if(!match||crypto.createHash('sha256').update(match[2]+'\n').digest('hex')!==value.sha256)throw Error('Installed source mismatch '+name);
 matches.push({name,sha256:value.sha256});
}
const stream=fs.readFileSync(dir+'/first-installer-stream.log','utf8');
if(!stream.includes('install completed')||!stream.includes("App '489650' fully installed."))throw Error('Actual successful installer terminal evidence missing');
const report={scope:'preboot only; first start held for root review',helpers:matches,actual_steam_success:true,installer_completed_event:true,
 sdk:actual.sdk,native_binaries:actual.native_binaries,volume_bytes:actual.volume_bytes,wrapper:actual.wrapper,
 native_dependencies:{...ldd,log:dir+'/preboot-ldd.log'},legal_discovery:{scan:actual.legal_scan,files:actual.legal_files.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256})),game_specific_agreement_file_found:actual.legal_files.some(x=>!x.path.startsWith('Steam/')&&!x.path.startsWith('.voltra/steamcmd/'))},release:actual.release,
 native_started:false,terms_accepted:false,limitations:['Metadata and filename/ancestor discovery are not a legal interpretation or acceptance of publisher terms. Any native prompt/account/agreement request must stop for review.','Initial read-only scanner failed with empty stderr and unretained inner exit status; corrected scanner streams hashes and exits0. No native game was started.','Optional source-driver log recovery via node-container cat returned127; installer websocket completion and actual source bytes are independently retained.']};
fs.writeFileSync(dir+'/preboot-report.json',JSON.stringify(report,null,2)+'\n');
console.log({helper_matches:matches.length,steam_success:true,dependency_exit:ldd.status,missing_libraries:ldd.contains_missing_library,legal_candidates:report.legal_discovery.files.length,native_started:false});
