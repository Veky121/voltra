import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {roleSettings,applySettings} from './clusterio-start.mjs';

const role=process.env.SERVER_MODE;
roleSettings(process.env);
if(role==='controller'&&!process.env.ADMIN_STRING)throw Error('Choose the initial administrator name.');
const plugins=(process.env.PLUGINS||'').trim().split(/\s+/).filter(Boolean);
if(plugins.length>32||plugins.some(p=>!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9][0-9A-Za-z.+-]*)?$/.test(p)))throw Error('Plugins must be npm package names, optionally with exact versions, separated by spaces.');
const core=['controller','host','ctl'].map(n=>`@clusterio/${n}@2.0.2`);
function execute(binary,args,{privateOutput=false}={}){
  const result=spawnSync(binary,args,{encoding:'utf8',stdio:privateOutput?'pipe':'inherit',maxBuffer:16*1024*1024});
  if(result.status!==0)throw Error('Clusterio setup command failed. Check the preceding installation output.');
  return result.stdout||'';
}
let packageInfo={};
if(fs.existsSync('package.json')){
  try {packageInfo=JSON.parse(fs.readFileSync('package.json','utf8'));} catch {throw Error('Repair package.json before reinstalling Clusterio.');}
}
const manifest=JSON.stringify(plugins);
const locked=fs.existsSync('package-lock.json')&&fs.existsSync('.voltra/clusterio-plugin-selection')&&fs.readFileSync('.voltra/clusterio-plugin-selection','utf8')===manifest&&core.every(p=>{const at=p.lastIndexOf('@');return packageInfo.dependencies?.[p.slice(0,at)]===p.slice(at+1);});
execute('npm',locked?['ci','--no-audit','--no-fund']:['install','--save-exact','--no-audit','--no-fund',...core,...plugins]);
const cli=`node_modules/@clusterio/${role}/dist/node/${role}.js`;
const config=`config-${role}.json`;
if(!fs.existsSync(config)){
  execute(process.execPath,[cli,'config','create'],{privateOutput:true});
  if(role==='controller')fs.writeFileSync('.voltra/clusterio-bootstrap-pending',process.env.ADMIN_STRING,{mode:0o600,flag:'wx'});
}
applySettings('.',process.env);
// Never recreate operator accounts or print generated access tokens to logs.
if(role==='controller'&&fs.existsSync('.voltra/clusterio-bootstrap-pending')&&!fs.existsSync('.voltra/clusterio-controller-initialized')){
  const lib=await import(pathToFileURL(path.resolve('node_modules/@clusterio/lib/dist/node/index.js')));
  const data=JSON.parse(fs.readFileSync(config,'utf8'));
  const packs=new lib.SubscribableDatastore(...await new lib.JsonIdDatastoreProvider(path.join(data['controller.database_directory'],'mod-packs.json'),lib.ModPack.fromJSON.bind(lib.ModPack)).bootstrap());
  if(![...packs.values()].length){packs.setMany(lib.ModPack.defaultModPacks);await packs.save();}
  if(data['controller.default_mod_pack_id']===null){
    const base=[...packs.values()].find(p=>p.name==='Base Game 2.0'&&p.factorioVersion==='2.0');
    if(!base)throw Error('The reviewed base-game mod pack is unavailable.');
    execute(process.execPath,[cli,'config','set','controller.default_mod_pack_id',String(base.id)],{privateOutput:true});
  }
  const administrator=fs.readFileSync('.voltra/clusterio-bootstrap-pending','utf8');
  execute(process.execPath,[cli,'bootstrap','create-admin',administrator],{privateOutput:true});
  const output=execute(process.execPath,[cli,'bootstrap','generate-user-token',administrator],{privateOutput:true});
  const token=output.split(/\r?\n/).map(l=>l.trim()).find(l=>/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(l));
  if(!token)throw Error('Administrator token creation failed. Existing data was retained.');
  if(!fs.existsSync('.voltra/admin-token.txt'))fs.writeFileSync('.voltra/admin-token.txt',token+'\n',{mode:0o600,flag:'wx'});
  fs.writeFileSync('.voltra/clusterio-controller-initialized','2.0.2\n',{mode:0o600});
  fs.unlinkSync('.voltra/clusterio-bootstrap-pending');
  console.log('Administrator access is stored in .voltra/admin-token.txt. Read it privately through Files.');
}
fs.writeFileSync('.voltra/clusterio-plugin-selection',manifest,{mode:0o600});
fs.writeFileSync('.voltra/clusterio-mode',role+'\n',{mode:0o600});
console.log(`Clusterio 2.0.2 ${role} installed. Existing configuration, accounts, mods and instances retained.`);
