import fs from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

// Reconstruct public launcher bytes from the source retained with this exact
// fixture generation. Never use the moving shared source for native evidence.
export function retainedPalworldLauncher(directory, platform, port){
 if(!['linux','windows'].includes(platform)||!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Typed platform and console port required');
 const source=join(directory,'source-at-first-install');
 const read=path=>fs.readFileSync(join(source,path));
 const go=read('internal/panel/steam_catalog_palworld.go').toString().replaceAll('\r','');
 const format=go.match(/launcher := fmt.Sprintf\(`([\s\S]*?)`, artifact.SHA256/);
 if(!format)throw Error('Retained launcher renderer missing');
 const consoleManifest=JSON.parse(read('internal/panel/managed_console_assets/manifest.json'));
 const consoleSHA=consoleManifest.artifacts.find(x=>x.architecture==='amd64').sha256;
 let preflight='',inner=null;
 if(platform==='windows'){
  const assets='internal/palworldloader/assets';
  for(const name of fs.readdirSync(join(source,assets)).sort()){
   const bytes=read(assets+'/'+name);
   preflight+=`printf '%s  %s\\n' '${digest(bytes)}' '/home/container/.voltra/palworld-loader-tools/${name}' | sha256sum -c - >/dev/null\n`;
  }
  preflight+='python3 /home/container/.voltra/palworld-loader-tools/runtime.py verify\n';
  const innerSource=read('internal/panel/steam_catalog_palworld_proton.go').toString().replaceAll('\r','');
  const match=innerSource.match(/return \[\]byte\(`([\s\S]*?)`\)/);
  if(!match)throw Error('Retained private Proton renderer missing');
  inner=Buffer.from(match[1]);
  preflight+=`printf '%s  %s\\n' '${digest(inner)}' '/home/container/.voltra/palworld-proton-run.sh' | sha256sum -c - >/dev/null\n`;
 }
 const readiness=format[1].includes('if %s;')?(platform==='windows'?`timeout 1 bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}' >/dev/null 2>&1`:`nc -z 127.0.0.1 ${port}`):port;
 const values=[consoleSHA,`Pal/Saved/Config/${platform==='windows'?'WindowsServer':'LinuxServer'}/PalWorldSettings.ini`,preflight,platform==='windows'?'/usr/bin/xvfb-run -a /bin/bash .voltra/palworld-proton-run.sh':'./Pal/Binaries/Linux/PalServer-Linux-Shipping Pal',platform==='windows'?5:15,readiness,readiness];
 let index=0;
 const launcher=format[1].replaceAll('%%','__PUBLIC_LITERAL_PERCENT__').replace(/%[sd]/g,()=>String(values[index++])).replaceAll('__PUBLIC_LITERAL_PERCENT__','%');
 if(index!==values.length)throw Error('Retained launcher substitution contract changed');
 return {launcher:Buffer.from(launcher),inner};
}
