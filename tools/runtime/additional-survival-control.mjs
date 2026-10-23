import fs from'node:fs';import crypto from'node:crypto';import{execFileSync}from'node:child_process';import{api,remote}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/barotrauma',file=dir+'/private.json',s=JSON.parse(fs.readFileSync(file)),action=process.argv[2],label=process.argv[3];
const base='/api/client/servers/'+s.identifier;if((await api(base)).attributes.uuid!==s.uuid)throw Error('Identity mismatch');
if(action==='campaign'){
 const command={setup:'gamemode campaign',yes:'y',name:'VoltraAcceptance517077',no:'n',first:'0',end:'endround'}[label];if(!command)throw Error('Unknown native campaign step');await api(base+'/command','POST',{command});console.log('Native campaign step sent: '+label);
}else if(action==='commands'){
 for(const command of ['servermsg VOLTRA_NATIVE_CONSOLE_517077','clientlist','gamemode'])await api(base+'/command','POST',{command});console.log('Native console probes sent; verify acknowledgements.');
}else if(action==='public'){
 if((await api(base+'/resources')).attributes.current_state!=='offline')throw Error('Stop first');
 s.join_password ||=crypto.randomBytes(18).toString('base64url');fs.writeFileSync(file,JSON.stringify(s,null,2),{mode:0o600});
 await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{PUBLIC_SERVER:'1',SERVER_PASSWORD:s.join_password}});console.log('Owned native public-query mode and private password selected.');
}else if(action==='paths'){
 console.log(remote(`import json,pathlib
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
print(json.dumps({'campaign_files':[{'path':str(p.relative_to(r)),'bytes':p.stat().st_size} for p in r.rglob('VoltraAcceptance517077*') if p.is_file()]}))`));
}else if(action==='record'){
 if(!/^[a-z-]+$/.test(label||''))throw Error('Safe evidence label required');
 const data=remote(`import json,pathlib,subprocess,xml.etree.ElementTree as ET,re
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
i=json.loads(subprocess.check_output(['docker','inspect','${s.uuid}'],text=True))[0]
l=subprocess.check_output(['docker','logs','${s.uuid}'],text=True,stderr=subprocess.STDOUT,errors='replace')
a={k.lower():v for k,v in ET.parse(r/'serversettings.xml').getroot().attrib.items()}
clean=re.sub(r'\x1b\\[[0-9;?]*[A-Za-z]','',l)
print(json.dumps({'native_ready':'Server started' in l,'console_marker':'Message of the day: VOLTRA_NATIVE_CONSOLE_517077' in clean,'opaque_console_output':'\ufffd' in l,'exit_code':i['State']['ExitCode'],'running':i['State']['Running'],'settings':{k:a.get(k) for k in ['servername','port','queryport','maxplayers','ispublic','servermessagetext']},'has_password':bool(a.get('password')),'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'native_probes':[x.strip() for x in clean.splitlines() if any(k in x.lower() for k in ['server started','current gamemode','no clients','clientlist','voltra_native_console_517077','campaign','current location','save name']) and '\ufffd' not in x][-18:]}))`);
 if(data.settings.ispublic?.toLowerCase()==='true')data.query=JSON.parse(execFileSync(process.execPath,['tools/game-query/query.mjs','barotrauma','192.168.178.89',String(s.ports[1])],{encoding:'utf8'}));
 fs.writeFileSync(dir+'/'+label+'.json',JSON.stringify(data,null,2));console.log(data);
}else throw Error('commands|campaign STEP|public|record LABEL');
