import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const directory='.local/virtual-worlds/nwn',receipt=JSON.parse(fs.readFileSync(directory+'/private.json'));
const phase=process.argv[2];if(!/^[a-z0-9-]+$/.test(phase||''))throw Error('A simple evidence phase is required');
const server=(await api('/api/application/servers/'+receipt.internal_id)).attributes;
if(server.uuid!==receipt.uuid||server.node!==202||server.egg!==receipt.egg_id||server.external_id!=='virtual-worlds-nwn-'+receipt.request_id)throw Error('Owned identity mismatch');
const code=`import pathlib,json,hashlib,os,stat
r=pathlib.Path('/volume');assert not r.is_symlink()
rows=[]
for p in sorted(r.rglob('*')):
 if p.is_symlink():raise ValueError('Unexpected fixture symlink')
 if p.is_file():
  s=p.stat();rows.append({'path':p.relative_to(r).as_posix(),'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest(),'bytes':s.st_size,'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid,'gid':s.st_gid})
release=json.loads((r/'.voltra/virtual-worlds/nwn-release.json').read_text())
print(json.dumps({'rows':rows,'release':release}))`;
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--read-only','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${receipt.uuid},target=/volume,readonly`,'python:3.13-slim','python','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024,timeout:60000});
if(result.status)throw Error('Owned read-only volume snapshot failed: '+result.stderr.slice(-500));
const proof=JSON.parse(result.stdout),expected=JSON.parse(fs.readFileSync(directory+'/expected-source.json'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
proof.sources=[];
for(const[name,record]of Object.entries(expected.helpers)){
 const original=fs.readFileSync('internal/panel/game_library/scripts/'+name);if(sha(original)!==record.sha256)throw Error('Expected source drifted: '+name);
 const installed=proof.rows.find(r=>r.path==='.voltra/'+name.replaceAll('-','_'));
 if(!installed||![sha(original),sha(Buffer.concat([original,Buffer.from('\n')]))].includes(installed.sha256))throw Error('Installed helper is not exact expected source: '+name);
 proof.sources.push({name,source_sha256:record.sha256,installed_sha256:installed.sha256,exact_source_or_heredoc_newline:true});
}
const egg=(await api('/api/admin/eggs/'+receipt.egg_id)).attributes;
if(sha(egg.script_install)!==expected.script_sha256)throw Error('Fixture egg changed after expected snapshot');
if(expected.config_startup&&JSON.stringify(egg.config_startup)!==JSON.stringify(expected.config_startup))throw Error('Fixture readiness changed after expected snapshot');
for(const[path,digest]of Object.entries(proof.release.files))if(proof.rows.find(r=>r.path===path)?.sha256!==digest)throw Error('Installed program differs from publisher release receipt: '+path);
Object.assign(proof,{uuid:receipt.uuid,at:new Date().toISOString(),phase,fixture_egg_script_exact:true});
fs.writeFileSync(directory+'/'+phase+'-proof.json',JSON.stringify(proof,null,2)+'\n');
console.log({uuid:receipt.uuid,phase,files:proof.rows.length,exact_sources:proof.sources.length,version:proof.release.version,archive_sha256:proof.release.sha256});
