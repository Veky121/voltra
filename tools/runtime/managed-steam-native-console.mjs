// Read native logs or exercise the shipped7Days client without secret argv.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {managedNativeLease} from './managed-steam-acceptance-lease.mjs';
const base=resolve('.local/managed-steam-native');
const runtime=JSON.parse(fs.readFileSync(join(base,'current.json'),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(runtime.run_id)||runtime.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+runtime.run_id||runtime.panel_url!=='http://127.0.0.1:18098'||resolve(runtime.directory)!==join(base,runtime.run_id))throw Error('Unexpected native fixture scope');
managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json','utf8')),runtime.lease_id,runtime.game);
const state=JSON.parse(fs.readFileSync(join(runtime.directory,'private','game.json'),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(state.uuid)||!state.uuid.startsWith(state.identifier+'-'))throw Error('Unexpected owned native game');
const execute=args=>spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:4*1024*1024});
const inspection=execute(['inspect',state.uuid]);if(inspection.status)throw Error('Owned game container unavailable');
const info=JSON.parse(inspection.stdout)[0];
if(info.Name!=='/'+state.uuid||!info.Mounts.some(mount=>mount.Source===runtime.root+'/volumes/'+state.uuid&&mount.Destination==='/home/container'))throw Error('Native container outside owned namespace');
const secrets=[state.console_password,state.game_admin_password,state.game_token,...(state.previous_console_passwords??[])].filter(Boolean).flatMap(secret=>[secret,secret.trim(),JSON.stringify(secret).slice(1,-1)]).filter(Boolean);
const redact=text=>{for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');return text;};
const [command,label]=process.argv.slice(2);
let result;
if(command==='logs')result=execute(['logs','--tail','500',state.uuid]);
else if(command==='file-log')result=execute(['exec',state.uuid,'tail','-n','80','/home/container/logs/latest.log']);
else{
 if(runtime.game!=='7days'||!info.State.Running)throw Error('Native console probe requires running owned7Days');
 const common=['exec',state.uuid,'timeout','15','rcon'];
 if(command.startsWith('reviewed-')){
  const manifest=JSON.parse(fs.readFileSync(resolve('internal/panel/managed_console_assets/manifest.json'),'utf8'));
  const expected=manifest.artifacts.find(a=>a.architecture==='amd64')?.sha256;
  const checksum=execute(['exec',state.uuid,'sha256sum','/home/container/.voltra/console-client']);
  if(checksum.status||checksum.stdout.split(/\s/)[0]!==expected)throw Error('Reviewed private executable checksum mismatch');
  const query=({'reviewed-authenticated':'getgamepref GameDifficulty','reviewed-players':'getgamepref ServerMaxPlayerCount','reviewed-protocols':'getgamepref ServerDisabledNetworkProtocols','reviewed-world-time':'gettime','reviewed-save':'saveworld','reviewed-shutdown':'shutdown','reviewed-wrong-password':'getgamepref GameDifficulty'})[command];
  if(!query)throw Error('Unsupported reviewed client probe');
  const connection=command==='reviewed-wrong-password'?['-a','127.0.0.1:'+String(state.environment.TELNET_PORT),'-p','VOLTRA_WRONG_PUBLIC_FIXTURE']:['-c','/home/container/.voltra/sevendays-console.yaml'];
  result=execute(['exec',state.uuid,'timeout','15','/home/container/.voltra/console-client','-t','telnet',...connection,query]);
 }
 else if(command==='term-wrapper'){
  const process=execute(['exec',state.uuid,'cat','/proc/7/cmdline']);
  if(process.status||JSON.stringify(process.stdout.split('\0').filter(Boolean))!==JSON.stringify(['bash','.voltra/sevendays-start.sh']))throw Error('Owned wrapper PID mismatch');
  result=execute(['exec',state.uuid,'bash','-c','kill -TERM 7']);
 }
 else if(command==='authenticated')result=execute([...common,'-t','telnet','-c','/home/container/.voltra/sevendays-console.yaml','getgamepref GameDifficulty']);
 else if(command==='save')result=execute([...common,'-t','telnet','-c','/home/container/.voltra/sevendays-console.yaml','saveworld']);
 else if(command==='world-time')result=execute([...common,'-t','telnet','-c','/home/container/.voltra/sevendays-console.yaml','gettime']);
 else if(command==='wrong-password')result=execute([...common,'-t','telnet','-a','127.0.0.1:'+String(state.environment.TELNET_PORT),'-p','VOLTRA_WRONG_PUBLIC_FIXTURE','getgamepref GameDifficulty']);
 else throw Error('Choose logs,authenticated,wrong-password');
}
if(result.error)throw Error('Bounded native console probe did not finish');
const report={observed_at:new Date().toISOString(),command,exit_code:result.status,output:redact((result.stdout??'')+'\n'+(result.stderr??''))};
if(label){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(label))throw Error('Use a bounded evidence label');fs.writeFileSync(join(runtime.directory,label+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
console.log(JSON.stringify(report));
