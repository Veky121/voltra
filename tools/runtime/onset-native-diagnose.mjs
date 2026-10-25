import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {api} from './openttd-compat-node.mjs';
const dir='.local/onset-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(s.node_receipt));
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==s.node||s.node!==node.node||server.external_id!=='onset-native-'+s.request_id)throw Error('Owned diagnostic identity mismatch');
const script=`from pathlib import Path
import json,struct,re,hashlib,socket,subprocess,os
r=Path('/home/container');p=r/'plugins/mariadb.so';b=p.read_bytes();assert b[:6]==b'\\x7fELF\\x02\\x01'
sections=[];shoff=struct.unpack_from('<Q',b,40)[0];shsize,shnum,shstr=struct.unpack_from('<HHH',b,58)
for i in range(shnum):sections.append(struct.unpack_from('<IIQQQQIIQQ',b,shoff+i*shsize))
names=b[sections[shstr][4]:sections[shstr][4]+sections[shstr][5]]
def string(table,off):return table[off:table.index(b'\\0',off)].decode(errors='replace')
named={string(names,sec[0]):sec for sec in sections};dyn=named['.dynamic'];ds=named['.dynstr'];strings=b[ds[4]:ds[4]+ds[5]]
needed=[]
for off in range(dyn[4],dyn[4]+dyn[5],16):
 tag,value=struct.unpack_from('<QQ',b,off)
 if tag==1:needed.append(string(strings,value))
syms=named['.dynsym'];imports=[]
for off in range(syms[4],syms[4]+syms[5],syms[9]):
 name,info,other,index,value,size=struct.unpack_from('<IBBHQQ',b,off)
 text=string(strings,name)
 if index==0 and ('mysql' in text or 'mariadb' in text):imports.append(text)
child=dict(os.environ)
for key in ['PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH']:child.pop(key,None)
linked=subprocess.run(['/usr/bin/ldd',str(p)],env=child,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
q=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);q.settimeout(2);packets=[]
try:
 q.sendto(b'\\xff'*4+b'TSource Engine Query\\0',('127.0.0.1',${s.ports[1]}));data,peer=q.recvfrom(65536);packets.append({'hex':data.hex(),'peer':peer})
 if data[:5]==b'\\xff'*4+b'A':
  q.sendto(b'\\xff'*4+b'TSource Engine Query\\0'+data[5:9],peer);data,peer=q.recvfrom(65536);packets.append({'hex':data.hex(),'peer':peer})
except socket.timeout:packets.append({'timeout':True})
finally:q.close()
print(json.dumps({'plugin':{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'needed':needed,'imported_sql_symbols':imports,'version_names':sorted(set(x.decode() for x in re.findall(rb'(?:libmariadbclient_[0-9]+|libmysqlclient_[0-9]+|GLIBC_[0-9.]+|GLIBCXX_[0-9.]+)',b))),'ldd':linked.stdout},'loopback_a2s':packets}))
`;
const r=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:script,encoding:'utf8',maxBuffer:4e6});
if(r.status)throw Error(r.stderr);const out=JSON.parse(r.stdout);fs.writeFileSync(dir+'/first-native-diagnostic.json',JSON.stringify(out,null,2)+'\n');console.log(out);
