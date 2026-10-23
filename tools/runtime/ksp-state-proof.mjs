import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const game=process.argv[2],dir='.local/ksp-games/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json'));if(!['dmp','lmp'].includes(game))throw Error('Invalid game');
if((await api('/api/application/servers/'+s.internal_id)).attributes.uuid!==s.uuid)throw Error('Owned identity mismatch');
const info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'}).stdout)[0];if(info.State.Running||info.State.ExitCode!==0||info.State.OOMKilled)throw Error('Owned game must be gracefully stopped');
const code=`import pathlib,json,hashlib,xml.etree.ElementTree as ET
r=pathlib.Path('/server');game=${JSON.stringify(game)};secrets=json.loads(${JSON.stringify(JSON.stringify(s.passwords||[]))})
if game=='dmp':
 p=r/'Universe/Groups/AcceptancePilot.txt';assert 'VoltraAcceptance' in p.read_text();proof={'group_membership':True}
else:
 raw=(r/'LMPServer/Config/GeneralSettings.xml').read_bytes();settings=ET.fromstring(raw.decode('utf-16' if raw[:2] in (bytes([255,254]),bytes([254,255])) else 'utf-8-sig'));assert settings.findtext('MaxPlayers')=='4';assert settings.findtext('GameDifficulty')=='Normal';assert settings.findtext('GameMode')=='Career';assert settings.findtext('Password')==secrets[0];assert settings.findtext('AdminPassword')==secrets[1]
 p=r/'LMPServer/Universe/Scenarios/ResearchAndDevelopment.txt';assert '1234.5' in p.read_text();proof={'native_selected_controls':True,'password_and_admin_password_match':True,'native_science_value_preserved':1234.5}
proof.update(path=str(p.relative_to(r)),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size);print(json.dumps(proof))`;
const run=spawnSync('docker',['run','--rm','-i','--network','none','--read-only','--memory','128m','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${s.uuid},target=/server,readonly`,'python:3.13-slim','python','-B','-'],{input:code,encoding:'utf8'});if(run.status)throw Error('Native state validation failed (credentials withheld)');
const proof={uuid:s.uuid,...JSON.parse(run.stdout)};fs.writeFileSync(dir+'/native-state.json',JSON.stringify(proof,null,2));console.log(proof);
