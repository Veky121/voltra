import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {api,rows} from './openttd-compat-node.mjs';
const old='.local/romestead-native',s=JSON.parse(fs.readFileSync(old+'/private.json')),proof=JSON.parse(fs.readFileSync(old+'/metadata-create-failure.json'));
if(s.uuid||s.owner!=='unreal_survival'||!Object.values(proof.checks).every(Boolean)||rows(await api('/api/application/servers')).some(v=>v.external_id==='romestead-native-'+s.request_id||v.egg===s.egg_id))throw Error('Prior attempt not exact-cleaned');
const destination='.local/romestead-native-metadata-'+s.request_id;
const root=fs.realpathSync('.local'),source=fs.realpathSync(old),dest=path.resolve(destination);if(path.dirname(source)!==root||path.dirname(dest)!==root||fs.existsSync(dest))throw Error('Archive destination not confined/unique');
execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','requeue',JSON.stringify({lease_id:s.lease_id,owner:s.owner})],{windowsHide:true,stdio:'pipe'});
fs.renameSync(source,dest);console.log({preserved_history:destination,requeued:true});
