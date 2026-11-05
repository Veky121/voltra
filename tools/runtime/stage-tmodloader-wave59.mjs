import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const key='terraria/tmodloader/egg-t-modloader.json';
export function stage(current, helper, installer) {
 const profile=structuredClone(current[key]);
 if(!profile?.egg) throw Error('Exact tModLoader recipe missing');
 let script=profile.egg.scripts.installation.script;
 const start="cat > .voltra/tmodloader_runtime.py <<'VOLTRA_TMODLOADER_RUNTIME'\n";
 const end='\nVOLTRA_TMODLOADER_RUNTIME\n';
 const at=script.indexOf(start), until=script.indexOf(end,at+start.length);
 if(at<0||until<0||!script.includes('from terraria_release_install import install'))throw Error('Installer embedding contract changed');
 script=script.slice(0,at+start.length)+helper.replace(/\r\n/g,'\n').trimEnd()+script.slice(until);
 script=script.replace('\nfrom terraria_release_install import install\n','\nfrom tmodloader_runtime import install\n');
 const marker="cat > .voltra/terraria_release_install.py <<'VOLTRA_TERRARIA_RELEASE'\n";
 const begin=script.indexOf(marker), finish=script.indexOf('\nVOLTRA_TERRARIA_RELEASE\n',begin+marker.length);
 if(begin<0||finish<0) throw Error('Shared installer embedding contract changed');
 script=script.slice(0,begin+marker.length)+installer.replace(/\r\n/g,'\n').trimEnd()+script.slice(finish);
 profile.egg.config.files=JSON.stringify({'serverconfig.txt':{parser:'properties',find:{port:'{{server.build.default.port}}'}}});
 profile.egg.scripts.installation.script=script;
 return {[key]:profile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const out=process.argv[2];if(!out)throw Error('Explicit isolated output file required');
 if(fs.existsSync(out))throw Error('Output already exists');
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
 const helper=fs.readFileSync('internal/panel/game_library/scripts/tmodloader-runtime.py','utf8');
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(stage(current,helper,fs.readFileSync('internal/panel/game_library/scripts/terraria-release-install.py','utf8')),null,2)+'\n',{flag:'wx'});
}
