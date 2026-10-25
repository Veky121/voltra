import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='.local/aapg-native',read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const before=read('snapshot-second-stopped'),after=read('snapshot-after-name-fix'),names=Object.keys(before.files).sort();
if(names.length!==49||JSON.stringify(names)!==JSON.stringify(Object.keys(after.files).sort()))throw Error('49-state file set differs');
for(const name of names)if(JSON.stringify(before.files[name])!==JSON.stringify(after.files[name]))throw Error('Strict name-fix retention differs: '+name);
if(JSON.stringify(before.links)!==JSON.stringify(after.links))throw Error('Link identity differs');
const profile=read('source-profile-name-fix'),previous=read('installed-source-second/manifest'),helpers=read('installed-source-name-fix/manifest'),matches=[],changed=[];
for(const[name,value]of Object.entries(helpers)){
 const pattern=new RegExp('cat > \\.voltra/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+" <<'([^']+)'\\n([\\s\\S]*?)\\n\\1\\n");
 const match=profile.egg.scripts.installation.script.replace(/\r\n/g,'\n').match(pattern);
 if(!match||crypto.createHash('sha256').update(match[2]+'\n').digest('hex')!==value.sha256)throw Error('Canonical helper mismatch: '+name);
 matches.push({name,sha256:value.sha256});if(previous[name].sha256!==value.sha256)changed.push(name);
}
if(changed.length!==1||changed[0]!=='tactical_next_runtime.py')throw Error('Unexpected source delta');
const events=read('name-fix-installer-die-events');if(events.events.length!==1||events.events[0].Actor.Attributes.exitCode!=='0')throw Error('Name-fix installer DIE0 absent');
const result={uuid:events.uuid,files:49,strict_equal:true,metadata:['SHA256','bytes','mode','UID','GID'],links_equal:true,mtime_changes_separate:names.filter(name=>before.mtimes_ns[name]!==after.mtimes_ns[name]),helpers:matches,changed_helpers:changed,installer_raw_exit:'0',conditional_third_start_prerequisites_passed:true};
fs.writeFileSync(dir+'/name-fix-retention-report.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log({files:49,strict_equal:true,helpers:matches.length,changed_helpers:changed,installer_raw_exit:'0',conditional_third_start:true});
