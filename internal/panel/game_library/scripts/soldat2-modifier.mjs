// MIT. Compose our lifecycle script through native JSON5 modifier semantics.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const modulePath=fs.existsSync(path.join(here,'vendor/jju/index.js'))?path.join(here,'vendor/jju/index.js'):path.join(here,'../vendor/jju/index.js');
const jju=createRequire(import.meta.url)(modulePath);
export function compose(text){
 const data=jju.parse(text,{mode:'json5'});
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Native modifier must be an object');
 if(data.Objects===undefined)data.Objects={};if(!data.Objects||typeof data.Objects!=='object'||Array.isArray(data.Objects))throw Error('Native Objects must be an object');
 if(data.Objects.Rules===undefined)data.Objects.Rules={};const rules=data.Objects.Rules;if(!rules||typeof rules!=='object'||Array.isArray(rules))throw Error('Native Rules must be an object');
 if(rules.GameScript===undefined)rules.GameScript={};const script=rules.GameScript;if(!script||typeof script!=='object'||Array.isArray(script))throw Error('Native GameScript must be an object');
 const field='+Scripts';if(script[field]!==undefined&&!Array.isArray(script[field]))throw Error('Native modifier +Scripts must be an array');
 const list=script[field]??=[];if(!list.every(x=>typeof x==='string'))throw Error('Native script names must be strings');
 if(!list.includes('VoltraPanelLifecycle'))list.push('VoltraPanelLifecycle');
 const updated=jju.update(text,data,{mode:'json5'});jju.parse(updated,{mode:'json5'});return updated;
}
export function composeRules(text){
 const data=jju.parse(text,{mode:'json5'});
 if(!data||typeof data!=='object'||!data.Objects||typeof data.Objects!=='object'||Array.isArray(data.Objects))throw Error('Native rules Objects must be an object');
 for(const object of Object.values(data.Objects)){
  if(!object||typeof object!=='object'||Array.isArray(object))throw Error('Native rule object must be an object');
  if(!object.RulesSetup&&!object.GameScript)continue;
  if(object.GameScript===undefined)object.GameScript={};const script=object.GameScript;
  if(!script||typeof script!=='object'||Array.isArray(script))throw Error('Native GameScript must be an object');
  if(script.Scripts===undefined)script.Scripts=[];
  if(!Array.isArray(script.Scripts)||!script.Scripts.every(x=>typeof x==='string'))throw Error('Native Scripts must be an array of names');
  if(!script.Scripts.includes('VoltraPanelLifecycle'))script.Scripts.push('VoltraPanelLifecycle');
 }
 return jju.update(text,data,{mode:'json5'});
}
function safe(root,relative){const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw Error('Lifecycle path escapes volume');for(let p=target;p!==root;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Lifecycle path must not use symbolic links');}return target;}
function write(target,content){fs.mkdirSync(path.dirname(target),{recursive:true});const old=fs.existsSync(target)?fs.statSync(target):null;if(old&&fs.readFileSync(target,'utf8')===content)return;const temp=target+'.voltra-'+crypto.randomUUID();try{fs.writeFileSync(temp,content,{flag:'wx',mode:old?old.mode&0o777:0o600});if(old)fs.chownSync(temp,old.uid,old.gid);fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export function install(root){
 root=fs.realpathSync(root);const modifier=safe(root,'Modifiers/_default.json'),script=safe(root,'Scripts/Custom/VoltraPanelLifecycle.cs'),receipt=safe(root,'.voltra/soldat2/lifecycle-managed.json');
 const original=fs.readFileSync(modifier,'utf8'),updated=compose(original),source=fs.readFileSync(path.join(here,'soldat2-lifecycle.cs'),'utf8');
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');const old=fs.existsSync(receipt)?JSON.parse(fs.readFileSync(receipt,'utf8')):{};
 if(fs.existsSync(script)){const current=hash(fs.readFileSync(script));if(current!==hash(source)&&current!==old.script_sha256)throw Error('Operator-owned lifecycle script conflict; no files changed');}
 // Native selected Rules assign Scripts after _default. Compose that later
 // assignment as well, retaining every operator script and JSON5 comment.
 const changes=[];
 function rules(directory){if(!fs.existsSync(directory))return;for(const item of fs.readdirSync(directory,{withFileTypes:true})){const target=safe(root,path.relative(root,path.join(directory,item.name)));if(item.isDirectory())rules(target);else if(item.isFile()&&item.name.endsWith('.json')){const before=fs.readFileSync(target,'utf8'),after=composeRules(before);if(after!==before)changes.push({target,before,after});}}}
 rules(safe(root,'Rules'));
 if(updated!==original){const backup=safe(root,'.voltra/soldat2/modifier-backups/'+hash(original)+'.json5');if(!fs.existsSync(backup))write(backup,original);}
 for(const change of changes){const backup=safe(root,'.voltra/soldat2/modifier-backups/'+hash(change.before)+'.json5');if(!fs.existsSync(backup))write(backup,change.before);write(change.target,change.after);}
 write(script,source);write(modifier,updated);write(receipt,JSON.stringify({schema_version:1,script_sha256:hash(source),modifier:'Modifiers/_default.json',native_hook:'Objects.Rules.GameScript.+Scripts'},null,2)+'\n');
 console.log('Native Soldat2 lifecycle composed; operator JSON5 and script lists preserved.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))install(process.argv[2]||process.cwd());
