#!/usr/bin/env python3
"""MIT. Bounded native launcher/info queries; Zandronum echoes a challenge."""
import secrets
import socket
import struct
import time
from zandronum_huffman import Huffman, HUFFMAN_FREQS

FLAGS=1|2|8|16|32|512|1024|2048|4096|0x80000
CODEC=Huffman(HUFFMAN_FREQS)

def parse_vril(data):
 if len(data)<8 or len(data)>8192 or int.from_bytes(data[:4],'big')!=(0x80000000|len(data)) or data[4]!=0x83:raise ValueError('Invalid NetQuake server-info packet')
 position=5
 def text():
  nonlocal position
  end=data.find(b'\0',position)
  if end<0 or end-position>2048:raise ValueError('Truncated NetQuake string')
  value=data[position:end].decode('utf8',errors='replace');position=end+1;return value
 address,name,mapname=text(),text(),text()
 if position+3!=len(data):raise ValueError('Malformed NetQuake info fields')
 return dict(address=address,name=name,map=mapname,players=data[position],maxplayers=data[position+1],protocol=data[position+2])

def parse_zandronum(data,nonce):
 if not data or len(data)>8192 or data[0] not in (*range(8),255):raise ValueError('Invalid launcher packet')
 data=CODEC.decode(data);position=0
 def number(size=4):
  nonlocal position
  if position+size>len(data):raise ValueError('Truncated launcher packet')
  value=int.from_bytes(data[position:position+size],'little');position+=size;return value
 def text():
  nonlocal position
  end=data.find(b'\0',position)
  if end<0 or end-position>2048:raise ValueError('Invalid launcher string')
  value=data[position:end].decode('utf8',errors='replace');position=end+1;return value
 if number()!=5660023 or number()!=nonce:raise ValueError('Launcher denied query or challenge mismatch')
 version=text();flags=number()
 if flags!=FLAGS:raise ValueError('Unexpected launcher response fields')
 result=dict(version=version,name=text(),website=text(),map=text(),maxclients=number(1),maxplayers=number(1),iwad=text(),password=bool(number(1)),join_password=bool(number(1)),skill=number(1),players=number(1))
 if position!=len(data):raise ValueError('Unexpected launcher trailing fields')
 return result

def query(kind,host,port,timeout=2):
 nonce=secrets.randbits(30)
 if kind=='zandronum':request=CODEC.encode(struct.pack('<III',199,FLAGS,nonce))
 elif kind=='nzportable-vril':request=struct.pack('>I',0x8000000c)+b'\x02QUAKE\0\x03'
 else:request=b'\xff\xff\xff\xffgetinfo '+str(nonce).encode()+b'\n'
 address=socket.gethostbyname(host);start=time.monotonic()
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
  stream.settimeout(timeout);stream.sendto(request,(address,port));data,responder=stream.recvfrom(8192)
  if kind=='nzportable' and data==b'\xff\xff\xff\xffinfoResponse\n' and responder==(address,port):
   stream.sendto(b'\xff\xff\xff\xffstatus\n',(address,port));data,responder=stream.recvfrom(8192)
 if responder!=(address,port):raise ValueError('Unexpected query responder')
 if kind=='zandronum':result=parse_zandronum(data,nonce)
 elif kind=='nzportable-vril':result=parse_vril(data)
 else:
  qw=data.startswith(b'\xff\xff\xff\xffn\\')
  if not qw and not data.startswith(b'\xff\xff\xff\xffinfoResponse\n'):raise ValueError('Invalid FTE info response')
  body=data[5:].split(b'\n',1)[0] if qw else data.split(b'\n',1)[1]
  fields=body.split(b'\\')[1:]
  if len(fields)%2:raise ValueError('Malformed FTE info fields')
  info={fields[i].decode('ascii'):fields[i+1].decode('utf8',errors='replace').strip('\0\n') for i in range(0,len(fields),2)}
  # FTE's public getinfo implementation omits challenge. Match the UDP
  # responder and validate one if another engine revision supplies it.
  if 'challenge' in info and info['challenge']!=str(nonce):raise ValueError('FTE challenge mismatch')
  qwplayers=sum(bool(line.strip(b'\0\r ')) for line in data[5:].split(b'\n')[1:]) if qw else 0
  result=dict(name=info.get('hostname'),map=info.get('mapname',info.get('map')),maxplayers=int(info.get('sv_maxclients',info.get('maxclients',0))),players=int(info.get('clients',qwplayers)),protocol=info.get('protocol'),raw=info)
 result['latency_ms']=round((time.monotonic()-start)*1000,2);return result

if __name__=='__main__':
 import json,sys
 print(json.dumps(query(sys.argv[1],sys.argv[2],int(sys.argv[3]))))
