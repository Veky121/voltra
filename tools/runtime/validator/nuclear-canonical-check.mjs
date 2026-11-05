/** New-file canonical integration helpers. Importing performs no operations. */
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {hash} from './runner.mjs';
import {campaign as h,receipt} from './campaign-session.mjs';
import {registration,nuclearSourcePins,nuclearInstalledSource,nuclearEvidenceLimits} from './nuclear-checks.mjs';
export const nuclearCanonicalRecipe='nuclear_option/egg-nuclear-option.json';
export const nuclearCanonicalBuild='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const nuclearCanonicalSnapshot=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-22/build-input-1793678490224');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export function verifyNuclearFrozen(profile){
 if(hash(JSON.stringify(sorted(profile)))!=='6fd09f1adaac4cc7bbf574223c1ddeebcedd1123a0c6521d904906e8bba1f0f4'||hash(profile.egg.scripts.installation.script)!=='ca5afa3b7790e5138f8374bc522688e8b205305cec4be5e77d6149e48cf9bcfd')throw Error('Nuclear exact frozen22 profile changed');
 const emitted=Object.fromEntries([...profile.egg.scripts.installation.script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 if(JSON.stringify(sorted(emitted))!==JSON.stringify(sorted(nuclearSourcePins)))throw Error('Nuclear exact emitted helpers differ');
 return {profileSHA256:hash(JSON.stringify(sorted(profile))),scriptSHA256:hash(profile.egg.scripts.installation.script),helpers:emitted};
}
export function nuclearCanonicalRequest(profile,{nodeId,primary,query}){
 verifyNuclearFrozen(profile);
 if(!Number.isSafeInteger(nodeId)||nodeId<1||nodeId===202||![primary,query].every(a=>Number.isSafeInteger(a?.id)&&a.id>0&&Number(a.node_id)===nodeId&&!a.server_id&&Number.isInteger(a.port)&&a.port>=1025&&a.port<=65535)||primary.id===query.id||primary.port===query.port||primary.ip!==query.ip)throw Error('Reviewed two distinct same-IP available allocations required');
 const environment=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,String(v.default_value)]));
 // These are explicit supported user choices, not a default-value PASS claim.
 environment.QUERY_PORT=String(query.port);environment.SERVER_PASSWORD=registration.nuclear.environment.SERVER_PASSWORD;
 return {request_id:randomUUID(),name:'validator-nuclear-canonical',memory:2048,disk:12288,image:Object.values(profile.egg.docker_images)[0],automatic_ports:false,allocation_id:primary.id,allocation_additional:[query.id],environment};
}
export function verifyNuclearHistorical(raw){
 if(hash(raw)!=='71259320dc2dacaa2c35ea989c6f2dd6b47c839383d151f546f71945cdaae4b3')throw Error('Exact historical Nuclear receipt changed');
 const r=JSON.parse(raw);
 if(r.recipe!==nuclearCanonicalRecipe||r.release?.appid!==3930080||r.release.buildid!==24724541||r.runtime?.normalStopCount!==4||r.runtime.actualNormalStops.some(x=>x.rawExit!==0||x.oom)||r.runtime.finalQuery?.max_players!==12||!/(?:^|,)m=1(?:,|$)/.test(r.runtime.finalQuery.keywords??'')||r.preservation?.realAPIReinstall!==true||r.preservation.protectedRecordCount!==10)throw Error('Historical Nuclear protocol/settings/stop/retention evidence differs');
 return {historicalOnly:true,observedBuild:24724541,appid:3930080,cleanStops:4,nativeModdedKeyword:'m=1',nativeCurrentPending:true,missionProgressClaim:false,helperPassReused:false};
}
export async function verifyNuclearInstalled(ctx,c){
 if(ctx.build!==nuclearCanonicalBuild||ctx.game.id!=='nuclear-canonical'||ctx.fixture?.install?.rawExit!=='0'||!ctx.fixture.install.callback?.success||!ctx.fixture.install.logsFollowed||!ctx.fixture.install.memoryValid||!ctx.fixture.install.removed)throw Error('Fresh observed canonical Nuclear installation required');
 const local={...ctx,game:{...ctx.game,family:'nuclear',recipe:nuclearCanonicalRecipe,serverUUID:ctx.fixture.server.uuid}},source=await nuclearInstalledSource(local,c),publication=JSON.parse(await c.read('/.voltra/steam-template-release.json'));
 if(publication.appid!==3930080||publication.StateFlags!==4||publication.platform!=='linux'||!Number.isSafeInteger(publication.buildid))throw Error('Fresh completed Steam publication required; historical build is not current proof');
 return {source,publication,currentPublisherObservedFromFreshInstaller:true,historicalBuildIsNotPinned:true,nativeAcceptancePending:true};
}
export function verifyNuclearExposure(body){
 if(!body.revision)throw Error('Nuclear settings revision absent');
 for(const [key,type]of Object.entries({'/ServerName':'text','/Password':'text','/MaxPlayers':'number','/ModdedServer':'boolean'})){
  const row=body.fields?.filter(f=>f.key===key);if(row?.length!==1||row[0].type!==type||row[0].readonly||row[0].readOnly||row[0].read_only)throw Error('Nuclear existing typed scalar differs: '+key);
 }
 for(const field of body.fields??[])if(['/Port','/QueryPort','/MissionDirectory','/BanListPaths','/MissionRotation','/NoPlayerStopTime','/RotationType'].some(k=>field.key===k||field.key.startsWith(k+'/'))&&!(field.readonly||field.readOnly||field.read_only))throw Error('Nuclear allocation/mission controls must remain readonly');
 return {editable:['/ServerName','/Password','/MaxPlayers','/ModdedServer'],missionSettingInsertion:false,...nuclearEvidenceLimits};
}
export const nuclearCanonicalIntegration=Object.freeze({
 status:'source-only-not-registered',recipe:nuclearCanonicalRecipe,build:nuclearCanonicalBuild,
 creation:'Normal canonical client install with explicit allocation_id/allocation_additional. QUERY_PORT is the selected second allocation; explicit test password differs from archived default metadata. No private Steam credentials.',
 install:'Fresh anonymous Steam metadata-first installation, raw exit0/logs/callback/memory/removal proof. No verified game archive/cache; observe current build rather than pin historical24724541.',
 bootstrap:'Exact startup waiting-for-players marker, direct publisher process plus owned game/query UDP binds, current Steam/native module identities and A2S zero-player readback; native default AUTO_UPDATE1 needs publisher success before readiness.',
 native:'nuclear-checks.mjs requires explicit test password before initial start; prepareTestPassword is an owned stopped typed-secret edit for an already initialized config. Typed name/capacity/ModdedServer consumption uses native A2S/EDF; no player or mission-save claim.',
 integrationRemaining:'Root must wire canonical coordinator/manifest and fixture handoff; shared files intentionally untouched.',
});

export const nuclearIdentity=(id,build)=>id==='nuclear-canonical'&&build===nuclearCanonicalBuild;
export function nuclearAutomaticRequest(profile,nodeId){
 verifyNuclearFrozen(profile);if(!Number.isSafeInteger(nodeId)||nodeId<1||nodeId===202)throw Error('Reviewed isolated Nuclear node required');
 const environment=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,String(v.default_value)]));
 // Empty is the publisher profile's explicit auto_allocate role request. The
 // endpoint normalizes it to an owned additional allocation before validation.
 environment.QUERY_PORT='';environment.SERVER_PASSWORD=registration.nuclear.environment.SERVER_PASSWORD;
 return {request_id:randomUUID(),name:'validator-nuclear-canonical',memory:2048,disk:12288,image:Object.values(profile.egg.docker_images)[0],automatic_ports:true,node_id:nodeId,environment};
}
export function materializeNuclearDefaults(variables,request){
 const environment=Object.fromEntries(variables.map(v=>[v.env_variable,String(v.default_value)]));
 if(environment.QUERY_PORT!=='7777'||environment.SERVER_PASSWORD!=='ChangeMe'||!request.environment||JSON.stringify(Object.keys(environment).sort())!==JSON.stringify(Object.keys(request.environment).sort())||request.environment.QUERY_PORT!=='')throw Error('Exact Nuclear deferred-query/test-password choices required');
 environment.QUERY_PORT='';environment.SERVER_PASSWORD=registration.nuclear.environment.SERVER_PASSWORD;
 for(const [key,value]of Object.entries(environment))if(request.environment[key]!==value&&!(key==='SERVER_PASSWORD'&&request.environment[key]==='[REDACTED]'))throw Error('Unexpected Nuclear choice: '+key);
 return {...request,environment};
}
export function nuclearDeferredRules(variables,environment){
 if(environment.QUERY_PORT!=='')throw Error('Nuclear canonical query role must request declared automatic selection');
 return variables.map(v=>v.env_variable==='QUERY_PORT'?{...v,rules:'nullable|string'}:v);
}
export function nuclearResolvedEnvironment(ctx,environment){
 const f=ctx.fixture,primary=f.allocation?.port,additional=f.ports?.filter(p=>p!==primary);
 if(!Number.isInteger(primary)||additional?.length!==1||!Number.isInteger(additional[0])||additional[0]<1025||additional[0]>65535)throw Error('Nuclear two exact resolved allocations required');
 return {...environment,QUERY_PORT:String(additional[0])};
}
export function verifyNuclearPrior(ctx,report,raw,pin,frozen){
 if(!nuclearIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==ctx.build||resolve(receipt.snapshot)!==nuclearCanonicalSnapshot||resolve(pin.path)!==resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/nuclear-fresh-native-acceptance.json')||pin.sha256!==hash(raw)||frozen?.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false)throw Error('Exact Nuclear historical/current-pending boundary required');
 const proof=verifyNuclearFrozen(h.profileFromRuntime(nuclearCanonicalRecipe,receipt));if(proof.profileSHA256!==frozen.profileSHA256||proof.scriptSHA256!==frozen.scriptSHA256)throw Error('Reviewed current Nuclear profile differs');return verifyNuclearHistorical(raw);
}

export function nuclearSecretPresence(adminValue,field){return (adminValue==='[global integration]'||adminValue===registration.nuclear.environment.SERVER_PASSWORD)&&field?.secret===true&&field.secret_configured===true&&field.configured===true&&field.server_value===''&&field.default_value==='';}
