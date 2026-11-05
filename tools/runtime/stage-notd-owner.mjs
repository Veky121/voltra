import fs from 'node:fs';
import crypto from 'node:crypto';
export const key='night_of_the_dead/egg-night-of-the-dead.json';
const base='internal/panel/game_library/scripts/';
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
export function stage(current){
 const profile=structuredClone(current[key]);
 if(!['exec python3 .voltra/wasteland-servers.py run night','exec python3 .voltra/notd-server.py run'].includes(profile?.egg?.startup))throw Error('Unexpected NOTD startup; integration review required');
 const hashes={};
 let script=profile.egg.scripts.installation.script;
 script=script.replace(/(cat > \.voltra\/([^\s]+) <<'([^']+)'\n)([\s\S]*?)(\n\3\n)/g,(all,open,name,delimiter,body,end)=>{
  const file=fs.existsSync(base+name)?base+name:base+name.replaceAll('_','-');
  const source=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
  hashes[name]=sha(source);
  return open+source+end;
 });
 if(profile.egg.startup==='exec python3 .voltra/notd-server.py run'){
  for(const name of ['notd-server.py','notd-ini.py'])if(!hashes[name])throw Error('Missing NOTD helper embed');
  profile.egg.scripts.installation.script=script;
  return {profiles:{[key]:profile},hashes};
 }
 const command='python3 .voltra/wasteland-servers.py install night';
 if(script.split(command).length!==2)throw Error('Unique NOTD install entry required');
 let embeds='';
 for(const name of ['notd-server.py','notd-ini.py']){
  const body=fs.readFileSync(base+name,'utf8').replaceAll('\r\n','\n');hashes[name]=sha(body);
  embeds+=`cat > .voltra/${name} <<'VOLTRA_NOTD_OWNER'\n${body}\nVOLTRA_NOTD_OWNER\n`;
 }
 script=script.replace(command,embeds+'python3 .voltra/notd-server.py install');
 profile.egg.startup='exec python3 .voltra/notd-server.py run';
 profile.egg.scripts.installation.script=script;
 return {profiles:{[key]:profile},hashes};
}
if(process.argv[1]?.endsWith('stage-notd-owner.mjs')){
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
 const result=stage(current),out='artifacts/game-parity-20261029/notd-owner';
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(out+'/profiles.pending.json',JSON.stringify(result.profiles,null,2)+'\n');
 fs.writeFileSync(out+'/source-hashes.json',JSON.stringify(result.hashes,null,2)+'\n');
 console.log('Staged exact NOTD profile only; canonical unchanged.');
}
