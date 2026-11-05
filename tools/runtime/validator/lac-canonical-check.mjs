/** Source-only canonical LAC gates; historical acceptance is not current-helper proof. */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {campaign as h,receipt} from './campaign-session.mjs';
export const recipe='losangelescrimes/egg-l-a-c--online-public-server.json';
export const lacIdentity=(id,current)=>id==='lac-canonical'&&current===build;
export const build='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const profileSHA256='48aca038893935095aa6202f2fc496b24cc65faaeaf3ee95f99beeaf285b8321',scriptSHA256='0a29bee233a04d79403e9b83964e69e209768ddfe175762ecc17d60e8295ea50',historicalSHA256='727a7a4150142737b61e91feff7be32c0ee39d8aae990adda00d137d64f276e7';
export const pins={".voltra/steam_template.py": "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd", ".voltra/native-console.py": "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5", ".voltra/onset-mariadb-compat.py": "7d68cf7fa520ab5afc5b66a21ddaf66daf4ca2f44c780dbba9336087c839553b", ".voltra/additional_survival_install.py": "a2c9dca09dc86279e0f154a5d1574f6e6e68d4c4260687cf6fffe7003ea55b29", ".voltra/native-release.py": "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193", ".voltra/small-native-install.py": "13543ec2dac32acafa497b2acd84724dccda5ef5b8fe52571ffc7be10c370a39", ".voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0", ".voltra/open_world_servers.py": "0dd83bcbc9bd46ceee3661b69e75bd63c2219c909e6a86d20e641ba5e65f8d28", ".voltra/open-world-releases.json": "6361344affbdad8f45b75dbaadd3a80105273382606587bdb1af0d6e5c61cfa1"};
export const snapshot=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-22/build-input-1793678490224');
export const archiveSHA='85a2592a3fafc3d92bb1021f860f29c7b4debb0869fd313cf16ce3db7f96eb8e',binarySHA='2f4534b3534d61c843a7f20cbd5df7c2deef9fb0211d60ea362cda7bdecdeabc';
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function installedSource(ctx,c){
 const f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt),s=(await h.api('/api/application/servers/'+f.server.id)).attributes;
 const canonicalContext=ctx.game.id==='lac-canonical'&&ctx.game.recipe===undefined&&f.template===sha(recipe).slice(0,16)&&f.intent?.template===f.template&&f.intent.scriptHash===scriptSHA256&&f.intent.build===build;
 if(ctx.build!==build||receipt.binary_sha256!==build||resolve(receipt.snapshot)!==snapshot||(ctx.game.recipe!==recipe&&!canonicalContext)||f.recipe!==recipe||s.uuid!==f.server.uuid||s.name!=='validator-'+ctx.game.id||s.egg!==f.egg.id||s.container.startup_command!==p.egg.startup||p.egg.startup!=='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/open_world_servers.py run lac'||p.egg.config.stop!=='^C'||Number(s.node)===202||s.container.environment.VER!=='1.9.7'||s.container.environment.PUBLIC_SERVER!=='false')throw Error('Exact candidate22 isolated LAC source/Startup authority required');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],sha(m[3]+'\n')]));
 for(const [path,pin]of Object.entries(pins))if(emitted[path]!==pin||sha(await c.read('/'+path))!==pin)throw Error('Exact emitted LAC helper differs: '+path);
 return {helpers:pins,scope:'Current source only; old native receipt separately historical'};
}
export async function canonicalExposure(ctx,c){
 await installedSource(ctx,c);const startup=await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/startup'),fields=startup.data.map(x=>x.attributes??x);
 for(const [key,value]of Object.entries({VER:'1.9.7',MAX_PLAYERS:'16',MAP_NAME:'TrainFacility',PUBLIC_SERVER:'false',SERVER_LANGUAGE:'English'})){const found=fields.filter(f=>f.env_variable===key);if(found.length!==1||String(found[0].server_value)!==value||found[0].is_editable!==h.profileFromRuntime(recipe,receipt).egg.variables.find(v=>v.env_variable===key)?.user_editable)throw Error('Canonical LAC supported Startup control differs: '+key);}
 verifyLACConfig(await c.read('/.config/unity3d/MA/LAC/ServerConfig.txt'),ctx.fixture.ports[0]);
 const inventory=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings')).attributes;if(!Array.isArray(inventory.fields)||inventory.fields.length||!Array.isArray(inventory.documents)||inventory.documents.length||inventory.file!=='')throw Error('LAC unexpectedly advertises gameplay-document authority');
 // No LAC file-editor authority exists in22. Never synthesize document fields.
 const root=(await c.api('GET','/api/client/servers/'+ctx.fixture.server.uuid+'/files/list?directory=%2F')).data;
 if(!Array.isArray(root))throw Error('Actual canonical file inventory missing');
 return {startupControls:true,fileInventory:true,typedGameplayDocument:false,publisherConfigMayNeedFirstBoot:true,scope:'Supported Startup controls and real Files only; no gameplay-editor or fresh native acceptance claim'};
}

const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyLACPrior(ctx,report,raw,pin,frozen){
 const p=h.profileFromRuntime(recipe,receipt);
 if(ctx.build!==build||resolve(pin.path)!==resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/lac-native-acceptance.json')||sha(raw)!==historicalSHA256||pin.sha256!==historicalSHA256||report.recipe!==recipe||report.version!=='1.9.7'||report.acquisition?.archive_sha256!==archiveSHA||report.acquisition.bytes!==159821766||report.native?.normal_panel_stops?.length!==3||report.native.normal_panel_stops.some(x=>x.raw_exit!==0||x.oom_killed!==false)||report.persistence?.strict_reinstalls?.length!==2||report.persistence.strict_reinstalls.some(x=>x.sha_bytes_mode_uid_gid_equal!==true)||frozen?.profileSHA256!==profileSHA256||frozen?.scriptSHA256!==scriptSHA256||frozen?.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false||sha(JSON.stringify(sorted(p)))!==profileSHA256||sha(p.egg.scripts.installation.script)!==scriptSHA256)throw Error('Exact historical LAC proof/current-source-pending acknowledgement required');
 return {historical:true,nativeCurrentPending:true,typedGameplayDocument:false,sourceHelpersChanged:true};
}

export function verifyLACConfig(text,port){const values={};for(const line of text.split(/\r?\n/)){if(!line.trim()||line.trimStart().startsWith('#')||!line.includes('='))continue;const at=line.indexOf('='),key=line.slice(0,at).trim().toLowerCase();if(Object.hasOwn(values,key))throw Error('Duplicate LAC publisher scalar');values[key]=line.slice(at+1).trim();}for(const [key,value]of Object.entries({'starting port':String(port),'max players':'16','map name':'TrainFacility','share to community':'false','server language':'English'}))if(values[key]!==value)throw Error('Canonical LAC publisher default differs: '+key);return {publisherDefaults:true,typedGameplayDocument:false};}
