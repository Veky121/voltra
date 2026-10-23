import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const profiles=JSON.parse(fs.readFileSync('.local/virtual-worlds/profiles.json'));
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const sourceFiles=['virtual-worlds-install.py','virtual-worlds-runtime.py','virtual-worlds-releases.json','steam-template.py','native-console.py'];
const sources=Object.fromEntries(sourceFiles.map(name=>[name,fs.readFileSync('internal/panel/game_library/scripts/'+name)]));
const checks=[];
for(const[path,profile]of Object.entries(profiles)){
 const original=catalog.entries.find(e=>e.path===path);assert(original);
 assert.equal(profile.upstream_sha256,original.sha256);assert.equal(profile.verification,'not_verified');
 assert.equal(profile.egg.variables.length,original.egg.variables.length);
 for(let i=0;i<original.egg.variables.length;i++){
  const before=original.egg.variables[i],after=profile.egg.variables[i];
  for(const key of ['env_variable','default_value','user_viewable','user_editable','rules','field_type']){
   const nwn=path.startsWith('neverwinter_nights_ee/');
   const delta=nwn&&key==='default_value'&&before.env_variable==='MAX_LEVEL'?'40':
    nwn&&key==='rules'&&['MIN_LEVEL','MAX_LEVEL'].includes(before.env_variable)?'required|integer|min:1|max:40':undefined;
   assert.deepEqual(after[key],delta??before[key],path+' '+before.env_variable+' '+key);
  }
 }
 for(const[name,bytes]of Object.entries(sources))assert(profile.egg.scripts.installation.script.includes(bytes.toString('utf8')),path+' stale embedded '+name);
 assert.match(profile.egg.startup,/^exec python3 \.voltra\/virtual_worlds_runtime\.py (neos|resonite|nwn)$/);
 assert.equal(profile.egg.config.files,'{}');assert.equal(profile.required_ports,1);
 assert(Object.values(profile.egg.docker_images).every(v=>/@sha256:[a-f0-9]{64}$/.test(v)));
 checks.push({path,variables_preserved:original.egg.variables.length,defaults_and_rules_preserved:!path.startsWith('neverwinter_nights_ee/'),explicit_native_delta:path.startsWith('neverwinter_nights_ee/')?'MAX_LEVEL default100 to40; MIN/MAX numeric rules bounded to publisher-supported1..40':null,embedded_helpers_current:true,native_verified:false});
}
const report={checked_at:new Date().toISOString(),scope:'Source/configuration fixtures only. Native acceptance, where available, is a separate report.',profiles:checks,python_fixture_tests:31,
 helpers:Object.fromEntries(Object.entries(sources).map(([name,bytes])=>[name,{sha256:sha(bytes),bytes:bytes.length}])),
 limitations:[
  'Neos and Resonite entitled Steam branch install and AUTO_UPDATE remain unavailable because private credential/beta-code transport is unverified. Install script prepares runtime helper files only, then fails before network or payload writes.',
  'Operator-staged legal payload runtime support is source-tested only, not a proof of entitlement, plugin compatibility, native lifecycle or peer transport.',
  'NWN native module loading, saved-slot loading, interactive console, password settings and clean shutdown still need real acceptance.',
  'NWN dedicated archives contain no playable campaign module. Operators must supply their own licensed module or existing save.',
  'NWN existing unmanaged or modified program-file collisions fail explicitly; user data and unknown files are never migrated or overwritten.',
  'ARM images may exist upstream, but these adapters are advertised only for Linux amd64 until runtime compatibility is verified.'
 ]};
fs.writeFileSync('artifacts/virtual-worlds-source-acceptance.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({profiles:checks.length,original_variables:checks.reduce((n,c)=>n+c.variables_preserved,0),tests:31,native_verified:false}));
