/** Pure source/report pin utility. No session imports, network or runtime calls.
 * Root archives a real canonical PASS first, then invokes --pin ARCHIVE OUTPUT.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const build='248f83a9ae1acc2db8248993823d07e427ff26954e2549c89143c1470dacd0e7';
export const recipe='minecraft/java/glowstone/egg-glowstone.json';
export const ids=['glowstone-canonical','glowstone-clean-canonical'];
const main=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go');
const root=resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go');
export const hash=x=>createHash('sha256').update(x).digest('hex');
export function canonicalArchive(id){if(!ids.includes(id))throw Error('Unsupported Glowstone alias');return resolve(main,'artifacts/game-parity-20261029/validator-20261103-'+id,'canonical.json');}
export function validateCanonical(report){
 const f=report.fixture,r=f?.intent?.request;
 if(!ids.includes(report.game)||report.build!==build||report.status!=='PASS'||!Array.isArray(report.checks)||report.checks.some(c=>c.status!=='PASS')||f?.recipe!==recipe||f.name!=='validator-'+report.game||f.server?.name!==f.name||!/^[a-f0-9-]{36}$/.test(f.server?.uuid??'')||!Number.isSafeInteger(f.server.id)||!/^[a-f0-9-]{36}$/.test(f.egg?.uuid??'')||f.intent?.build!==build||r?.name!==f.name||r.memory!==2048||r.disk!==10240||r.automatic_ports!==true||!Number.isSafeInteger(r.node_id)||r.node_id<1||f.intent.scriptHash!=='efc8a0e99244fec8278a172e82ab5ebfe8e9389f9f54b674ea96b49d233830b6'||f.install?.rawExit!=='0'||!f.install.callback?.success||!f.install.removed||!f.install.logsFollowed||!f.install.memoryValid||f.ports?.length!==1||f.allocation?.is_default!==true||f.allocation.port!==f.ports[0])throw Error('Only exact successful candidate19 canonical installation may be adopted');
 for(const name of ['glowstone-installed-publisher-input','glowstone-canonical-config-exposure','glowstone-canonical-startup-metadata','preserved-offline'])if(report.checks.filter(c=>c.name===name&&c.status==='PASS').length!==1)throw Error('Canonical Glowstone check missing: '+name);
 const input=report.checks.find(c=>c.name==='glowstone-installed-publisher-input').evidence?.input;
 if(input?.jarSHA256!=='825b38efc340c1489ce91f31a50e3a632438dde92e5770f2d84486314d42cbbd'||input.bytes!==23977310||input.coreClassMajor!==52||input.nativeStarted!==false)throw Error('Canonical exact Java8 publisher JAR proof missing');
 return f;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [flag,archive,output,...extra]=process.argv.slice(2);if(flag!=='--pin'||!archive||!output||extra.length)throw Error('Usage: node glowstone-native-pin.mjs --pin ARCHIVED-canonical.json OUTPUT-manifest.json');
 const path=resolve(archive),raw=await readFile(path,'utf8'),report=JSON.parse(raw),f=validateCanonical(report);
 if(path!==canonicalArchive(report.game))throw Error('Root must archive the exact PASS at '+canonicalArchive(report.game));
 const template=JSON.parse(await readFile(resolve(root,'.local/validator-campaign/glowstone-native-template.json'),'utf8')),g=template.games[0];
 Object.assign(g,{id:report.game,canonicalPass:{path,sha256:hash(raw)},canonicalEggUUID:f.egg.uuid,ownerId:f.intent.ownerId,nodeId:f.intent.request.node_id});
 await writeFile(resolve(output),JSON.stringify(template,null,2)+'\n');
 console.log(JSON.stringify({manifest:resolve(output),canonicalPASS:hash(raw),fixture:f.server.uuid,game:report.game,scope:'Manifest pinned only; no native lifecycle executed'}));
}
