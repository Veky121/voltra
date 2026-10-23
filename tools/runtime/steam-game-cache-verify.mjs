// Two independent utilities; no Panel mutations, no game process launches.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {core,native,node,helpers} from './steam-game-cache-common.mjs';
const directory='.local/steam-game-cache/app90-cstrike',file=directory+'/verification.json';if(fs.existsSync(file))throw Error('Existing verification; inspect same utilities');
const acquisition=JSON.parse(fs.readFileSync(directory+'/prepare.json'));if(acquisition.phase!=='published')throw Error('Pristine publication required');
const identity=acquisition.cache.object,report={object:identity,cases:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
core(['verify','--id',identity]);
for(const name of ['one','two']){
 const id=randomUUID(),row={name,id,container:'voltra-game-cache-verify-'+id.slice(0,8),phase:'created'};report.cases.push(row);save();core(['init','--id',id,'--empty-payload']);
 const started=Date.now();row.seed=core(['seed','--id',identity,'--destination','/cache/steam-games/work/'+id+'/payload']);row.seed_ms=Date.now()-started;row.phase='native_validating';save();
 row.proof=native(id,row.container,90,'cstrike','linux',true,false,identity);row.phase='publisher_validated';save();
}
const script=`import importlib.util,json,pathlib,sys,hashlib
s=importlib.util.spec_from_file_location('c','/helpers/steam-game-cache.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
root=pathlib.Path('/cache');data=json.loads(sys.argv[1]);obj=root/'steam-games/objects'/data['object']
with c.locked(root):
 manifest=c.verify(obj);name='hlds_linux';paths=[root/'steam-games/work'/row['id']/'payload'/name for row in data['cases']];original=obj/'payload'/name
 before=[c.digest(path) for path in paths];inodes=[path.stat().st_ino for path in paths]+[original.stat().st_ino]
 with paths[0].open('ab') as out:out.write(b'private-copy-mutation-proof')
 unchanged=c.digest(paths[1])==before[1] and c.digest(original)==manifest['files'][name]['sha256'];c.verify(obj)
 print(json.dumps({'different_inodes':len(set(inodes))==3,'identical_before_mutation':len(set(before+[manifest['files'][name]['sha256']]))==1,'second_copy_and_cache_unchanged_after_private_mutation':unchanged,'cache_fully_reverified':True,'sample':name,'shared_cache_bytes':c.usage(root)}))`;
const result=spawnSync('docker',['run','--rm','--network','none','--read-only','--memory','256m','--mount',`type=bind,source=${helpers},target=/helpers,readonly`,'--mount',`type=bind,source=${node.cache_root},target=/cache`,'python:3.13-slim','python3','-B','-c',script,JSON.stringify(report)],{encoding:'utf8',timeout:120000});
if(result.status)throw Error(result.stderr);report.independence=JSON.parse(result.stdout);save();
if(!report.independence.different_inodes||!report.independence.identical_before_mutation||!report.independence.second_copy_and_cache_unchanged_after_private_mutation)throw Error('Private copy independence/cache integrity failed');
console.log({two_private_copies_publisher_validated:true,cases:report.cases.map(row=>({name:row.name,seed_ms:row.seed_ms,elapsed_ms:row.proof.elapsed_ms,network_received_bytes:row.proof.network_received_bytes,download_progress_lines:row.proof.download_progress_lines})),independence:report.independence});
