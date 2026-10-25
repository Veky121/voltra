"""MIT. Read-only PE VERSIONINFO parser; no Windows/native execution."""
import json
from pathlib import Path
import struct


def fixed_versions(body):
    def need(offset, size):
        if offset < 0 or size < 0 or offset+size > len(body): raise ValueError('Truncated PE resource')
    def u16(offset): need(offset,2);return struct.unpack_from('<H',body,offset)[0]
    def u32(offset): need(offset,4);return struct.unpack_from('<I',body,offset)[0]
    if body[:2] != b'MZ': raise ValueError('Expected PE')
    pe=u32(60);need(pe,24)
    if body[pe:pe+4]!=b'PE\0\0' or u16(pe+4)!=0x8664 or u16(pe+24)!=0x20b: raise ValueError('Expected AMD64 PE32+')
    count, optional=u16(pe+6),u16(pe+20)
    if count>96 or optional<136: raise ValueError('Unexpected PE layout')
    sections=[]
    for index in range(count):
        start=pe+24+optional+40*index;need(start,40)
        sections.append((u32(start+12),u32(start+16),u32(start+20)))
    def raw(rva,size):
        hits=[offset+rva-base for base,length,offset in sections if base<=rva and rva+size<=base+length]
        if len(hits)!=1: raise ValueError('Unmapped or ambiguous PE resource')
        need(hits[0],size);return hits[0]
    rva,size=u32(pe+24+112+16),u32(pe+24+112+20)
    if not rva or not size or size>16*1024**2: raise ValueError('Missing or excessive PE resource table')
    base=raw(rva,size)
    def resource(offset,length):
        if offset<0 or offset+length>size: raise ValueError('Resource escaped table')
        return base+offset
    def entries(offset):
        table=resource(offset,16);count=u16(table+12)+u16(table+14)
        if count>4096: raise ValueError('Excessive resource count')
        resource(offset+16,count*8)
        return [(u32(table+16+i*8),u32(table+20+i*8)) for i in range(count)]
    roots=[value for key,value in entries(0) if key==16]
    if len(roots)!=1 or not roots[0]&0x80000000: raise ValueError('Missing VERSIONINFO type')
    result=[]
    def walk(offset,depth):
        if depth>3: raise ValueError('Deep resource tree')
        for key,value in entries(offset):
            if value&0x80000000: walk(value&0x7fffffff,depth+1)
            else:
                entry=resource(value,16);payload_size=u32(entry+4)
                if not 6<=payload_size<=1024**2: raise ValueError('Invalid version payload size')
                data=raw(u32(entry),payload_size);length=u16(data)
                if length>payload_size or length<52: raise ValueError('Version escaped declared payload')
                need(data,length)
                key='VS_VERSION_INFO'.encode('utf-16-le')+b'\0\0'
                if body[data+6:data+6+len(key)]!=key: raise ValueError('Unexpected version resource key')
                fixed=data+((6+len(key)+3)&~3)
                if fixed+52>data+length or u16(data+2)!=52 or u32(fixed)!=0xfeef04bd: raise ValueError('Invalid fixed version info')
                def version(offset):
                    major,minor=u32(offset)>>16,u32(offset)&0xffff
                    patch,build=u32(offset+4)>>16,u32(offset+4)&0xffff
                    return [major,minor,patch,build]
                result.append({'file_version':version(fixed+8),'product_version':version(fixed+16)})
    walk(roots[0]&0x7fffffff,1)
    if len(result)!=1: raise ValueError('Missing or ambiguous fixed version rows')
    return result


if __name__=='__main__':
    path=Path('/work/StarRupture/Binaries/Win64/StarRuptureServerEOS-Win64-Shipping.exe')
    print(json.dumps({'binary':str(path.relative_to('/work')),'pe_fixed_versions':fixed_versions(path.read_bytes()),
                      'static_metadata_only':True,'game_executed':False}))
