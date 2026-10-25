"""MIT. Recompute the harmless probe's imports from the exact reviewed public ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile


def imports(data):
    def u16(offset): return struct.unpack_from('<H', data, offset)[0]
    def u32(offset): return struct.unpack_from('<I', data, offset)[0]
    def u64(offset): return struct.unpack_from('<Q', data, offset)[0]
    pe=u32(60)
    if data[:2]!=b'MZ' or data[pe:pe+4]!=b'PE\0\0' or u16(pe+4)!=0x8664:
        raise ValueError('Reviewed AMD64 PE required')
    optional=pe+24
    if u16(optional)!=0x20b: raise ValueError('PE32+ required')
    sections=optional+u16(pe+20)
    def offset(rva):
        for index in range(u16(pe+6)):
            section=sections+index*40
            size,address,raw_size,raw=struct.unpack_from('<IIII',data,section+8)
            if address<=rva<address+max(size,raw_size): return raw+rva-address
        raise ValueError('Import RVA outside sections')
    def string(position): return data[position:data.index(b'\0',position)].decode('ascii')
    descriptor=offset(u32(optional+120));result={}
    for _ in range(1024):
        original,stamp,chain,name,first=struct.unpack_from('<IIIII',data,descriptor)
        if not any((original,stamp,chain,name,first)): return result
        library=string(offset(name)).lower();thunk=offset(original or first);symbols=result.setdefault(library,set())
        for _ in range(65536):
            value=u64(thunk);thunk+=8
            if not value: break
            symbols.add('#'+str(value&0xffff) if value>>63 else string(offset(value)+2))
        else: raise ValueError('Unbounded PE thunk')
        descriptor+=20
    raise ValueError('Unbounded PE descriptor')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    pin=json.loads(Path('internal/panel/game_library/scripts/palworld-loader-pins.json').read_bytes())
    payload=args.archive.read_bytes()
    if len(payload)!=pin['archive']['bytes'] or hashlib.sha256(payload).hexdigest()!=pin['archive']['sha256']:raise ValueError('Exact reviewed archive required')
    merged={}
    with zipfile.ZipFile(args.archive) as archive:
        for name in ('dwmapi.dll','ue4ss/UE4SS.dll'):
            data=archive.read(name);entry=next(item for item in pin['files'] if item['path']==name)
            if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Exact pinned DLL required')
            for library,symbols in imports(data).items():merged.setdefault(library,set()).update(symbols)
    result={'archive_sha256':pin['archive']['sha256'],'probe_baseline_imports':{'kernel32.dll':['LoadLibraryExW','OutputDebugStringW']},'imports':{name:sorted(symbols) for name,symbols in sorted(merged.items())}}
    target=Path('tools/runtime/palworld-runtime-probe/imports.json')
    if args.write:target.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    elif json.loads(target.read_bytes())!=result:raise ValueError('Probe import metadata differs from pinned DLLs')
    print(json.dumps({'libraries':len(merged),'exports':sum(map(len,merged.values())),'exact_archive':True}))


if __name__=='__main__':main()
