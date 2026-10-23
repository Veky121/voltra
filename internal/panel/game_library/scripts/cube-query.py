#!/usr/bin/env python3
"""MIT. Native Cube variable-integer info queries with echoed nonce validation."""
import secrets
import socket
import struct
import time


def putint(value):
    if -126<=value<=127:return bytes([value&255])
    if -32768<=value<=32767:return b'\x80'+struct.pack('<h',value)
    return b'\x81'+struct.pack('<i',value)


class Reader:
    def __init__(self,data):self.data,self.offset=data,0
    def integer(self):
        if self.offset>=len(self.data):raise ValueError('Truncated native Cube integer')
        first=self.data[self.offset];self.offset+=1
        size=2 if first==128 else 4 if first==129 else 0
        if size:
            if self.offset+size>len(self.data):raise ValueError('Truncated native Cube integer')
            result=int.from_bytes(self.data[self.offset:self.offset+size],'little',signed=True);self.offset+=size;return result
        return first if first<128 else first-256
    def string(self):
        result=bytearray()
        for _ in range(4096):
            value=self.integer()
            if value==0:return result.decode('utf8',errors='replace')
            if not -128<=value<=255:raise ValueError('Invalid native Cube string')
            result.append(value&255)
        raise ValueError('Native Cube string exceeds query limit')


def parse(kind,data,nonce):
    reader=Reader(data)
    if reader.integer()!=nonce:raise ValueError('Native Cube nonce mismatch')
    if kind=='assaultcube':
        if reader.integer()!=0:raise ValueError('Unexpected AssaultCube info extension')
        protocol,mode,players,remaining=[reader.integer() for _ in range(4)]
        game_map,name=reader.string(),reader.string()
        maximum,flags=reader.integer(),reader.integer()
        password=bool(flags&1)
    elif kind=='sauerbraten':
        players,count=reader.integer(),reader.integer()
        if count not in (5,7):raise ValueError('Unexpected Sauerbraten info attributes')
        attrs=[reader.integer() for _ in range(count)]
        protocol,mode,remaining,maximum,flags=attrs[:5]
        password=flags==4
        game_map,name=reader.string(),reader.string()
    else:raise ValueError('Unknown native Cube game')
    if not 1<=protocol<=100000 or not 1<=maximum<=256 or not 0<=players<=256:raise ValueError('Invalid native Cube server info')
    result={'name':name,'map':game_map,'protocol':protocol,'game_type':mode,'players':players,'maxplayers':maximum,'password':password,'native_flags':flags,'time_remaining':remaining}
    if kind=='sauerbraten' and count==7:result.update(paused=bool(attrs[5]),game_speed=attrs[6])
    return result


def query(kind,host,game_port,timeout=.5):
    nonce=secrets.randbelow(0x3fffffff)+1
    request=putint(nonce)+(putint(0) if kind=='assaultcube' else b'')
    address=(socket.gethostbyname(host),game_port+1)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
        stream.settimeout(timeout);start=time.monotonic();stream.sendto(request,address)
        packet,sender=stream.recvfrom(8192)
        if sender!=address:raise ValueError('Unexpected native Cube responder')
        result=parse(kind,packet,nonce);result['latency_ms']=round((time.monotonic()-start)*1000,2);return result


if __name__=='__main__':
    import sys,json
    print(json.dumps(query(sys.argv[1],sys.argv[2],int(sys.argv[3]),2)))
