import fs from'node:fs';import crypto from'node:crypto';import{api,rows,remote,file,directory}from'./openttd-compat-node.mjs';
const s=JSON.parse(fs.readFileSync(file));
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Stop first');
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
const nest=(await api('/api/application/nests/'+s.nest_id)).attributes,egg=(await api('/api/admin/eggs/'+s.egg_id)).attributes;
if(server.uuid!==s.uuid||server.node!==147||server.egg!==s.egg_id||nest.name!=='OpenTTD compatibility acceptance '+s.request_id||egg.nest_id!==s.nest_id)throw Error('Owned identity mismatch');
const first=JSON.parse(fs.readFileSync(directory+'/first-ready.json')),second=JSON.parse(fs.readFileSync(directory+'/explicit-local.json')),last=JSON.parse(fs.readFileSync(directory+'/after-reinstall.json'));
const seed=x=>x.native_probes.find(p=>p.startsWith('Generation Seed:'));
if(!seed(first)||seed(first)!==seed(second)||seed(first)!==seed(last))throw Error('World seed changed');
const preservation=JSON.parse(fs.readFileSync(directory+'/reinstall-preservation.json'));
if(preservation.files.some(f=>!f.preserved))throw Error('Preservation failed');
const final=remote(`import json,pathlib,hashlib,subprocess
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
i=json.loads(subprocess.check_output(['docker','inspect','${s.uuid}'],text=True))[0]
l=subprocess.check_output(['docker','logs','${s.uuid}'],text=True,stderr=subprocess.STDOUT)
print(json.dumps({'exit_code':i['State']['ExitCode'],'oom_killed':i['State']['OOMKilled'],'launcher_sha256':hashlib.sha256((r/'.voltra/openttd-start.sh').read_bytes()).hexdigest(),'binary_sha256':hashlib.sha256((r/'openttd').read_bytes()).hexdigest(),'native_save_ack':"Map successfully saved to '/home/container/voltra-compat.sav'." in l,'native_ready': 'Network revision name: 15.3' in l}))`);
const source=fs.readFileSync('internal/panel/game_library/scripts/openttd-start.sh','utf8')+'\n';
if(final.exit_code!==0||final.oom_killed||!final.native_save_ack||!final.native_ready||final.launcher_sha256!==crypto.createHash('sha256').update(source).digest('hex'))throw Error('Final native/source proof failed');
const result={profile:'openttd-15.3-compat-v4',uuid:s.uuid,node:147,versions:{openttd:'15.3',opengfx:'8.0'},first_install_and_boot:true,legacy_false_auto:first,explicit_local_over_legacy_true:second,after_reinstall:last,world_seed_preserved:true,protected_files:preservation.files,final,limitations:['No player join or graphical gameplay','No public listing registration tested','Alternative release manifests tested; alternative binaries not runtime verified'],observed_at:new Date().toISOString()};
fs.writeFileSync('artifacts/openttd-compat-acceptance.json',JSON.stringify(result,null,2)+'\n');
const marker=directory+'/cleanup-request.json';if(fs.existsSync(marker))throw Error('Cleanup already requested; inspect existing result');
const allocations=rows(await api('/api/admin/nodes/147/allocations'));const allocation=allocations.find(a=>a.id===s.allocation_ids[0]);
if(!allocation||allocation.ip!=='192.168.178.89'||allocation.port!==s.port)throw Error('Owned allocation changed');
fs.writeFileSync(marker,JSON.stringify({uuid:s.uuid,requested_at:new Date().toISOString()}));
await api('/api/application/servers/'+s.internal_id,'DELETE');
const freed=rows(await api('/api/admin/nodes/147/allocations')).find(a=>a.id===allocation.id);if(!freed||freed.assigned)throw Error('Owned allocation not released');
await api('/api/admin/nodes/147/allocations','DELETE',{allocations:[allocation.id]});
await api('/api/admin/eggs/'+s.egg_id,'DELETE');await api('/api/admin/nests/'+s.nest_id,'DELETE');
console.log({acceptance_saved:true,owned_api_resources_removed:true});
