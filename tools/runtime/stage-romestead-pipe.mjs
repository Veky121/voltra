// Scoped preparation while canonical Go/embed consumers are frozen.
import fs from 'node:fs';import {createHash} from 'node:crypto';
const base='internal/panel/game_library/scripts/',dir='.local/romestead-pipe',raw=fs.readFileSync(base+'crafting-runtime.py','utf8'),before='terminal_input=True,output_observer=lambda data:None',after='terminal_input=False,output_observer=lambda data:None';
if(raw.split(before).length!==2)throw Error('Expected one Romestead-only native call');
const patched=raw.replace(before,after),key='romestead/egg-romestead.json',profile=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key];
const pattern=/(cat > \.voltra\/crafting_runtime.py <<'VOLTRA_SOURCE'\r?\n)([\s\S]*?)(\r?\nVOLTRA_SOURCE)/;
if(!pattern.test(profile.egg.scripts.installation.script))throw Error('Canonical runtime heredoc missing');
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(pattern,(_,head,body,tail)=>head+patched.replaceAll('\r\n','\n').replace(/\n$/,'')+tail);
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/crafting-runtime.py',patched);fs.writeFileSync(dir+'/profiles.json',JSON.stringify({[key]:profile},null,2)+'\n');
const archive=dir+'/source-archive/'+createHash('sha256').update(profile.egg.scripts.installation.script).digest('hex');if(fs.existsSync(archive))throw Error('Immutable pipe stage exists');fs.mkdirSync(archive,{recursive:true});
const manifest=[];for(const m of profile.egg.scripts.installation.script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2/g)){const bytes=Buffer.from(m[3].replaceAll('\r\n','\n')+'\n');fs.writeFileSync(archive+'/'+m[1],bytes);manifest.push({name:m[1],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
if(manifest.length!==10)throw Error('Expected10exact source modules');fs.writeFileSync(archive+'/profiles.json',JSON.stringify({[key]:profile},null,2)+'\n');fs.writeFileSync(archive+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(dir+'/latest-source-archive.json',JSON.stringify({archive},null,2)+'\n');console.log({archive,runtime_sha256:createHash('sha256').update(patched).digest('hex'),canonical_files_modified:false});
