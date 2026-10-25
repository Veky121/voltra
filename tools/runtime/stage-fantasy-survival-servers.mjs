import fs from 'node:fs';
import crypto from 'node:crypto';
const base='internal/panel/game_library/scripts/',dir='.local/fantasy-survival-servers';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const existing=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json')),profiles={};
const games={nightingale:'Nightingale/egg-nightingale.json',moria:'return_to_moria/egg-the-lord-of-the-rings--return-to-moria.json',smalland:'smalland_survive_the_wilds/egg-smalland--survive-the-wilds.json'};
const images={nightingale:'ghcr.io/ptero-eggs/steamcmd@sha256:a692e76b2dac3685b4161799a17636a74f38a49e73e782f9e8dde16d28fee8b2',moria:'ghcr.io/ptero-eggs/yolks@sha256:eedeb0ff1684592ee0f28119d7111f7ba14488dfa9537c99689dfe7a33ba2553',smalland:'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
const files=[['steam-template.py','steam_template.py'],['additional-survival-install.py','additional_survival_install.py'],['native-config.py','native-config.py'],['native-console.py','native-console.py'],['native-release.py','native-release.py'],['steam-native-next.py','steam-native-next.py'],['private-wine-prerequisites.py','private-wine-prerequisites.py'],['bundle-debian-python.py','bundle_debian_python.py'],['fantasy-survival-servers.py','fantasy_survival_servers.py'],['fantasy-survival-pins.json','fantasy-survival-pins.json']];
function add(egg,name,key,value,rules,description,visible=true){if(!egg.variables.some(v=>v.env_variable===key))egg.variables.push({name,env_variable:key,default_value:value,rules,description,user_viewable:visible,user_editable:visible,field_type:/PASS|Secret/.test(key)?'password':'text'});}
for(const[game,path]of Object.entries(games)){
 const entry=catalog.entries.find(e=>e.path===path);if(!entry)throw Error('Missing exact recipe '+path);
 const egg=structuredClone(entry.egg),previous=existing[path]||{};
 egg.features=[...new Set([...(egg.features||[]),'voltra_steam_template'])];
 egg.docker_images={[game==='nightingale'?'Pinned original Ubuntu24 dedicated runtime':game==='moria'?'Pinned original Wine dedicated runtime':'Pinned original Debian dedicated runtime']:images[game]};
 egg.startup=`exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/fantasy_survival_servers.py run ${game}`;
 egg.config={files:'{}',startup:entry.egg.config.startup,logs:entry.egg.config.logs,stop:'^C'};
 if(game==='moria'){
  egg.features.push('voltra_typed_wine');
  add(egg,'Automatic updates','AUTO_UPDATE','1','required|boolean','Preserves the original Wine image automatic-update default through the typed Steam updater; the stock raw updater is disabled.');
  add(egg,'Accept Windows runtime licenses','ACCEPT_WINDOWS_RUNTIME_LICENSES','false','required|string|in:true,false','Review the applicable Microsoft Visual C++ runtime licenses before explicitly accepting original vcrun2022 preparation in this private Wine prefix. No automatic license acceptance or machine-wide install.');
  // Preserve the historical marker as provenance only; an authentication error cannot certify readiness.
  egg.config.startup=JSON.stringify({done:'Voltra native readiness requires Moria acceptance; imported AutoLogin error is not readiness',userInteraction:[]});
 }
 for(const v of egg.variables){
  if(/PASS/.test(v.env_variable))v.field_type='password';
  if(['STEAM_USER','STEAM_PASS','STEAM_AUTH'].includes(v.env_variable))v.description+=' Private Steam credentials are explicitly gated by the shared typed Steam parser; no account or anonymous payload substitution.';
 }
 for(const[key,name]of [['STEAM_USER','Steam account'],['STEAM_PASS','Steam password'],['STEAM_AUTH','Steam authentication code'],['SRCDS_BETAID','Steam branch'],['SRCDS_BETAPASS','Private branch password']])add(egg,name,key,'','nullable|string|max:128',key==='SRCDS_BETAID'?'Optional public Steam branch. Empty retains public branch.':'Original advanced installation control. Private Steam account/authentication/password paths fail explicitly before acquisition until shared parser support is verified.',false);
 add(egg,'Additional legacy installation flags','INSTALL_FLAGS','','nullable|string|max:256','Original generic Steam installation API retained; raw nonempty command flags fail explicitly instead of being evaluated.',false);
 if(game!=='moria')add(egg,'Windows installation option','WINDOWS_INSTALL','0','required|in:0,1','Original optional platform API retained. This original Linux runtime rejects 1 explicitly; no unrelated Linux payload is substituted.',false);
 if(game==='smalland'){
  egg.config.startup=JSON.stringify({done:'LogGameMode: Display: Match State Changed from EnteringMap to WaitingToStart'});
  add(egg,'Fall damage modifier','FALLDAMAGEMODIFIER','','nullable|numeric|min:0','Imported startup references this previously undefined control. Empty preserves the original empty native argument; an explicit numeric value passes through. Publisher bounds/default remain unverified.');
  for(const key of ['DeploymentId','DedicatedServerClientId','DedicatedServerClientSecret','DedicatedServerPrivateKey']){
   const match=entry.egg.startup.match(new RegExp('-ini:Engine:\\[EpicOnlineServices\\]:'+key+'=([^\\s]*)'));
   if(!match)throw Error('Original publisher bootstrap identity missing');
   add(egg,'Original publisher EOS '+key,'SMALLAND_EOS_'+key,match[1],'nullable|string|max:256','Exact original publisher bootstrap value retained read-only. It remains in native argv, visible to the host process owner, with console-output redaction. This is not a request for user/account credentials.',false);
  }
 }
 let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n';
 for(const[source,target]of files)script+=`cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync(base+source,'utf8')}\nVOLTRA_SOURCE\n`;
 script+=`python3 .voltra/bundle_debian_python.py\npython3 .voltra/fantasy_survival_servers.py install ${game}\n`;
 egg.scripts.installation={container:game==='nightingale'?'ubuntu:24.04':game==='moria'?'debian:trixie-slim':'debian:bookworm-slim',entrypoint:'bash',script};
 profiles[path]={upstream_sha256:entry.sha256,revision:'fantasy-survival-servers-v1',platforms:['linux/amd64'],required_ports:1,defaults:{memory:game==='nightingale'?8192:4096,disk:game==='nightingale'?16384:8192},verification:previous.verification||'not_verified',detail:previous.detail||'Source-only adapter and offline fixtures. No native download, boot, query, save, clean-stop, player connection or gameplay proof.',egg,setup_steps:[
  game==='nightingale'?'Original Linux/Ubuntu24 dedicated AppID3796810. ExampleServerSettings.ini must come from the publisher payload; settings section is discovered from that example. Difficulty, passwords, max players, cheats and allocated game port are preserved. More than six players is unsupported by the publisher but remains selectable.':game==='moria'?'Original Windows dedicated AppID3349480 runs in pinned Wine image with original vcrun2022 and WINEDEBUG=-all. Stock image Steam update and raw Winetricks actions are disabled by shared typed runtime hooks. Shared private-prefix prerequisites allow only original vcrun2022, behind explicit operator Microsoft runtime license acknowledgement. Actual runtime behavior remains unverified.':'Original Linux dedicated AppID808040. All imported FURL gameplay/listing controls and EOS bootstrap arguments are preserved; publisher bootstrap and password argv remain visible to the host process owner. Console output is redacted. No user credentials are requested.',
  'Public/anonymous typed Steam install uses the exact original AppID. Public branches are supported; private account/auth/beta-password and raw INSTALL_FLAGS paths fail explicitly before bootstrap. Publisher binaries are not open source and client-game licensing remains separate.',
  game==='moria'?'MoriaServerConfig.ini keeps unknown sections and controls. World.Create difficulty affects new worlds only. Original Console.Enabled=false and native log-file forwarding remain. Permissions/rules and Moria/Saved worlds remain editable through Files. Imported AutoLogin error is never used as readiness proof.':game==='nightingale'?'Publisher configuration, NWX/Saved realms/profiles/config/backups, plugins and mod folders survive update success or failure. Existing settings comments and unknown keys remain. Never reset an existing realm to apply these controls.':'Smalland Saved/config/mod/plugin paths are retained across update success or failure. DETERIORATION=0 retains inverse NODETERIORATION behavior. Undefined original fall modifier remains empty by default, with explicit numeric override and no invented publisher default.',
  'One allocated primary port preserves the imported recipe footprint; complete actual runtime socket footprint, SIGINT save/stop, account services and player connectivity remain unverified. No host firewall/sysctl changes, automatic licensing acceptance or fabricated game assets.'
 ]};
}
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/profiles.json',JSON.stringify(profiles,null,2)+'\n');
const checkpoints=['tools/runtime/stage-fantasy-survival-servers.mjs','tools/runtime/test-fantasy-survival-servers.mjs','tools/runtime/test-fantasy-survival-servers.py'];
const hash=crypto.createHash('sha256');for(const[source]of files)hash.update(fs.readFileSync(base+source));for(const p of Object.values(profiles))hash.update(JSON.stringify(p.egg));for(const file of checkpoints)hash.update(fs.readFileSync(file));
const archive=dir+'/source-archive/'+hash.digest('hex'),existed=fs.existsSync(archive);fs.mkdirSync(archive,{recursive:true});
const immutable=(name,body)=>{const p=archive+'/'+name;if(fs.existsSync(p)){if(!fs.readFileSync(p).equals(Buffer.from(body)))throw Error('Immutable archive mismatch');}else fs.writeFileSync(p,body,{flag:'wx'});};
const manifest={created_at:new Date().toISOString(),files:{},recipes:{},native_tested:false};
for(const[source]of files){const body=fs.readFileSync(base+source);immutable(source,body);manifest.files[source]=crypto.createHash('sha256').update(body).digest('hex');}
for(const file of checkpoints){const body=fs.readFileSync(file),name=file.split('/').at(-1);immutable(name,body);manifest.files[name]=crypto.createHash('sha256').update(body).digest('hex');}
for(const[path,p]of Object.entries(profiles)){const body=JSON.stringify(p.egg,null,2)+'\n';immutable(path.replaceAll('/','__'),body);immutable('original__'+path.replaceAll('/','__'),JSON.stringify(catalog.entries.find(e=>e.path===path),null,2)+'\n');manifest.recipes[path]={upstream_sha256:p.upstream_sha256,staged_egg_sha256:crypto.createHash('sha256').update(body).digest('hex')};}
if(!existed)fs.writeFileSync(archive+'/manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(dir+'/latest-source-archive.json',JSON.stringify({archive},null,2)+'\n');
console.log('Three exact fantasy survival profiles staged; native verification unchanged.');
