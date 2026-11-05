/** Narrow evidence bridge; no mutation, session opening or implicit PASS. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { receipt, docker } from './campaign-session.mjs';
export const retryBuild='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
const main='C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029';
const oldSnapshot=resolve(main,'validator-build-20261103-21/build-input-1793674979520'),newSnapshot=resolve(main,'validator-build-20261103-22/build-input-1793678490224');
const sha=x=>createHash('sha256').update(x).digest('hex');
async function pinned(pin,expected){if(!pin?.path||pin.sha256!==expected)throw Error('Exact reviewed Clusterio retry pin required');const raw=await readFile(pin.path);if(sha(raw)!==expected)throw Error('Clusterio retry artifact changed');return JSON.parse(raw);}
export async function verifyRetry22(ctx,contract,pairSHA){
 if(ctx.build!==retryBuild||receipt?.binary_sha256!==retryBuild||resolve(receipt.snapshot)!==newSnapshot||pairSHA!=='47455041190fe892880b5a04b41f9dc382077305254babd227771f7fa6572b99')throw Error('Exact unchanged-source21-to22 retry boundary required');
 const oldRaw=await readFile(resolve(oldSnapshot,'snapshot-manifest.json')),newRaw=await readFile(resolve(newSnapshot,'snapshot-manifest.json'));
 if(sha(oldRaw)!=='0c213b4bb59ea0b1ce6073a18b8896650a66812a6ba0725526cd39536b1b771e'||sha(newRaw)!=='1440ae7f76f256084fd50ebda562327557dd928da3eeeb27911687607d0ffd61')throw Error('Exact frozen manifest pins differ');
 const old=JSON.parse(oldRaw),next=JSON.parse(newRaw),a=new Map(old.inputs.map(x=>[x.path,x.sha256])),b=new Map(next.inputs.map(x=>[x.path,x.sha256]));
 const changed=[...new Set([...a.keys(),...b.keys()])].filter(p=>a.get(p)!==b.get(p)).sort(),expected=['internal/panel/game_settings_campaign_authority.go','internal/panel/game_settings_discovery.go','internal/panel/game_settings_l4d_readonly.go','internal/panel/game_settings_l4d_readonly_dispatch_test.go'].sort();
 if(JSON.stringify(changed)!==JSON.stringify(expected))throw Error('Frozen source delta exceeds exact four reviewed L4D Go files');
 for(const path of changed)if(sha(await readFile(resolve(newSnapshot,path)))!==b.get(path))throw Error('Frozen22 changed source bytes differ');
 const recipe='factorio/clusterio/egg-clusterio.json',file='internal/panel/game_library/overrides.json',oldCatalog=await readFile(resolve(oldSnapshot,file)),newCatalog=await readFile(resolve(newSnapshot,file));
 if(sha(oldCatalog)!==a.get(file)||sha(newCatalog)!==b.get(file))throw Error('Exact catalog bytes differ from frozen manifests');
 const p=JSON.parse(oldCatalog)[recipe],q=JSON.parse(newCatalog)[recipe];
 if(JSON.stringify(p)!==JSON.stringify(q)||sha(p.egg.scripts.installation.script)!=='fb0c94051cf087ecaea8a1636bb89ca9152e9c20dff9e924daa563fc88461ccc')throw Error('Clusterio exact profile/script/helper source changed');
 const failure=await pinned(contract?.failedEvidence,'38589672be86db0f8c66106e80d3cf6b27121da0249e884eeaa235a13250a5db'),diagnosis=await pinned(contract?.diagnosis,'488348278900e0e482d344208b80f845223085e162750e4f4f28461d2283cd1d'),process=await pinned(contract?.processEvidence,'adf408e62c1cb370ce624015c22502385aad9dd9c15cfcab0a8083105a8ec684');
 const failed=failure.checks?.filter(c=>c.name==='controller-reinstall-native-reload'&&c.status==='FAIL'&&c.error==='Clusterio state/config changed across reload');
 if(failure.status!=='FAIL'||failed?.length!==1||!failure.checks.some(c=>c.name==='controller-reinstall-retained-bytes'&&c.status==='PASS')||failure.fixture?.server?.uuid!==ctx.fixture.server.uuid||process.engines?.length!==1||!process.engines[0].direct||process.engines[0].publisherEntrySHA256!=='6490ed03036ac5a5d83567db2a8ece9fa4bf5b0b03288f2803ace7159dd5be41')throw Error('Exact prior failed reload/direct-engine evidence required');
 const stop=diagnosis.currentStoppedNative;if(stop.uuid!=='35675cb2-6031-40d7-8223-3932dd3c88c0'||stop.state.StartedAt!=='2026-11-03T04:18:50.941410505Z'||stop.state.FinishedAt!=='2026-11-03T04:18:54.383009906Z'||stop.state.ExitCode!==0||stop.state.Running||stop.state.OOMKilled)throw Error('Exact reviewed later controller stop receipt required');
 const [actual]=JSON.parse(await docker(['inspect',stop.uuid],ctx.signal));if(actual.Id!==stop.containerId||actual.Image!==stop.image||JSON.stringify(actual.State)!==JSON.stringify(stop.state))throw Error('Current native stop no longer matches readonly diagnosis');
 const observedAt=Number(/clusterio-native-process-(\d+)\.json$/.exec(contract.processEvidence.path)?.[1]);if(!Number.isFinite(observedAt)||observedAt<Date.parse(stop.state.StartedAt)||observedAt>Date.parse(stop.state.FinishedAt))throw Error('Native process observation outside exact stopped-container window');
 const text=(await docker(['logs','--since',stop.state.StartedAt,stop.containerId],ctx.signal)).replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');if(!text.includes('Started controller')||!text.includes('Caught interrupt, shutting down')||!text.includes('Saving data')||/grace expired|escalating owned process/i.test(text))throw Error('Actual controller native graceful stop log unproved');
 const proof={containerId:stop.containerId,startedAt:stop.state.StartedAt,engine:process.engines[0],engineNumericExit:0,engineExitProven:true,recoveredFromPinnedFailedReload:true,evidence:{failedSHA256:contract.failedEvidence.sha256,diagnosisSHA256:contract.diagnosis.sha256,processSHA256:contract.processEvidence.sha256},priorResultStill:'FAIL'};
 await ctx.artifact('clusterio-retention21-to22-reviewed-bridge.json',{changedSourceFiles:changed,oldSnapshot,newSnapshot,profileAndHelpersUnchanged:true,controllerStop:proof,priorResultStill:'FAIL'});return proof;
}
