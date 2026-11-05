/** Frozen22 Trackmania integration helpers. Imports perform no I/O. */
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {campaign as h,receipt} from './campaign-session.mjs';
export const recipe='trackmania/egg-trackmania.json';
export const trackmaniaIdentity=(id,current)=>id==='trackmania-canonical'&&current===build;
export const build='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const snapshot=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-22/build-input-1793678490224');
export const profileSHA256='249083c0bd201e36f08b8ec68ca75ba5bc29a25fd88bcc005d3c99d65c2da28d',scriptSHA256='0e7654ba5c031558bb48ccf45d763b2d88cf33600a94780092b7d76de8f6a6c9';
export const archiveSHA='5379519e729b882f67892b593c65bfe6ff11989e55f3ddd1ca6ab3029ca1df1a',archiveBytes=253509378,binarySHA='3b6107824feea402bd32c888e994dcd6df4a10afc8676a2647ac9560ccf0d779';
export const pins=Object.freeze({'.voltra/truck-trackmania-native.py':'fd9a6d10782e282a77ef55faacee18bb627ed3c8e1dc9f55ad2a3dfbf37584cf','.voltra/native-config.py':'8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2','.voltra/native-release.py':'31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193','.voltra/native-console.py':'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5','.voltra/steam_template.py':'7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897','.voltra/source-install.py':'a1f63dd97984ed20dba5b5af6fddfaff5efdd15f7666231b32728da0c5f54a13','.voltra/bundle-debian-python.py':'16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0'});
export const sha=x=>createHash('sha256').update(x).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyTrackmaniaFrozen(p){
 if(sha(JSON.stringify(sorted(p)))!==profileSHA256||sha(p.egg.scripts.installation.script)!==scriptSHA256)throw Error('Trackmania frozen22 profile/script differs');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],sha(m[3]+'\n')]));
 if(JSON.stringify(sorted(emitted))!==JSON.stringify(sorted(pins)))throw Error('Trackmania emitted helpers differ');return {profileSHA256,scriptSHA256,helpers:pins};
}
export async function verifyTrackmaniaArchive(path){const raw=await fs.readFile(path);if(raw.length!==archiveBytes||sha(raw)!==archiveSHA)throw Error('Trackmania immutable publisher archive differs');return {sha256:archiveSHA,bytes:archiveBytes,scope:'Actual cached bytes only; no installed/native claim'};}
export function verifyTrackmaniaHistorical(raw){if(sha(raw)!=='86925771271bdb738b732312d5032fb203c25d512056f1ffef452b9b9aa5078e')throw Error('Historical Trackmania receipt differs');const r=JSON.parse(raw);if(r.recipe!==recipe||r.cleanup?.volume_removed!==true||r.native_helper_installed_sha256===pins['.voltra/truck-trackmania-native.py'])throw Error('Historical Trackmania scope differs');return {reused:true,historical:true,currentNativePending:true,historicalSourceEquivalent:false,fixtureDeleted:true,scope:'Historical LAN RPC/name/cap32/Training01/exit0/operator retention only; changed helper requires fresh proof'};}
export async function installedSource(ctx,c){
 const f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt);verifyTrackmaniaFrozen(p);
 const s=(await h.api('/api/application/servers/'+f.server.id)).attributes;
 const canonical=ctx.game.id==='trackmania-canonical'&&f.template===sha(recipe).slice(0,16)&&f.intent?.template===f.template&&f.intent.scriptHash===scriptSHA256&&f.intent.build===build;
 if(ctx.build!==build||receipt.binary_sha256!==build||resolve(receipt.snapshot)!==snapshot||(!canonical&&ctx.game.recipe!==recipe)||f.recipe!==recipe||s.uuid!==f.server.uuid||s.name!=='validator-'+ctx.game.id||s.egg!==f.egg.id||Number(s.node)===202||s.container.startup_command!==p.egg.startup||p.egg.config.stop!=='^SIGTERM')throw Error('Exact isolated Trackmania frozen22 source required');
 for(const key of ['MASTERSERVER_LOGIN','MASTERSERVER_PASSWORD'])if(s.container.environment[key]!=='')throw Error('Explicit Trackmania LAN mode required');
 for(const [path,pin]of Object.entries(pins))if(sha(await c.read('/'+path))!==pin)throw Error('Installed Trackmania helper differs: '+path);
 return {actual:true,helpers:pins,currentNativePending:true,historicalSourceEquivalent:false,scope:'Current source only; fresh native proof pending'};
}
export async function canonicalExposure(ctx,c){
 await installedSource(ctx,c);const p=h.profileFromRuntime(recipe,receipt),fields=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/startup')).data.map(x=>x.attributes??x);
 for(const v of p.egg.variables){const hits=fields.filter(f=>f.env_variable===v.env_variable);if(hits.length!==1||(['MASTERSERVER_PASSWORD','SERVER_PASSWORD'].includes(v.env_variable)?!trackmaniaSecretUI(v,hits[0],v.default_value):String(hits[0].server_value)!==String(v.default_value))||hits[0].is_editable!==v.user_editable)throw Error('Trackmania canonical Startup default differs: '+v.env_variable);}
 const inventory=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings')).attributes;
 if(inventory.file!==''||!Array.isArray(inventory.fields)||inventory.fields.length||!Array.isArray(inventory.documents)||inventory.documents.length)throw Error('Unexpected Trackmania typed document authority');
 const files=(await c.api('GET','/api/client/servers/'+ctx.fixture.server.uuid+'/files/list?directory=%2F')).data;if(!Array.isArray(files))throw Error('Trackmania Files inventory missing');
 return {actual:true,startupControls:true,typedGameplayDocument:false,fileInventory:true,currentNativePending:true,historicalSourceEquivalent:false};
}

export function trackmaniaSecretUI(variable,field,actual){
 return ['MASTERSERVER_PASSWORD','SERVER_PASSWORD'].includes(variable.env_variable)&&actual===variable.default_value&&field?.secret===true&&field.secret_configured===(actual!=='')&&field.configured===(actual!=='')&&field.server_value===''&&field.default_value==='';
}
export function verifyTrackmaniaPrior(ctx,report,raw,pin,frozen){
 if(!trackmaniaIdentity(ctx.game.id,ctx.build)||resolve(pin.path)!==resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/trackmania-lan-native-acceptance.json')||pin.sha256!==sha(raw)||frozen?.profileSHA256!==profileSHA256||frozen?.scriptSHA256!==scriptSHA256||frozen?.nativeCurrentPending!==true||frozen?.historicalSourceEquivalent!==false)throw Error('Exact historical Trackmania gate/current pending acknowledgement required');
 verifyTrackmaniaFrozen(h.profileFromRuntime(recipe,receipt));return verifyTrackmaniaHistorical(raw);
}
