// A build-input snapshot, not a checkout/worktree. Never starts or stops services.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const relative='.local/game-parity-20261029/runtime/build-input-'+Date.now();
const target=path.resolve(relative);
fs.mkdirSync(target,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const inputs=[];
function copy(file){
  // Agent proposals are not Go compiler inputs and may change during a freeze.
  if(file.endsWith('.go.pending')) return;
  const full=path.resolve(file), stat=fs.lstatSync(full);
  if(stat.isSymbolicLink()) throw Error('Unexpected source symlink: '+file);
  if(stat.isDirectory()) {
    if(file.replaceAll('\\','/').includes('game_library/scripts') || path.basename(file)==='__pycache__') return;
    for(const name of fs.readdirSync(full).sort()) copy(path.join(file,name));
  } else if(stat.isFile()) {
    const bytes=fs.readFileSync(full), dest=path.join(target,file);
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
    inputs.push({path:file.replaceAll('\\','/'),sha256:hash(bytes)});
  }
}
for(const item of ['go.mod','go.sum','cmd','internal'])copy(item);
for(const input of inputs)if(hash(fs.readFileSync(path.join(root,input.path)))!==input.sha256)throw Error('Source drift during snapshot: '+input.path);
const manifest={scope:'Fixed Go build inputs and embedded assets; canonical script sources are excluded because recipes embed their reviewed helper bytes in overrides.json',snapshot:relative,inputs,fingerprint:hash(JSON.stringify(inputs))};
fs.writeFileSync(path.join(target,'snapshot-manifest.json'),JSON.stringify(manifest,null,2));
const binaryRelative='.local/game-parity-20261029/runtime/panel-frozen-'+path.basename(target)+'.exe';
const binary=path.resolve(binaryRelative);
execFileSync('go',['build','-o',binary,'./cmd/panel'],{cwd:target,windowsHide:true,stdio:'inherit'});
for(const input of inputs)if(hash(fs.readFileSync(path.join(target,input.path)))!==input.sha256)throw Error('Build input modified: '+input.path);
const receipt={snapshot:relative,fingerprint:manifest.fingerprint,manifest:relative+'/snapshot-manifest.json',binary:binaryRelative,binary_sha256:hash(fs.readFileSync(binary)),source_has_later_work:true,runtime_changed:false};
const history='artifacts/game-parity-20261029/builds';
fs.mkdirSync(history,{recursive:true});
const latest='artifacts/game-parity-20261029/frozen-build.json';
if(fs.existsSync(latest)){const old=JSON.parse(fs.readFileSync(latest));fs.writeFileSync(history+'/'+old.fingerprint+'.json',JSON.stringify(old,null,2));}
fs.writeFileSync(history+'/'+receipt.fingerprint+'.json',JSON.stringify(receipt,null,2));
fs.writeFileSync('artifacts/game-parity-20261029/frozen-build.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));
