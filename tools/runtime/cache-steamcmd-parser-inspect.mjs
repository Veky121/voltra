// Inspect only the fake app0 fixture field in this probe's private scratch.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const directory=process.argv.includes('--app90')?'.local/steamcmd-parser-app90':'.local/steamcmd-parser-anonymous';
const receipt=JSON.parse(fs.readFileSync(directory+'/receipt.json','utf8'));
if(!/^\/var\/lib\/voltra-batch-20261023\/utility\/steamcmd-parser\/[a-f0-9-]{36}$/.test(receipt.base))throw Error('Unexpected probe scope');
const program=`from pathlib import Path
import json
found=[]
config_files=[]
for p in Path('/work').rglob('*'):
 if not p.is_file() or p.stat().st_size>1048576: continue
 if p.suffix in ('.vdf','.acf'): config_files.append(str(p.relative_to('/work')))
 data=p.read_bytes()
 if b'voltra_fixture' in data:
  at=data.index(b'voltra_fixture')
  found.append({'file':str(p.relative_to('/work')),'fake_field_bytes':repr(data[at:at+200])})
 if p.name=='localconfig.vdf':
  for line in data.decode('utf-8',errors='replace').splitlines():
   if line.strip().startswith('"mod"'): found.append({'file':str(p.relative_to('/work')),'fake_mod_field':line})
print(json.dumps({'fake_fields':found,'config_file_names':config_files},ensure_ascii=False))
`;
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','128m','--mount',`type=bind,source=${receipt.base},target=/work,readonly`,'python:3.13-slim','python3','-c',program],{encoding:'utf8',windowsHide:true});
if(result.status)throw Error(result.stderr);
fs.writeFileSync(directory+'/fake-fields.json',result.stdout);
console.log(result.stdout);
