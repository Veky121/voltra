import fs from 'node:fs';import{spawnSync}from'node:child_process';
const source=fs.readFileSync('internal/panel/steam_catalog_palworld.go','utf8').replaceAll('\r','');const raw=source.match(/launcher := fmt.Sprintf\(`([\s\S]*?)`, artifact.SHA256/)[1];let args=['a'.repeat(64),'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini','','./Pal/Binaries/Linux/PalServer-Linux-Shipping Pal',15,'nc -z 127.0.0.1 25585','nc -z 127.0.0.1 25585'],index=0;let rendered=raw.replaceAll('%%','__PERCENT__').replace(/%[sd]/g,()=>String(args[index++])).replaceAll('__PERCENT__','%');
const program=String.raw`
from pathlib import Path
import sys,tempfile,hashlib,subprocess,os,json,stat
source=sys.stdin.read()
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);private=root/'.voltra';private.mkdir();client=private/'console-client'
 client.write_text('#!/usr/local/bin/python3\nimport sys,json,os\nfrom pathlib import Path\np=Path("commands.jsonl")\nwith p.open("a") as f:f.write(json.dumps({"pid":os.getpid(),"args":sys.argv[1:]})+"\\n")\nif sys.argv[-1]=="First command":sys.stderr.write("fixture stale RCON EOF\\n");sys.exit(1)\n')
 digest=hashlib.sha256(client.read_bytes()).hexdigest()
 for name in ['palworld-console.json','console-client.manifest.json','console-client.LICENSE']:(private/name).write_text('{}')
 config=root/'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini';config.parent.mkdir(parents=True);config.write_text('private')
 nc=root/'nc';nc.write_text('#!/bin/sh\nexit 0\n');nc.chmod(0o700)
 script=source.replace('/home/container',directory).replace('a'*64,digest)
 script='\n'.join('(sleep .4; exit 7) &' if line.startswith('./Pal/Binaries/Linux/PalServer-Linux-Shipping ') else line for line in script.splitlines())
 (root/'start.sh').write_text(script)
 command='Second "quoted" \\ literal'
 result=subprocess.run(['bash','start.sh'],cwd=directory,input='First command\n'+command+'\n',text=True,capture_output=True,timeout=5,env={**os.environ,'PATH':directory+':'+os.environ['PATH'],'SERVER_PORT':'28011'})
 rows=[json.loads(line) for line in (root/'commands.jsonl').read_text().splitlines()]
 assert [row['args'][-1] for row in rows]==['First command',command],'failed command was replayed or literal command changed'
 assert rows[0]['pid']!=rows[1]['pid'],'RCON process reused'
 assert 'fixture stale RCON EOF' in result.stderr,'failed command error hidden'
 assert result.returncode==7,'native exit not retained'
 assert stat.S_IMODE(client.stat().st_mode)==0o700 and stat.S_IMODE(config.stat().st_mode)==0o600
 print(json.dumps({'fresh_client_per_command':True,'no_replay':True,'literal_quoted_command':True,'visible_failure':True,'native_exit_retained':7,'private_modes':True}))
`;
let result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','64m','--cpus','1','python:3.13-slim','python3','-B','-c',program],{windowsHide:true,encoding:'utf8',input:rendered,timeout:15000});if(result.status)throw Error(result.stderr);console.log(result.stdout.trim());
