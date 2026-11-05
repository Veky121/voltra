/** PNX canonical setup evidence only; historical native receipts are not current-helper acceptance. */
import { resolve } from 'node:path';
import { hash } from './runner.mjs';
import { campaign as h, receipt } from './campaign-session.mjs';
export const PNX_BUILD='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const PNX_SNAPSHOT=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520');
export const pnxIdentity=(id,build)=>id==='pnx-canonical'&&build===PNX_BUILD;
const recipe='minecraft/bedrock/PowerNukkitX/egg-powernukkitx.json';
const oldPath=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/powernukkitx-native-acceptance.json');
const oldSHA='2e0a011eff84c3223d33e16e7fa2cb43d93163904a78190850c476cd11b0ca57';
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyPNXPrior(ctx,report,raw,pin,frozen){
 const p=h.profileFromRuntime(recipe,receipt);
 if(!pnxIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==PNX_BUILD||resolve(receipt.snapshot)!==PNX_SNAPSHOT
   ||resolve(pin.path)!==oldPath||pin.sha256!==oldSHA||hash(raw)!==oldSHA||report.recipe!==recipe||report.publisher_version!=='3.0.5'
   ||report.first_query?.protocol!==2193||report.reload_query?.max_players!==7||report.original_auto_reboot?.final_exit_code!==0)
   throw Error('Exact historical PNX evidence required; current native acceptance remains pending');
 if(hash(JSON.stringify(sorted(p)))!==frozen?.profileSHA256||hash(p.egg.scripts.installation.script)!==frozen?.scriptSHA256
   ||frozen.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false)throw Error('Current PNX profile and native-pending acknowledgement required');
 const version=p.egg.variables.find(v=>v.env_variable==='VERSION');
 if(version?.default_value!=='3.0.5'||version.rules!=='required|string|in:3.0.5,latest,dev')throw Error('PNX deterministic version selector missing');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 if(emitted['.voltra/bedrock_family.py']!=='8549b68357e0c47655a8d2d29084c35a0e2cd3d9b66bf51fe1968cef2a966d00'||emitted['.voltra/native_console.py']!=='e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5')throw Error('Reviewed PNX launcher/supervisor differs');
}
export function verifyPNXRelease(raw){
 const r=JSON.parse(raw),sha='bc3c54236256c8e3bf8573ecf090e3853785c7622891d7d28d780a398fc1de60';
 if(r.game!=='pnx'||r.version!=='3.0.5'||r.sha256!==sha||r.binary_sha256!==sha||r.files?.['powernukkitx.jar']!==sha||r.bytes!==86100503
   ||r.url!=='https://github.com/PowerNukkitX/PowerNukkitX/releases/download/3.0.5/powernukkitx.jar')throw Error('PNX exact installed release receipt differs; no mutable-latest substitution');
 return {version:r.version,sha256:sha,bytes:r.bytes,scope:'Installed release receipt only; actual JAR hash and native consumption require fresh lifecycle'};
}
export function verifyPNXExposure(body){
 const capacity=body.fields?.filter(f=>f.key==='/settings/maxPlayers');
 if(capacity?.length!==1||capacity[0].type!=='number'||capacity[0].readonly===true)throw Error('PNX existing publisher typed capacity missing');
 // Frozen game_settings_documents.go marks template-derived values managed;
 // literal publisher defaults remain editable scalar settings.
 for(const key of ['/settings/port','/settings/motd']){
  const found=body.fields.filter(f=>f.key===key);
  if(found.length!==1||found[0].readonly!==true)throw Error('PNX managed setting must remain readonly: '+key);
 }
 for(const [key,type]of [['/settings/ip','text'],['/network-settings/enableQuery','boolean']]){
  const found=body.fields.filter(f=>f.key===key);
  if(found.length!==1||found[0].type!==type||found[0].readonly!==false)throw Error('PNX literal publisher setting exposure differs: '+key);
 }
}
