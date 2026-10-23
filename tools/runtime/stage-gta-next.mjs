import fs from'node:fs';import{execFileSync}from'node:child_process';
for(const generator of['stage-gtac-profile.mjs','stage-ragecoop-profile.mjs','stage-gta-legacy-profiles.mjs','stage-samp-profile.mjs','stage-fivem-profile.mjs','stage-redm-profile.mjs'])execFileSync(process.execPath,['tools/runtime/'+generator],{stdio:'inherit'});
const profiles=JSON.parse(fs.readFileSync('.local/gta-next/profiles.json')),prior=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
for(const[path,profile]of Object.entries(profiles)){
 if(prior[path]?.revision===profile.revision&&profile.verification!==prior[path].verification)throw Error('Reviewed status changed: '+path);
 const script=profile.egg.scripts.installation.script;
 for(const name of['native-release.py','gta-install.py','gta-runtime.py','native-config.py','native-console.py'])if(!script.includes(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')))throw Error('Stale helper '+name+' in '+path);
 console.log(path+': '+profile.verification);
}
