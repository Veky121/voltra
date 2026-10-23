import fs from'node:fs';import{api,remote}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/barotrauma',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Native Stop must reach offline');
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
const first=read('first-private'),publicReady=read('public-ready'),created=read('campaign-created'),loaded=read('campaign-loaded'),preservation=read('reinstall-preservation'),source=read('source-proof');
if(!first.native_ready||!first.console_marker||first.opaque_console_output||!publicReady.query?.password||publicReady.query.maxplayers!==6||!created.native_probes.includes('Campaign started!')||!loaded.native_probes.includes('Campaign loaded!'))throw Error('Native acceptance evidence incomplete');
if(!preservation.build_unchanged||preservation.files.some(f=>!f.preserved||!f.metadata_preserved))throw Error('Strict preservation failed');
if(Object.values(source.matches).some(x=>!x))throw Error('Initial installed source mismatch');
const final=remote(`import pathlib,json,subprocess,re,hashlib
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
i=json.loads(subprocess.check_output(['docker','inspect','${s.uuid}'],text=True))[0]
l=subprocess.check_output(['docker','logs','${s.uuid}'],text=True,stderr=subprocess.STDOUT,errors='replace')
version=re.search(r'Barotrauma Dedicated Server ([0-9.]+)',l)
files=[{'path':str(p.relative_to(r)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in r.rglob('VoltraAcceptance517077*') if p.is_file()]
print(json.dumps({'exit_code':i['State']['ExitCode'],'oom_killed':i['State']['OOMKilled'],'native_version':version.group(1) if version else None,'campaign_files':files,'campaign_loaded':'Campaign loaded!' in l,'opaque_console_output':'\ufffd' in l,'native_warning_steam_client_context':'SteamNetworkingUtils004 before SteamAPI_Init succeeded' in l}))`);
if(final.exit_code!==0||final.oom_killed||!final.campaign_loaded||final.opaque_console_output||!final.campaign_files.some(f=>f.path.endsWith('.save')&&f.bytes>10000))throw Error('Final native proof failed');
fs.writeFileSync('artifacts/barotrauma-live-acceptance.json',JSON.stringify({profile:'barotrauma-native-v2',uuid:s.uuid,node:147,release:source.release,source_before_first_boot:source,first_private:first,public_query:publicReady.query,campaign_created:created,campaign_reloaded:loaded,strict_reinstall:preservation,final,limitations:['No player join, graphical gameplay or client password exchange','No third-party Workshop/mod loading tested','A2S advertises version 1.0.0.0; native binary reports 1.13.4.0','Private mode intentionally disables Steam query; public-query response does not prove Internet reachability','AUTO_UPDATE=0 used on the existing panel; startup update routing awaits the authorized runtime refresh'],development_evidence:['artifacts/barotrauma-development.json','artifacts/barotrauma-preservation-development.json'],observed_at:new Date().toISOString()},null,2)+'\n');
console.log({acceptance_saved:true,protected_files:preservation.files.length,native_version:final.native_version,campaign_restored:true,exit_code:final.exit_code});
