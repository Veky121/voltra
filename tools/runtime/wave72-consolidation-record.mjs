import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {embeddedPython} from './embedded-python.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.join(root,'artifacts/game-parity-20261029');
const dir=path.join(base,'wave70-reviewed-consolidation');
const read=name=>fs.readFileSync(path.join(dir,name));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const packet=JSON.parse(read('integration-packet.json'));
const beforeBytes=read('canonical.before.json'), afterBytes=read('canonical.pending.json');
assert.equal(hash(beforeBytes),packet.canonical_before);
assert.equal(hash(afterBytes),packet.canonical_after);
const before=JSON.parse(beforeBytes),after=JSON.parse(afterBytes);
assert.deepEqual(Object.keys(before),Object.keys(after));
const changes=[];
for(const recipe of Object.keys(before)) {
  const a=structuredClone(before[recipe]),b=structuredClone(after[recipe]);
  const oldScript=a.egg.scripts.installation.script,newScript=b.egg.scripts.installation.script;
  a.egg.scripts.installation.script='';b.egg.scripts.installation.script='';
  assert.deepEqual(a,b,recipe+' nonscript metadata');
  if(oldScript===newScript)continue;
  const oldModules=new Map(embeddedPython(oldScript).map(m=>[m.file,m.source]));
  const newModules=new Map(embeddedPython(newScript).map(m=>[m.file,m.source]));
  assert.deepEqual([...oldModules.keys()],[...newModules.keys()]);
  const helpers=[];
  for(const [name,source] of oldModules)if(source!==newModules.get(name))helpers.push(name);
  changes.push({recipe,helpers});
}
assert.equal(changes.length,21);
assert.equal(changes.reduce((sum,r)=>sum+r.helpers.length,0),24);
const drift=[];
for(const [name,expected] of Object.entries(packet.protected_inputs)){
  const absolute=path.join(root,...name.split(/[\\/]/));
  if(!fs.existsSync(absolute)||hash(fs.readFileSync(absolute))!==expected)drift.push(name.replaceAll('\\','/'));
}
const known='artifacts/game-parity-20261029/wave71-gta-dangling-migration/report.json';
const unexpected=drift.filter(p=>p!==known);
const report={scope:'Independent audit of immutable saved wave70 catalog snapshots, not the concurrently changing current catalog',canonical_before:hash(beforeBytes),canonical_after:hash(afterBytes),profiles:236,changed_recipes:21,changed_helper_bodies:24,other_profiles_unchanged:215,nonscript_metadata_unchanged:236,changes,protected_paths_checked:Object.keys(packet.protected_inputs).length,protected_drift:drift,unexpected_protected_drift:unexpected,prior_owner_final_check:'Failed on concurrent root update to new wave71 dangling-migration receipt; retained as failure, not rewritten as earlier success.',root_accounting:'Root intentionally expanded that new receipt from 6 to 18 then 66 checks while consolidation ran. This was not an immutable wave68 or wave69 input.',boundary:'No rerun or native acceptance claimed. Current GTA follow-up changes require their own receipt and final frozen regression.'};
const out=path.join(base,'wave72-consolidation-record');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({changed_recipes:21,helper_bodies:24,protected_paths_checked:report.protected_paths_checked,drift,unexpected_protected_drift:unexpected}));
assert.equal(unexpected.length,0,'Unexpected protected input drift');
