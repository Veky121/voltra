import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyConfig,verifySnapshotConfig,verifyExposure,configPassword,testPassword,sqlPackage,snapshotProgram,sourcePins} from './onset-checks.mjs';
import {materializeOnsetDefaults,onsetSnapshot,verifyCanonicalPasswordBinding} from './onset-canonical-check.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const config={servername:'Publisher name',password:'',masterlist:false,port:28002,ipaddress:'0.0.0.0',maxplayers:20,packages:['default'],plugins:['mariadb']};
const raw=v=>JSON.stringify({...config,...v});
test('exact existing blank config is accepted; startup SQL password is separate',()=>{
 assert.equal(configPassword,'');assert.notEqual(testPassword,configPassword);
 assert.deepEqual(verifyConfig(raw(),28002),config);
 for(const password of [testPassword,'arbitrary',null,0])assert.throws(()=>verifyConfig(raw({password}),28002));
 const missing={...config};delete missing.password;assert.throws(()=>verifyConfig(JSON.stringify(missing),28002));
});
test('private allocation and config schema remain strict',()=>{
 for(const change of [{masterlist:true},{masterlist:'false'},{ipaddress:'127.0.0.1'},{port:28001},{port:'28002'},{servername:null},{packages:{}},{plugins:null}])assert.throws(()=>verifyConfig(raw(change),28002));
 assert.throws(()=>verifyConfig('[]',28002));
});
test('running and offline snapshot bind exact blank, private config and allocation',()=>{
 const state={config:{...config},passwordSHA256:hash('')};delete state.config.password;
 assert.equal(verifySnapshotConfig(state,28002),state);
 for(const passwordSHA256 of [hash(testPassword),hash('arbitrary'),undefined])assert.throws(()=>verifySnapshotConfig({...state,passwordSHA256},28002));
 for(const change of [{masterlist:true},{ipaddress:'127.0.0.1'},{port:28001},{plugins:null}])assert.throws(()=>verifySnapshotConfig({...state,config:{...state.config,...change}},28002));
 for(const running of [false,true]){const program=snapshotProgram(running);assert.ok(program.includes("config['password'].encode()"));assert.ok(!program.includes("config.get('password','')"));}
});
test('settings exposure refuses editable managed port and IP',()=>{
 const fields=[...Object.entries({servername:'text',masterlist:'boolean',password:'text'}).map(([key,type])=>({key,type})),...['port','ipaddress','maxplayers','packages','plugins'].map(key=>({key,readonly:true}))];
 assert.ok(verifyExposure({revision:'r1',fields}));
 for(const key of ['port','ipaddress'])assert.throws(()=>verifyExposure({revision:'r1',fields:fields.map(f=>f.key===key?{...f,readonly:false}:f)}));
 assert.throws(()=>verifyExposure({fields}));
});
test('explicit startup values override exact reviewed publisher defaults only',()=>{
 const variables=Object.entries({PUBLIC_SERVER:'true',SERVER_PASSWORD:'',AUTO_UPDATE:'1',SRCDS_APPID:'1204170',SERVER_NAME:'Onset server'}).map(([env_variable,default_value])=>({env_variable,default_value}));
 const environment=Object.fromEntries(variables.map(v=>[v.env_variable,v.default_value]));environment.PUBLIC_SERVER='false';environment.SERVER_PASSWORD=testPassword;
 assert.deepEqual(materializeOnsetDefaults(variables,{environment}).environment,environment);
 assert.equal(materializeOnsetDefaults(variables,{environment:{...environment,SERVER_PASSWORD:'[REDACTED]'}}).environment.SERVER_PASSWORD,testPassword);
 for(const change of [{PUBLIC_SERVER:'true'},{SERVER_PASSWORD:''},{AUTO_UPDATE:'0'},{SERVER_NAME:'unexpected'}])assert.throws(()=>materializeOnsetDefaults(variables,{environment:{...environment,...change}}));
 assert.throws(()=>materializeOnsetDefaults(variables.map(v=>v.env_variable==='SERVER_PASSWORD'?{...v,default_value:'changed'}:v),{environment}));
});
test('frozen seed precedence remains existing-key first, allocation always managed',async()=>{
 const overrides=JSON.parse(await readFile(onsetSnapshot+'/internal/panel/game_library/overrides.json','utf8'));
 const strings=[];function visit(x){if(typeof x==='string'&&x.includes('cat > .voltra/onset_native.py'))strings.push(x);else if(x&&typeof x==='object')Object.values(x).forEach(visit);}visit(overrides);
 assert.equal(strings.length,1);
 const script=strings[0];assert.ok(script.includes('values = {k:v for k,v in seeds.items() if k not in data}'));
 assert.ok(script.includes("'password': shared.text(env.get('SERVER_PASSWORD', ''), 128)"));
 assert.ok(script.includes("'masterlist': shared.boolean(env.get('PUBLIC_SERVER', 'true'))"));
 assert.ok(script.includes("{'ipaddress':'0.0.0.0', 'port':port}"));
 // Validate the source contract rather than reimplementing the Python planner in JS.
 assert.equal(sourcePins['.voltra/onset_native.py'],'eb9cdee075176cfefebd9a69be98f836a1b934d723416ff85b97dad4b6faf06e');
});
test('SQL plugin still uses env secret and exact marker/counter proof',()=>{
 const lua=sqlPackage({container:'validator-onset-focused',marker:123456});
 assert.ok(lua.includes('os.getenv("SERVER_PASSWORD")'));assert.ok(lua.includes('SELECT 123456,boots FROM acceptance WHERE id=1'));assert.ok(lua.includes('VOLTRA_SQL_PROOF marker='));
 assert.throws(()=>sqlPackage({container:'unowned',marker:123456}));
});

test('canonical SQL preparation requires exact before/running/after seed binding',()=>{
 const binding={source:'publisher-existing-blank',beforeSHA256:hash(''),expectedAfterSHA256:hash(''),runningSHA256:hash(''),afterSHA256:hash(''),startupPasswordConsumed:false,nativePasswordAuthenticationProven:false};
 assert.deepEqual(verifyCanonicalPasswordBinding(raw(),28002,binding),config);
 for(const key of ['beforeSHA256','expectedAfterSHA256','runningSHA256','afterSHA256'])assert.throws(()=>verifyCanonicalPasswordBinding(raw(),28002,{...binding,[key]:hash(testPassword)}));
 for(const key of ['startupPasswordConsumed','nativePasswordAuthenticationProven'])assert.throws(()=>verifyCanonicalPasswordBinding(raw(),28002,{...binding,[key]:true}));
 assert.throws(()=>verifyCanonicalPasswordBinding(raw({password:testPassword}),28002,binding));
 assert.throws(()=>verifyCanonicalPasswordBinding(raw(),28002,undefined));
});
