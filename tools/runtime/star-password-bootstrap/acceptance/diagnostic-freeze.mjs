// MIT. Separate offline diagnostic freeze. Never overwrite the first-run freeze.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const oldFreeze=fs.readFileSync(path.join(root,'artifacts/star-password-bootstrap-acceptance-source.json'));
const runtime=JSON.parse(fs.readFileSync(path.join(root,'.local/star-native-acceptance/receipt.json')));
if(sha(oldFreeze)!==runtime.boot_source_freeze_sha256)throw Error('First native source freeze changed');
const out=path.join(root,'.local/star-password-bootstrap-diagnostic-tests'),lua=path.join(root,'.local/star-password-bootstrap-tests/lua.exe');
const primary=JSON.parse(fs.readFileSync(path.join(root,'artifacts/star-password-bootstrap-candidate-source.json')));
if(primary.commit!=='8333063595fa3c49ad307f3b0f732accbb760d25')throw Error('Wrong exact source commit');
for(const row of primary.files)if(sha(fs.readFileSync(path.join(root,row.archive)))!==row.sha256)throw Error('Pinned primary source changed');
const original=fs.readFileSync(path.join(here,'../main.lua'));if(sha(original)!=='0f0fe319de3abefca7af8ba57a326a20308945d64aa1c756e1ec7e89a4872e4e')throw Error('Original bootstrap changed');
const baseline=['unicode','admin_only','long_original','explicit_empty','bad_utf8','control','allowed_controls','truncated','trailing','oversized','no_operations','ambiguous','timeout','missing_method','native_exception','unlink_fail','no_api','no_request'];
const diagnostic=['readonly_good','readonly_lookup','readonly_validity','readonly_resolve','readonly_type','readonly_method_validity','trace_lookup','trace_validity','trace_resolve','trace_type','trace_method_validity','trace_invoke','readonly_none','readonly_ambiguous','readonly_missing','readonly_wrong_type','readonly_invalid_method','readonly_no_api'];
for(const name of [...baseline,...diagnostic])fs.mkdirSync(path.join(out,name,'Scripts'),{recursive:true});
function run(args){const r=spawnSync(lua,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.status!==0||r.error)throw Error(r.stderr||r.stdout||String(r.error));return r.stdout.trim();}
const originalTests=run([path.join(here,'../test.lua'),path.join(here,'diagnostic-main.lua'),out.replaceAll('\\','/')]);
// The unlink-failure fixture must retain its own packet. Verify that failure
// contract, then clean only that known synthetic fixture before residue checks.
const unlinkFixture=path.join(out,'unlink_fail','request.bin');
const expectedUnlinkPacket=Buffer.concat([Buffer.from('VSPB1\n'),Buffer.from([6,0,0,0]),Buffer.from('SECRET'),Buffer.from([255,255,255,255])]);
if(!fs.readFileSync(unlinkFixture).equals(expectedUnlinkPacket))throw Error('Unlink failure fixture did not retain expected synthetic packet');
fs.unlinkSync(unlinkFixture);
const diagnosticTests=run([path.join(here,'test-diagnostics.lua'),path.join(here,'readonly-main.lua'),path.join(here,'diagnostic-main.lua'),out.replaceAll('\\','/')]);
function pythonTest(name){const r=spawnSync('python',[path.join(here,name)],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.status!==0||r.error)throw Error(r.stderr||r.stdout||'Offline Python test failed');return(r.stdout+r.stderr).trim();}
const bindingTests=pythonTest('test-binding-contract.py'),driverTests=pythonTest('test-readonly-driver.py');
for(const name of [...baseline,...diagnostic])if(fs.existsSync(path.join(out,name,'request.bin')))throw Error('Fixture secret packet remains');
const names=['diagnostic-main.lua','readonly-main.lua','test-diagnostics.lua','DIAGNOSTIC_PLAN.md','diagnostic-freeze.mjs','test-binding-contract.lua','test-binding-contract.py','readonly-once.py','readonly-controller.mjs','test-readonly-driver.py'];
const stage=path.join(root,'.local/star-password-bootstrap/diagnostics/source');fs.mkdirSync(stage,{recursive:true});
const files=names.map(name=>{const body=fs.readFileSync(path.join(here,name));fs.writeFileSync(path.join(stage,name),body);return{path:path.relative(root,path.join(here,name)).replaceAll('\\','/'),bytes:body.length,sha256:sha(body)}});
const result={phase:'source_only_diagnostics_no_native_retry',files,first_native_freeze_sha256:sha(oldFreeze),primary_source_commit:primary.commit,primary_source_hashes_verified:primary.files.length,
  stock_lua_executable_sha256:sha(fs.readFileSync(lua)),original_semantics_tests:originalTests,diagnostic_tests:diagnosticTests,engine_mocked:true,native_invoked:false,owned_runtime_changed:false,
  binding_contract_tests:bindingTests,readonly_driver_tests:driverTests,canonical_gates_changed:false,readonly_native_plan_approved:false};
fs.writeFileSync(path.join(root,'artifacts/star-password-bootstrap-diagnostic-source.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
