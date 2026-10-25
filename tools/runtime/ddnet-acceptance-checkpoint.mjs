import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='ddracenetwork/egg-d-d-race-network.json';
const profile=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const prior=JSON.parse(fs.readFileSync('artifacts/ddrace-network-partial.json'));
const queue=JSON.parse(fs.readFileSync('.local/game-batch/queue.json'));
const normalize=s=>s.replaceAll('\r\n','\n').trimEnd();
const modules=[];
for(const m of profile.egg.scripts.installation.script.matchAll(/cat\s+>\s*([^\s]+\.py)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)/g)){
 const name=m[1].split('/').at(-1), source='internal/panel/game_library/scripts/'+name.replaceAll('_','-');
 modules.push({installed_path:m[1],canonical_source:source,sha256:crypto.createHash('sha256').update(normalize(m[3])).digest('hex'),matches_canonical:fs.existsSync(source)&&normalize(fs.readFileSync(source,'utf8'))===normalize(m[3])});
}
const report={recipe,observed_at:new Date().toISOString(),revision:profile.revision,verification:profile.verification,defaults:profile.defaults,helpers:modules,prior_policy_block:prior.policy_block,prior_cleanup:prior.cleanup,prior_leases:queue.claims.filter(c=>c.game===recipe),native_action_taken:false,new_lease_acquired:false,scope:'Local canonical and embedded helper comparison only. No publisher fetch, downloaded protocol search, fixture installation, native start or requeue. Prior automatic rejection remains unresolved.'};
fs.mkdirSync('.local/ddnet-acceptance',{recursive:true});
fs.writeFileSync('.local/ddnet-acceptance/blocked-checkpoint.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('artifacts/ddnet-acceptance-blocked-checkpoint.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(modules.some(m=>!m.matches_canonical))process.exitCode=1;
