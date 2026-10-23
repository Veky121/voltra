import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const [game,action]=process.argv.slice(2),dir='.local/ksp-games/'+game,s=JSON.parse(fs.readFileSync(dir+'/private.json'));if(!['dmp','lmp'].includes(game))throw Error('Invalid game');
if((await api('/api/application/servers/'+s.internal_id)).attributes.uuid!==s.uuid)throw Error('Owned identity mismatch');
const base='/api/client/servers/'+s.identifier;
if(action==='commands'){
 const commands=game==='dmp'?['/countclients','/say VOLTRA_DMP_CONSOLE','/editgroup VoltraAcceptance','/addplayer AcceptancePilot','/showgroups']:['/countclients','/say VOLTRA_LMP_CONSOLE','/setscience 1234.5'];
 for(const command of commands)await api(base+'/command','POST',{command});console.log('Native commands requested; acknowledgements must be observed.');
}else if(action==='reload-commands'){
 for(const command of game==='dmp'?['/showgroups','/countclients']:['/countclients','/say VOLTRA_LMP_RELOADED'])await api(base+'/command','POST',{command});console.log('Reload probes requested.');
}else if(action==='query'){
 const port=game==='dmp'?s.ports[1]:s.ports[0],response=await fetch('http://127.0.0.1:'+port+'/',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Native HTTP status '+response.status);let text=await response.text();if(text.length>1048576)throw Error('Native status exceeds limit');for(const secret of s.passwords||[])if(text.includes(secret))throw Error('Native status exposes configured credential');
 const data=JSON.parse(text),state=JSON.parse(spawnSync('docker',['inspect',s.uuid],{encoding:'utf8'}).stdout)[0].State;if(!state.Running)throw Error('Native game is not running');
 if(game==='dmp'&&(data.server_name!=='Voltra DMP'||data.max_players!==4||data.port!==s.ports[0]||data.protocol_version!==54||data.game_mode!=='CAREER'||data.warp_mode!=='SUBSPACE'))throw Error('DMP native status does not reflect selected controls');
 if(game==='lmp'){const settings=data[0]?.GeneralSettings;if(!settings||settings.ServerName!=='Voltra LMP'||settings.MaxPlayers!==4||settings.GameMode!=='Career'||settings.GameDifficulty!=='Normal'||!settings.HasPassword||!settings.HasAdminPassword||data[0].ServerConnectionSettings.Port!==s.ports[0]||data[0].ServerConnectionSettings.Upnp!==false)throw Error('LMP native status does not reflect selected controls');}
 fs.writeFileSync(dir+'/query.json',JSON.stringify({uuid:s.uuid,port,status:response.status,data,at:new Date().toISOString()},null,2));console.log({game,port,status:response.status,fields:Object.keys(data)});
}else throw Error('commands|reload-commands|query');
