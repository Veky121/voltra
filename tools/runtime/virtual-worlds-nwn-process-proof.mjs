import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const dir='.local/virtual-worlds/nwn',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const phase=process.argv[2]||'final';if(!/^[a-z0-9-]+$/.test(phase))throw Error('Expected evidence phase');
const code=`import pathlib,json,os,tomllib,stat
found=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  argv=(p/'cmdline').read_bytes().split(b'\\0');env=(p/'environ').read_bytes().split(b'\\0')
 except (PermissionError,FileNotFoundError):continue
 if argv and argv[0]==b'/home/container/bin/linux-x86/nwserver-linux':
  keys=[v.split(b'=',1)[0].decode() for v in env if v]
  assert not any(v in keys for v in ['PLAYER_PASSWORD','DM_PASSWORD','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'])
  assert b'-playerpassword' not in argv and b'-dmpassword' not in argv
  found.append({'pid':int(p.name),'cwd':str((p/'cwd').resolve()),'argv':[v.decode() for v in argv if v],'private_credentials_in_argv_or_environment':False,'nss_wrapper_enabled':'NSS_WRAPPER_PASSWD' in keys})
assert len(found)==1
p=pathlib.Path('/home/container/user/settings.tml');value=tomllib.loads(p.read_text());assert stat.S_IMODE(p.stat().st_mode)==0o600
print(json.dumps({'native_process':found[0],'private_settings_mode':'0600','native_dm_password_configured':bool(value['server']['login']['dm-password']),'native_player_password_configured':bool(value['server']['login']['player-password']),'operator_log_rotation_enabled':value['server']['log']['rotation']['enabled']}))`;
const r=spawnSync('docker',['exec',s.uuid,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',timeout:15000});
if(r.status)throw Error('Native process privacy proof failed '+r.stderr.slice(-500));
const proof={uuid:s.uuid,at:new Date().toISOString(),...JSON.parse(r.stdout)};fs.writeFileSync(dir+'/'+phase+'-process-proof.json',JSON.stringify(proof,null,2));console.log(proof);
