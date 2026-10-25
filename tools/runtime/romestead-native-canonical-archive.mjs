import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const dir=process.argv[2];if(!dir||!/^\.local\/romestead-native(?:-[a-z0-9_-]+)?$/.test(dir))throw Error('Specify exact owned source archive directory');
const p=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))['romestead/egg-romestead.json'];
const target=path.join(dir,'canonical-source');if(fs.existsSync(target))throw Error('Immutable source snapshot exists');fs.mkdirSync(target,{recursive:true});
fs.writeFileSync(target+'/profile.json',JSON.stringify(p,null,2)+'\n');const modules=[];
for(const m of p.egg.scripts.installation.script.matchAll(/cat > \.voltra\/([^ ]+) <<'([^']+)'\r?\n([\s\S]*?)\r?\n\2/g)){const body=Buffer.from(m[3].replaceAll('\r\n','\n')+'\n');fs.writeFileSync(target+'/'+m[1],body);modules.push({name:m[1],bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});}
if(modules.length!==10)throw Error('Unexpected canonical source count');fs.writeFileSync(target+'/manifest.json',JSON.stringify({modules,normalization:'Installer emitted LF and final newline',profile_sha256:createHash('sha256').update(fs.readFileSync(target+'/profile.json')).digest('hex')},null,2)+'\n');console.log({archive:target,modules:modules.length});
