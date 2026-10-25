// Observe the existing first installer only; never requests or repeats an install.
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {api} from './openttd-compat-node.mjs';
const d='.local/craftopia-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),request=JSON.parse(fs.readFileSync(d+'/first-reinstall-request.json'));
if(request.uuid!==s.uuid)throw Error('Installer request identity');
const deadline=Date.now()+900000,samples=[];
while(Date.now()<deadline){const a=(await api('/api/application/servers/'+s.internal_id)).attributes;if(a.uuid!==s.uuid||a.external_id!=='craftopia-native-'+s.request_id)throw Error('Identity');samples.push({at:new Date().toISOString(),status:a.status});fs.writeFileSync(d+'/first-installer-observer.json',JSON.stringify({uuid:s.uuid,samples,read_only:true},null,2));if(a.status==='install_failed')throw Error('First actual installer failed; no retry');if(a.status===null){console.log({completed:true,samples:samples.length,read_only:true});process.exit(0);}await delay(4000);}
throw Error('Existing installer remains pending after bounded observation; no retry');
