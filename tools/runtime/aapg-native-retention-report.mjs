import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/aapg-native',read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const before=read('snapshot-first-stopped-full'),after=read('snapshot-after-retention');
const names=Object.keys(before.files).sort();
if(JSON.stringify(names)!==JSON.stringify(Object.keys(after.files).sort()))throw Error('Retained state file set changed');
for(const name of names)if(JSON.stringify(before.files[name])!==JSON.stringify(after.files[name]))throw Error('Strict retained state differs: '+name);
if(JSON.stringify(before.links)!==JSON.stringify(after.links))throw Error('Retained link identity differs');
const profile=read('source-profile-retention'),first=read('installed-source-first/manifest'),helpers=read('installed-source-retention/manifest'),matches=[],changed=[];
for(const[name,value]of Object.entries(helpers)){
 const pattern=new RegExp('cat > \\.voltra/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1\\n");
 const match=profile.egg.scripts.installation.script.replace(/\r\n/g,'\n').match(pattern);
 if(!match||crypto.createHash('sha256').update(match[2]+'\n').digest('hex')!==value.sha256)throw Error('New installed helper mismatch '+name);
 matches.push({name,sha256:value.sha256});if(first[name].sha256!==value.sha256)changed.push(name);
}
if(changed.length!==1||changed[0]!=='tactical_next_install.py')throw Error('Unexpected helper source delta');
const events=read('retention-installer-die-events');if(events.events.length!==1||events.events[0].Actor.Attributes.exitCode!=='0')throw Error('Reinstall DIE0 missing');
const report={uuid:events.uuid,strict_equal:true,files:names.length,metadata:['SHA256','bytes','mode','UID','GID'],links_equal:true,mtime_changes_separate:names.filter(name=>before.mtimes_ns[name]!==after.mtimes_ns[name]),helpers:matches,changed_helpers:changed,installer_raw_exit:'0',original_first_source_preserved:true,baseline_archive:read('archives/first-stopped-full'),native_second_start_authorized:false};
fs.writeFileSync(dir+'/retention-report.json',JSON.stringify(report,null,2)+'\n');
console.log({files:report.files,strict_equal:true,mtime_changes:report.mtime_changes_separate.length,helpers:matches.length,changed_helpers:changed,installer_raw_exit:'0',second_start:'held'});
