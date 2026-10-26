import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {clearTemplateSteamSecrets, templateSteamDefault, templateSteamEnvironment, templateSteamRole, privateOriginalMaximum} from '../src/client/privateSteamTemplateModel.ts';
import {privateAuthorizationBody, privateGuardReply} from '../src/client/privateSteamModel.ts';
const pending={default_mode:'public',private_candidate:true,private_supported:false,private_reason:'Pending reviewed policy',controls:{},coverage:'pending'};
test('KF2 initial public choice and Banana existing private default are independent',()=>{
 assert.equal(templateSteamDefault(pending,false),false);
 assert.equal(templateSteamDefault({...pending,default_mode:'private',private_supported:true},true),true);
 assert.equal(templateSteamDefault(undefined,true),true);
 assert.equal(templateSteamDefault(undefined,false),false);
});
test('both original alias families are recognized without classifying game flags or tokens as passwords',()=>{
 for(const [name,role] of Object.entries({STEAM_USER:'username',STEAM_USERNAME:'username',STEAM_PASS:'password',STEAM_PASSWORD:'password',STEAM_AUTH:'guard',STEAM_GUARDCODE:'guard',SRCDS_BETAID:'branch',SRCDS_BETAPASS:'beta_password'})) assert.equal(templateSteamRole(name),role);
 for(const name of ['PASSWORD','EXTRA_FLAGS','STEAM_GSLT','SERVER_NAME'])assert.equal(templateSteamRole(name),'');
});
test('mode switches clear every Steam secret alias while retaining literal game controls and public branch',()=>{
 const input={STEAM_USERNAME:'user',STEAM_PASSWORD:' x ',STEAM_GUARDCODE:'123456',STEAM_USER:'anonymous',STEAM_PASS:'secret',STEAM_AUTH:'code',SRCDS_BETAPASS:'beta',SRCDS_BETAID:'preview',PASSWORD:'game password',EXTRA_FLAGS:'-log',MAX_PLAYER:'6'};
 const safe=clearTemplateSteamSecrets(input);
 assert.equal(input.STEAM_PASSWORD,' x ');
 for(const key of ['STEAM_USERNAME','STEAM_PASSWORD','STEAM_GUARDCODE','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'])assert.equal(safe[key],'');
 assert.equal(safe.STEAM_USER,'anonymous');assert.equal(safe.PASSWORD,input.PASSWORD);assert.equal(safe.SRCDS_BETAID,'preview');assert.equal(safe.EXTRA_FLAGS,'-log');
 assert.equal(templateSteamEnvironment(safe,true).STEAM_USER,'');
});
test('ordinary submission refuses credentials including whitespace and mixed account modes before serialization',()=>{
 for(const key of ['STEAM_USER','STEAM_USERNAME','STEAM_PASS','STEAM_PASSWORD','STEAM_AUTH','STEAM_GUARDCODE','SRCDS_BETAPASS']) for(const value of [' ',' anonymous ','literal +quit " ?']) {
  assert.throws(()=>templateSteamEnvironment({[key]:value},false),/Steam maintenance/);
 }
 assert.deepEqual(templateSteamEnvironment({STEAM_USER:'anonymous',STEAM_PASS:'',PASSWORD:'game'},false),{STEAM_USER:'anonymous',STEAM_PASS:'',PASSWORD:'game'});
});
test('secure authorization preserves original literal values and applies only declared original length limits',()=>{
 const controls={username:[{environment:'STEAM_USERNAME',label:'Steam User',rules:'required|string|max:64'}],password:[{environment:'STEAM_PASSWORD',label:'Steam Password',rules:'required|string|max:64'}]};
 const username='  user ? +quit  ',password='  secret " \\ ?\n  ';
 assert.deepEqual(privateAuthorizationBody(username,true,password,controls),{username,password,save_password:true});
 assert.throws(()=>privateAuthorizationBody('x'.repeat(65),true,password,controls),/original maximum/);
 assert.equal(privateAuthorizationBody('x'.repeat(100),false,'',{}).username.length,100);
});
test('original Guard max6 is challenge-scoped and never limits device confirmation or unrelated recipes',()=>{
 const now=1000,guard={challenge_id:'challenge',kind:'email_code',expires_at:new Date(2000).toISOString(),code_controls:[{environment:'STEAM_AUTH',label:'Steam Auth',rules:'nullable|string|max:6'}]};
 assert.equal(privateOriginalMaximum(guard.code_controls),6);
 assert.equal(privateGuardReply(guard,{code:' 12? '},now).code,' 12? ');
 assert.equal(privateGuardReply(guard,{code:String.fromCodePoint(0x1f600).repeat(6)},now).code,String.fromCodePoint(0x1f600).repeat(6));
 assert.throws(()=>privateGuardReply(guard,{code:'1234567'},now),/original maximum/);
 assert.equal(privateGuardReply({...guard,code_controls:undefined},{code:'1234567'},now).code,'1234567');
 assert.deepEqual(privateGuardReply({...guard,kind:'device_confirmation'},{accepted:false},now),{challenge_id:'challenge',kind:'device_confirmation',accepted:false});
});
test('actual shared form submits sanitized values, hides both credential alias families and retains generic game controls',()=>{
 const source=fs.readFileSync(new URL('../src/client/TemplateGames.tsx',import.meta.url),'utf8');
 assert.match(source,/templateSteamDefault\(options.steam_installation/);
 // FS25 adds its display name to the sanitized environment before submission.
 assert.match(source,/environment:\s*(?:safeEnvironment\b|fs25\s*\?\s*\{\s*\.\.\.safeEnvironment,\s*SERVER_NAME:\s*name\.trim\(\)\s*\}\s*:\s*safeEnvironment\b)/);
 assert.match(source,/steamRole && steamRole !== 'branch'/);
 // The shared validator owns the gate; component tests exercise both supported
 // policy and trusted-node requirements with the real validator.
 assert.match(source,/templateSetupProblems\(\{[^\n]*node:\s*selectedNode[^\n]*privateSupported:\s*options\.private_content_supported\s*===\s*true/);
 assert.match(source,/options.steam_installation\?\.private_reason/);
 assert.match(source,/options\.variables\.filter\(variable => variable\.user_viewable(?: && !\(fs25 && fs25Advanced\.includes\(variable\.env_variable\)\))?\)\.map\(renderVariable\)/);
 const maintenance=fs.readFileSync(new URL('../src/client/PrivateSteamMaintenance.tsx',import.meta.url),'utf8');
 assert.match(maintenance,/setBetaPassword\(''\); setCode\(''\)/);
 assert.match(maintenance,/privateAuthorizationBody\(username, savePassword, password, status.original_controls\)/);
});
test('known Holdfast private beta carriers and raw installer flags never enter ordinary submission or port preview',()=>{
 const descriptor={...pending,legacy_branch_field:'EXTRA_FLAGS'};
 for(const value of ['', ' ', '-beta public', '"-beta" \'pre\'view', '-beta name-betapassword'])assert.equal(templateSteamEnvironment({EXTRA_FLAGS:value},false,descriptor).EXTRA_FLAGS,value);
 for(const value of ['-beta preview -betapassword secret', "'-beta' 'public' '-betapassword' 'opaque literal'", '-beta public -betapass\'word\' secret', '-beta preview -unknown secret', "-beta 'unterminated"]) {
  assert.throws(()=>templateSteamEnvironment({EXTRA_FLAGS:value},false,descriptor),/Steam|branch/);
  assert.equal(clearTemplateSteamSecrets({EXTRA_FLAGS:value},descriptor).EXTRA_FLAGS,'');
 }
 assert.equal(templateSteamEnvironment({EXTRA_FLAGS:'-beta preview -betapassword nativeflag'},false).EXTRA_FLAGS,'-beta preview -betapassword nativeflag');
 assert.throws(()=>templateSteamEnvironment({INSTALL_FLAGS:' +login private'},false),/Raw Steam/);
 const source=fs.readFileSync(new URL('../src/client/TemplateGames.tsx',import.meta.url),'utf8');
 assert.match(source,/node, safeEnvironment, !steamEnvironmentError/);
});
