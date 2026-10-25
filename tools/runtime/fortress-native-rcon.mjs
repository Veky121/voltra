import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/fortress-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),command=process.argv[2],tag=process.argv[3];if(!['help','quit'].includes(command)||!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Only native-help-confirmed bounded RCON acceptance commands');
const v=(await api('/api/application/servers/'+s.internal_id)).attributes;if(v.uuid!==s.uuid||v.egg!==s.egg_id||s.owner!=='game_batch_inventory')throw Error('Foreign fixture');
const source=fs.readFileSync('internal/panel/game_library/scripts/source-l4d.py').toString('base64');
const code=`import base64,types,socket,threading,json
m=types.ModuleType('owned_rcon');exec(compile(base64.b64decode(${JSON.stringify(source)}),'source-l4d.py','exec'),m.__dict__)
cancel=threading.Event();result={}
with socket.create_connection(('127.0.0.1',${s.ports[1]}),timeout=3)as c:
 c.settimeout(3);c.sendall(m.rcon_packet(4101,3,${JSON.stringify(s.test_password)}));frames=[]
 for _ in range(2):
  frame=m.rcon_read(c,cancel);frames.append({'id':frame[0],'type':frame[1]})
  if frame[1]==2:break
 if frame[0]!=4101 or frame[1]!=2:raise ValueError('RCON authentication failed')
 c.sendall(m.rcon_packet(4102,2,${JSON.stringify(command)}));received=[]
 for _ in range(12):
  try:reply=m.rcon_read(c,cancel)
  except OSError as error:
   if ${JSON.stringify(command)}!='quit':raise
   received.append({'connection_closed_after_quit':str(error)});break
  received.append({'id':reply[0],'type':reply[1],'body':reply[2]})
  if reply[0]==4102:break
 result={'authenticated':True,'auth_frames':frames,'command':${JSON.stringify(command)},'replies':received,'matching_command_id':any(v.get('id')==4102 for v in received)}
print(json.dumps(result))
`;
const p=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:3e6});if(p.status)throw Error(p.stderr.replaceAll(s.test_password,'[redacted]'));const value=JSON.parse(p.stdout.replaceAll(s.test_password,'[redacted]'));fs.writeFileSync(dir+'/rcon-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log(value);
