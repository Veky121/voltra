import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {compose,composeRules,install} from '../../internal/panel/game_library/scripts/soldat2-modifier.mjs';
const jju=createRequire(import.meta.url)('../../internal/panel/game_library/vendor/jju/index.js');
test('selected native rules retain every operator script and get one lifecycle hook',()=>{
 const text="/* custom */{Objects:{MyRules:{RulesSetup:{Name:'Operator'},GameScript:{Scripts:['Original','Plugin'], /* retain */ Custom:true}},Other:{health:2}},}";
 const result=composeRules(text),data=jju.parse(result);assert.deepEqual(data.Objects.MyRules.GameScript.Scripts,['Original','Plugin','VoltraPanelLifecycle']);assert(data.Objects.MyRules.GameScript.Custom);assert.equal(data.Objects.Other.health,2);assert(result.includes('/* retain */'));assert.equal(composeRules(result),result);
 assert.throws(()=>composeRules('{Objects:{Rules:{GameScript:{Scripts:"do not rewrite"}}}}'));
});
test('JSON5 composition preserves operator comments, lists, literal strings and unrelated components',()=>{
 const text="/* operator heading */{Objects:{Rules:{GameScript:{Scripts:['Existing'], '+Scripts':['Other'], /* keep */ custom:'operator'}, Other:{hex:0xFF,},},Player:{name:'literal // } string'},},Meta:{Author:'operator'},}\n";
 const result=compose(text),data=jju.parse(result);assert.deepEqual(data.Objects.Rules.GameScript.Scripts,['Existing']);assert.deepEqual(data.Objects.Rules.GameScript['+Scripts'],['Other','VoltraPanelLifecycle']);assert.equal(data.Objects.Rules.GameScript.custom,'operator');assert.equal(data.Objects.Rules.Other.hex,255);assert.equal(data.Meta.Author,'operator');assert(result.includes('/* operator heading */'));assert(result.includes('/* keep */'));assert(result.includes("name:'literal // } string'"));assert.equal(compose(result),result);
});
test('publisher default JSON5 remains parseable with one native lifecycle hook',{skip:!fs.existsSync('.local/soldat-games/extracted/soldat2-linuxserver-release/Modifiers/_default.json')},()=>{
 const fixture=fs.readFileSync('.local/soldat-games/extracted/soldat2-linuxserver-release/Modifiers/_default.json','utf8');const result=compose(fixture);assert(result.includes('/*GAME OBJECTS*/'));const data=jju.parse(result);assert.deepEqual(data.Objects.Rules.GameScript['+Scripts'],['VoltraPanelLifecycle']);assert.equal(compose(result),result);
});
test('malformed operator component fails without a guessed rewrite',()=>{
 for(const text of ['[]','{Objects:null}','{Objects:{Rules:[]}}','{Objects:{Rules:{GameScript:{"+Scripts":"operator"}}}}'])assert.throws(()=>compose(text));
});
test('installer keeps original file metadata and refuses operator script conflicts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-modifier-'));try{
  fs.mkdirSync(path.join(dir,'Modifiers'));const file=path.join(dir,'Modifiers/_default.json');fs.writeFileSync(file,'/* keep */{Objects:{Rules:{Existing:{value:1}}}}');fs.chmodSync(file,0o640);const beforeMode=fs.statSync(file).mode&0o777;
  install(dir);const before=fs.readFileSync(file,'utf8');install(dir);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(fs.statSync(file).mode&0o777,beforeMode);
  const script=path.join(dir,'Scripts/Custom/VoltraPanelLifecycle.cs');fs.writeFileSync(script,'operator modification');assert.throws(()=>install(dir),/conflict/);assert.equal(fs.readFileSync(script,'utf8'),'operator modification');assert.equal(fs.readFileSync(file,'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('symlinked operator modifier is rejected without touching target',{skip:process.platform==='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-modifier-'));try{fs.mkdirSync(path.join(dir,'Modifiers'));const outside=path.join(dir,'outside');fs.writeFileSync(outside,'{}');fs.symlinkSync(outside,path.join(dir,'Modifiers/_default.json'));assert.throws(()=>install(dir),/symbolic/);assert.equal(fs.readFileSync(outside,'utf8'),'{}');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
