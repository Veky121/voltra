// MIT. Offline audit/schema source freeze; no native invocation or canonical edit.
import fs from'node:fs';import crypto from'node:crypto';import{spawnSync}from'node:child_process';
const here='tools/runtime/star-password-bootstrap/acceptance',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bound=fs.readFileSync('artifacts/star-password-bootstrap-bound-source.json');
if(sha(bound)!=='d653b64b0c65cc3f0398b588c988e1419019daf42c1096f48ffcebf949ac9c4b')throw Error('Bound freeze changed');
for(const row of JSON.parse(bound).files)if(sha(fs.readFileSync(row.archive||row.path))!==row.sha256)throw Error('Earlier frozen source drift');
const tests=spawnSync('python',[here+'/test-native-password-audit-v2.py'],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});
if(tests.status!==0||tests.error)throw Error(tests.stderr||'Audit tests failed');
const names=['native-password-audit-v2.py','password-prerequisite-candidate.py','test-native-password-audit-v2.py','inspect-crash-metadata.py','native-audit-v2-candidate.patch','ocean-password-prerequisite-candidate.patch','AUDIT_V2_PLAN.md','audit-v2-freeze.mjs'].map(name=>here+'/'+name);
names.push('../pterodactyl-vite/upstream/game-eggs/starrupture/egg-star-rupture-wine.json','.local/star-bound-acceptance/native-files-shape.json','.local/star-bound-acceptance/native-audit-v2-existing.json','.local/star-bound-acceptance/crash-metadata.json');
const files=names.map(path=>{const body=fs.readFileSync(path);return{path,bytes:body.length,sha256:sha(body)}});
const result={phase:'audit_schema_source_only_no_native_or_canonical_change',files,bound_freeze_sha256:sha(bound),tests:tests.stderr.trim(),legacy_lowercase_evidence:'published_reference_egg_installer_jq_password_field',native_uppercase_evidence:'actual_bound_native_files',existing_files_plaintext_reference_available:false,crash_cause_established:false,native_invoked:false,canonical_changed:false};
fs.writeFileSync('artifacts/star-password-audit-v2-source.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({phase:result.phase,freeze_sha256:sha(fs.readFileSync('artifacts/star-password-audit-v2-source.json')),files:files.length,tests:result.tests}));
