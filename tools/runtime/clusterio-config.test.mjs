import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {roleSettings,applySettings,privateInstanceDefaults,configureControllerDefaults} from '../../internal/panel/game_library/scripts/clusterio-start.mjs';
const token=payload=>'header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fixtureSignature';
const controller={SERVER_MODE:'controller',SERVER_PORT:'23560',CLUSTER_NAME:'001234 "Factory" $(literal)'};
const host={SERVER_MODE:'host',SERVER_PORT:'23561',SERVER_IP:'192.168.1.10',HOST_NAME:'Factory',CONTROLLER_URL:'http://192.168.1.10:23560',CONTROLLER_TOKEN:token({aud:'host',host:123}),VOLTRA_ALLOCATED_PORTS:'23561,23562,23561'};
test('new instances become private while retaining other native defaults',()=>{
 const before={visibility:{public:true,lan:true},max_players:0,require_user_verification:true};
 assert.deepEqual(privateInstanceDefaults(before),{...before,visibility:{public:false,lan:true}});assert.equal(before.visibility.public,true);assert.throws(()=>privateInstanceDefaults({}),/Unsupported/);
});
test('new-instance creation pins latest while retaining explicit versions and call context',()=>{
 class Manager{static DefaultFactorioSettings={visibility:{public:true,lan:true}};createInstance(config,flag){return {version:config.get('factorio.version'),flag,manager:this};}}
 configureControllerDefaults(Manager);const manager=new Manager();
 for(const version of ['latest','2.0.77','2.1.23']){let stored=version;const config={get:()=>stored,set:(_key,value)=>{stored=value}};const result=manager.createInstance(config,true);assert.equal(result.version,version==='latest'?'2.0.77':version);assert.equal(result.manager,manager);assert.equal(result.flag,true);}
});
test('controller renders a literal name and numeric allocated port',()=>assert.deepEqual(roleSettings(controller),{'controller.name':controller.CLUSTER_NAME,'controller.http_port':23560,'controller.bind_address':'0.0.0.0'}));
test('host derives its identity and deduplicated port pool',()=>{
 const s=roleSettings(host);assert.equal(s['host.id'],123);assert.equal(s['host.factorio_port_range'],'23561,23562');assert.equal(s['host.controller_token'],host.CONTROLLER_TOKEN);assert.equal(s['host.controller_url'],'http://192.168.1.10:23560/');
});
test('host rejects administrator tokens, malformed credentials and invalid host IDs',()=>{
 for(const t of ['bad',token({aud:'user',user:123}),token({aud:'host',host:'123'}),token({aud:'host',host:-1}),token({aud:'host',host:2147483648})])assert.throws(()=>roleSettings({...host,CONTROLLER_TOKEN:t}),/token/i);
});
test('controller URLs reject unsupported protocols and embedded credentials',()=>{
 for(const url of ['file:///etc/passwd','javascript:alert(1)','http://name:private@example.test','http://example.test/?token=private','https://example.test/#private'])assert.throws(()=>roleSettings({...host,CONTROLLER_URL:url}),/address/i);
});
test('host rejects invalid allocation lists and lists missing its primary port',()=>{
 for(const ports of ['23562','23561,0','23561,65536','23561,NaN','23561,,23562'])assert.throws(()=>roleSettings({...host,VOLTRA_ALLOCATED_PORTS:ports}),/allocated/i);
});
test('configuration merge preserves auth material and unrelated operator settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-clusterio-config-'));
 try {
  const file=path.join(dir,'config-controller.json'),before={'controller.auth_secret':'private fixture','controller.database_directory':'custom-data','plugin.option':{enabled:false}};
  fs.writeFileSync(file,JSON.stringify(before));applySettings(dir,controller);const after=JSON.parse(fs.readFileSync(file));for(const [k,v]of Object.entries(before))assert.deepEqual(after[k],v);assert.equal(after['controller.name'],controller.CLUSTER_NAME);
 }finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('unchanged managed settings preserve configuration bytes and formatting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-clusterio-config-'));
 try {const file=path.join(dir,'config-controller.json'),before=JSON.stringify({...roleSettings(controller),'operator':true},null,'\t')+'\n';fs.writeFileSync(file,before);applySettings(dir,controller);assert.equal(fs.readFileSync(file,'utf8'),before);}finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid configuration stays byte-identical and its content is absent from errors',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-clusterio-config-'));
 try {const file=path.join(dir,'config-controller.json'),before='{"privateFixtureSecret":';fs.writeFileSync(file,before);assert.throws(()=>applySettings(dir,controller),error=>!error.message.includes('privateFixtureSecret'));assert.equal(fs.readFileSync(file,'utf8'),before);}finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('host mode accepts blank Cluster Name because its native settings do not consume it',()=>{
 assert.deepEqual(roleSettings({...host,CLUSTER_NAME:''}),roleSettings({...host,CLUSTER_NAME:'Unused label'}));
});
test('controller requires nonblank name of at most 100 Unicode characters before any config write',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-clusterio-name-'));
 try {
  const file=path.join(dir,'config-controller.json'),before='{"controller.name":"Operator name","operator.keep":true}\n';fs.writeFileSync(file,before);const listing=fs.readdirSync(dir);
  for(const name of ['', '   ', undefined, '\u{1F600}'.repeat(101)]){
   assert.throws(()=>applySettings(dir,{...controller,CLUSTER_NAME:name}),/controller requires a Cluster Name/i);assert.equal(fs.readFileSync(file,'utf8'),before);assert.deepEqual(fs.readdirSync(dir),listing);
  }
  applySettings(dir,{...controller,CLUSTER_NAME:'\u{1F600}'.repeat(100)});assert.equal(JSON.parse(fs.readFileSync(file,'utf8'))['controller.name'],'\u{1F600}'.repeat(100));
 }finally {fs.rmSync(dir,{recursive:true,force:true});}
});
