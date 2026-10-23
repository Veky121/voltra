#!/usr/bin/env python3
"""MIT. Bounded native QL UDP and SS14 HTTP status queries."""
import json
import socket
import urllib.request

def parse_quake(data):
 if not data.startswith(b'\xff\xff\xff\xffI') or len(data)>16384 or len(data)<6:raise ValueError('Invalid native Quake A2S info')
 offset=6;fields=[]
 for _ in range(4):
  end=data.find(b'\0',offset)
  if end<0:raise ValueError('Truncated native A2S info')
  fields.append(data[offset:end].decode('utf8',errors='replace'));offset=end+1
 if len(data)<offset+9:raise ValueError('Truncated native A2S fields')
 return dict(name=fields[0],map=fields[1],players=data[offset+2],maxplayers=data[offset+3],password=bool(data[offset+7]),protocol=data[5])

def parse_ss14(data):
 if len(data)>65536:raise ValueError('Oversized SS14 status')
 result=json.loads(data)
 if not isinstance(result,dict) or not isinstance(result.get('name'),str) or type(result.get('players')) is not int or result['players']<0:raise ValueError('Invalid SS14 status')
 return result

def query(kind,host,port,timeout=1):
 if kind=='ss14':
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
  with opener.open('http://'+host+':'+str(port)+'/status',timeout=timeout) as response:
   if response.status!=200:raise ValueError('SS14 status HTTP failure')
   return parse_ss14(response.read(65537))
 if kind!='quakelive':raise ValueError('Unknown native query')
 address=socket.gethostbyname(host);request=b'\xff\xff\xff\xffTSource Engine Query\0'
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
  stream.settimeout(timeout);stream.sendto(request,(address,port));data,peer=stream.recvfrom(16385)
  if peer==(address,port) and data.startswith(b'\xff\xff\xff\xffA'):
   if len(data)!=9:raise ValueError('Malformed native A2S challenge')
   stream.sendto(request+data[5:],peer);data,peer=stream.recvfrom(16385)
 if peer!=(address,port):raise ValueError('Unexpected native query responder')
 return parse_quake(data)

if __name__=='__main__':
 import sys
 print(json.dumps(query(sys.argv[1],sys.argv[2],int(sys.argv[3]))))
