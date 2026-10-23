// Update only the stopped development candidate's owned egg; never starts native.
import fs from 'node:fs';
import {api} from './openttd-compat-node.mjs';
const dir='.local/additional-survival/enshrouded';
const receipt=JSON.parse(fs.readFileSync(dir+'/private.json'));
const server=(await api('/api/application/servers/'+receipt.internal_id)).attributes;
const resources=(await api('/api/client/servers/'+receipt.identifier+'/resources')).attributes;
if(server.uuid!==receipt.uuid||server.node!==202||server.egg!==receipt.egg_id||server.status!==null||resources.current_state!=='offline')throw Error('Owned stopped development identity mismatch');
const profile=JSON.parse(fs.readFileSync('.local/additional-survival/profiles.json'))['enshrouded/egg-enshrouded.json'];
if(profile.revision!=='enshrouded-native-v4')throw Error('Expected reviewed trixie portable runtime stage');
const previous=JSON.parse(fs.readFileSync(dir+'/observation.json'));
if(!fs.existsSync('artifacts/enshrouded-proton-development.json'))fs.writeFileSync('artifacts/enshrouded-proton-development.json',JSON.stringify({uuid:receipt.uuid,revision:'enshrouded-native-v2',accepted:false,first_native_exit:previous.container,diagnosis:'Pinned older Proton Steamworks bridge lacks SteamUtils011; native HostOnline was never reached.',native_tail:previous.logs.slice(-1800),portable_fix_native_verified:false},null,2)+'\n');
await api('/api/admin/eggs/'+receipt.egg_id+'/import','POST',profile.egg);
await api('/api/application/servers/'+receipt.internal_id+'/startup','PATCH',{docker_image:Object.values(profile.egg.docker_images)[0],environment:{XVFB:'0'}});
fs.writeFileSync(dir+'/egg-upgrade.json',JSON.stringify({uuid:receipt.uuid,egg_id:receipt.egg_id,revision:profile.revision,updated_at:new Date().toISOString(),native_started:false},null,2)+'\n');
console.log({owned_egg_updated:true,revision:profile.revision,native_started:false});
