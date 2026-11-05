import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
const root='C:/Users/Veky/.t3/projects/pteroclone/ptero-go';
const build='248f83a9ae1acc2db8248993823d07e427ff26954e2549c89143c1470dacd0e7';
const snapshot=resolve(root,'artifacts/game-parity-20261029/validator-build-20261103-19/build-input-1793672787914');
const recipe='minecraft/java/glowstone/egg-glowstone.json',file='/config/glowstone.yml';
const jar='825b38efc340c1489ce91f31a50e3a632438dde92e5770f2d84486314d42cbbd';
const reviewPath=resolve(root,'artifacts/java-wave27-root-review.json');
const reviewSHA='865a0ca792eee066e0f583a1de6382f973dd8e97722e7f97769108ade78a4008';
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const attrs=value=>value?.attributes??value;
export async function verifyGlowstoneReview(ctx,gate){
 if(!['glowstone-canonical','glowstone-clean-canonical'].includes(ctx.game.id)||ctx.build!==build||receipt?.binary_sha256!==build||resolve(receipt.snapshot)!==snapshot||gate?.id!=='mainvalidator-20261103-glowstone-canonical'||!gate.path||!/^[a-f0-9]{64}$/.test(gate.sha256??''))throw Error('Reviewed candidate19 Glowstone-only canonical gate required');
 const raw=await readFile(resolve(gate.path),'utf8');if(hash(raw)!==gate.sha256)throw Error('Glowstone source gate changed');const rows=JSON.parse(raw).games?.filter(row=>row.game==='glowstone');if(rows?.length!==1)throw Error('Exact Glowstone gate row required');const row=rows[0],p=h.profileFromRuntime(recipe,receipt);
 if(row.historical?.path!==reviewPath||row.historical.sha256!==reviewSHA||row.frozen?.profileSHA256!==hash(JSON.stringify(sorted(p)))||row.frozen?.scriptSHA256!==hash(p.egg.scripts.installation.script))throw Error('Historical review or current frozen Glowstone profile differs');
 const bytes=await readFile(reviewPath,'utf8');if(hash(bytes)!==reviewSHA)throw Error('Historical Glowstone root review changed');const reviewed=JSON.parse(bytes).reviewed?.filter(r=>r.recipe===recipe);if(reviewed?.length!==1||reviewed[0].protected_files!==28||!reviewed[0].scope.includes('no final-source clean-volume claim'))throw Error('Historical bounded clean-volume gap changed');
 if(p.egg.voltra?.java_config?.default_major!==8||p.egg.variables.find(v=>v.env_variable==='VERSION')?.default_value!=='latest'||p.egg.variables.find(v=>v.env_variable==='SERVER_JARFILE')?.default_value!=='glowstone.jar')throw Error('Glowstone canonical defaults/Java8 changed');
 await ctx.artifact('glowstone-historical-source-review.json',{historical:row.historical,reused:true,boundary:reviewed[0].scope,currentNativeAcceptance:false,cleanVolumeAcceptance:'Pending fresh canonical install and separate fresh native hook; historical report has no new PASS status'});
}
export async function runGlowstoneCanonical(ctx,api){
 const f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt),route='/api/client/servers/'+f.server.uuid;
 await ctx.check('glowstone-installed-publisher-input',async()=>{
  if(f.recipe!==recipe||f.name!=='validator-'+ctx.game.id||f.server.name!==f.name||f.install.rawExit!=='0'||!f.install.callback?.success||!f.install.removed)throw Error('Exact installed canonical Glowstone fixture required');
  // Wings server/install.go:250 converts CRLF to LF before executing the script.
  // Extract exact emitted bytes AFTER that source-proven conversion only.
  const helpers={};for(const m of p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\.voltra\/[\w.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){helpers[m[1]]=hash(m[3]+'\n');const actual=await api(ctx,route+'/files/contents?file='+encodeURIComponent('/'+m[1]),'GET',undefined,true);if(hash(actual)!==helpers[m[1]])throw Error('Installed canonical Glowstone helper changed: '+m[1]);}
  const image=ctx.game.offlineHelperImage;if(image!=='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8')throw Error('Reviewed immutable read-only publication observer required');
  const source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid,helper='validator-glowstone-canonical-input-'+randomUUID();
  await ctx.artifact('glowstone-canonical-observer.json',{helper,source,image,readOnly:true,user:'0:0',capability:'DAC_READ_SEARCH'});
  const script=String.raw`import pathlib,hashlib,json,zipfile,io
r=pathlib.Path('/source');p=r/'glowstone.jar'
for q in [p,*p.parents]:
 if q==r.parent:break
 if q.is_symlink():raise ValueError('Symlink publisher input')
if p.stat().st_size!=23977310:raise ValueError('Publisher JAR size differs')
b=p.read_bytes();sha=hashlib.sha256(b).hexdigest()
if sha!='825b38efc340c1489ce91f31a50e3a632438dde92e5770f2d84486314d42cbbd':raise ValueError('Publisher JAR digest differs')
with zipfile.ZipFile(io.BytesIO(b))as z:
 manifest=z.read('META-INF/MANIFEST.MF').decode();major=int.from_bytes(z.read('net/glowstone/GlowServer.class')[6:8],'big')
 if major>52:raise ValueError('Not reviewed Java8 core')
print(json.dumps(dict(jarSHA256=sha,bytes=len(b),coreClassMajor=major,nativeStarted=False)))`;
  const input=JSON.parse(await docker(['run','--rm','--pull','never','--name',helper,'--user','0:0','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,src='+source+',dst=/source,readonly','--entrypoint','python3',image,'-B','-c',script],ctx.signal,30000));
  if(input.jarSHA256!==jar)throw Error('Exact canonical publisher JAR unproved');return{helpers,input,scope:'Canonical installer/JAR/config source only; no current native acceptance'};
 });
 await ctx.check('glowstone-canonical-config-exposure',async()=>{
  const before=await api(ctx,route+'/files/contents?file='+encodeURIComponent(file),'GET',undefined,true),response=await api(ctx,route+'/game-settings?file='+encodeURIComponent(file)),body=attrs(response);
  await ctx.artifact('glowstone-config-before.log',before);await ctx.artifact('glowstone-game-settings.json',response);
  const capacity=body.fields?.filter(field=>field.key==='/server/max-players');if(capacity?.length!==1||capacity[0].type!=='number'||capacity[0].readonly!==false)throw Error('Real native Glowstone editable capacity missing');
  const port=body.fields.filter(field=>field.key==='/server/port');if(port.length!==1||port[0].readonly!==true)throw Error('Allocation-controlled Glowstone port must be readonly');
  if(before!==await api(ctx,route+'/files/contents?file='+encodeURIComponent(file),'GET',undefined,true))throw Error('Canonical exposure changed native config');
  return{file,sha256:hash(before),fields:body.fields,nativeSettingsConsumption:false,scope:'Existing publisher YAML only; no server.properties or invented config'};
 });
 await ctx.check('glowstone-canonical-startup-metadata',async()=>{
  const response=await api(ctx,route+'/startup'),rows=response.data.map(attrs);await ctx.artifact('glowstone-startup.json',response);
  for(const expected of p.egg.variables.filter(v=>v.user_viewable)){const matches=rows.filter(v=>v.env_variable===expected.env_variable);if(matches.length!==1||matches[0].name!==expected.name||(matches[0].description??'')!==(expected.description??'')||matches[0].rules!==expected.rules||matches[0].default_value!==expected.default_value||Boolean(matches[0].is_editable)!==Boolean(expected.user_editable))throw Error('Exact Glowstone recipe metadata differs');}
  return{recipe,variables:rows,currentNativeAcceptance:false,followup:'NEW glowstone-checks.mjs on this exact canonical fixture, explicit EULA authorization and only real typed test controls'};
 });
}
