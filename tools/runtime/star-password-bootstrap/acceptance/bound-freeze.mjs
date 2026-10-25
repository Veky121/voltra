// MIT. Offline only; preserves both earlier freezes and actual run receipts.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';
const here='tools/runtime/star-password-bootstrap/acceptance',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const readonly=fs.readFileSync('artifacts/star-password-bootstrap-diagnostic-source.json');
if(sha(readonly)!=='888def5f04a054d33c9706ce2a67d7bf9938745bea5cb68bce599c72a395794d')throw Error('Readonly freeze changed');
const original=fs.readFileSync('artifacts/star-password-bootstrap-acceptance-source.json');
if(sha(original)!=='bceb42f7119f5044f4e5e63fd863eacffedad6e36ebb9e6dd9178e90ad508b47')throw Error('Original freeze changed');
const trace=fs.readFileSync('artifacts/star-password-bootstrap-trace-source.json');
if(sha(trace)!=='ff7247d6733ddc63e9744e9694085052a8d8600320e5b82f379dbdc92318c6c8')throw Error('Prior trace freeze changed');
const classified=fs.readFileSync('artifacts/star-password-bootstrap-classified-source.json');
if(sha(classified)!=='bafd11e139b4e8c230b7c7e92c309dfd3746195eac3af5923daba8b72b5b64aa')throw Error('Prior classified freeze changed');
const prior=[...JSON.parse(original).files,...JSON.parse(readonly).files,...JSON.parse(trace).files,...JSON.parse(classified).files];
const helper='internal/panel/game_library/scripts/steam-native-next.py',helperArchive='.local/star-trace-source/shared/steam-native-next.py';
const location=p=>p===helper?helperArchive:p;
for(const row of prior)if(sha(fs.readFileSync(location(row.path)))!==row.sha256)throw Error('Earlier frozen dependency drift');
function run(exe,args){const r=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.status!==0||r.error)throw Error(r.stderr||r.stdout||'Offline command failed');return(r.stdout+r.stderr).trim();}
// Preserve legacy tests verbatim, but their token-only "supported" wording is
// superseded by the compiled exact marker regression below.
const binding='Legacy mock/token checks only; NOT API support proof.\n'+run('python',[here+'/test-binding-contract.py']),driver=run('python',[here+'/test-bound-driver.py']),sourceModel=run('python',[here+'/test-bound-source.py']);
const out='.local/star-bound-offline-tests';
const names=['unicode','admin_only','long_original','explicit_empty','bad_utf8','control','allowed_controls','truncated','trailing','oversized','no_operations','ambiguous','timeout','missing_method','native_exception','unlink_fail','no_api','no_request','readonly_good','readonly_lookup','readonly_validity','readonly_resolve','readonly_type','readonly_method_validity','trace_lookup','trace_validity','trace_resolve','trace_type','trace_method_validity','trace_invoke','readonly_none','readonly_ambiguous','readonly_missing','readonly_wrong_type','readonly_invalid_method','readonly_no_api','good','truthy_missing','second_invalid','second_resolve_error','invoke_error','component_invalidated'];
for(const name of names)fs.mkdirSync(path.join(out,name,'Scripts'),{recursive:true});
const lua='.local/star-password-bootstrap-tests/lua.exe';
const baseline=run(lua,[here+'/test-bound-packet.lua',here+'/bound-main.lua',out]);
const retained=path.join(out,'unlink_fail/request.bin'),expected=Buffer.concat([Buffer.from('VSPB1\n'),Buffer.from([6,0,0,0]),Buffer.from('SECRET'),Buffer.from([255,255,255,255])]);
if(!fs.readFileSync(retained).equals(expected))throw Error('Unlink fixture contract differs');fs.unlinkSync(retained);
const diagnostics=run(lua,[here+'/test-bound-diagnostics.lua',here+'/readonly-main.lua',here+'/bound-main.lua',out]);
for(const name of names)if(fs.existsSync(path.join(out,name,'request.bin')))throw Error('Synthetic secret residue');
const classifier=run(lua,[here+'/test-bound-classifier.lua',here+'/bound-main.lua']);
const boundContract=run(lua,[here+'/test-bound-contract.lua',here+'/bound-main.lua',out]);
const unique=['bound-main.lua','bound-once.py','bound-controller.mjs','test-bound-driver.py','test-bound-source.py','test-bound-packet.lua','test-bound-diagnostics.lua','test-bound-contract.lua','test-bound-classifier.lua','BOUND_PLAN.md','bound-freeze.mjs'].map(name=>here+'/'+name);
const deep=JSON.parse(fs.readFileSync('artifacts/star-binding-deep-source.json'));
for(const row of deep.files)if(sha(fs.readFileSync(row.archive))!==row.sha256)throw Error('Deep exact source drift');
unique.push('artifacts/star-binding-deep-source.json','.local/star-binding-deep/ue4ss-tree.json',...deep.files.map(row=>row.archive));
const paths=[...new Set([...prior.map(row=>row.path),...unique])];
const files=paths.map(p=>{const body=fs.readFileSync(location(p));return{path:p,...(p===helper?{archive:helperArchive}:{}),bytes:body.length,sha256:sha(body)}});
const report={phase:'bound_driver_staged_no_native_invocation',files,original_freeze_sha256:sha(original),readonly_freeze_sha256:sha(readonly),primary_source_commit:'8333063595fa3c49ad307f3b0f732accbb760d25',baseline_tests:baseline,diagnostic_tests:diagnostics,binding_tests:binding,driver_tests:driver,classifier_tests:classifier,bound_contract_tests:boundContract,source_model_tests:sourceModel,prior_classified_freeze_sha256:sha(classified),prior_trace_freeze_sha256:sha(trace),native_invoked:false,root_native_approval:false};
fs.writeFileSync('artifacts/star-password-bootstrap-bound-source.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({phase:report.phase,files:files.length,freeze_sha256:sha(fs.readFileSync('artifacts/star-password-bootstrap-bound-source.json')),baseline,diagnostics,binding,driver,classifier,boundContract,sourceModel}));
