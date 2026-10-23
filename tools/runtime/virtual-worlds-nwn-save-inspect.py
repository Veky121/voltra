"""Read actual ERF/GFF save metadata only; never creates or edits a game save."""
import hashlib,json,pathlib,struct,sys
root=pathlib.Path('/volume')
def integer(data,offset):return struct.unpack_from('<I',data,offset)[0]
def fields(data):
    struct_offset,_,field_offset,_,label_offset,_,data_offset,_,index_offset,_,_,_=struct.unpack_from('<12I',data,8)
    _,index,count=struct.unpack_from('<3I',data,struct_offset)
    indices=[] if count==0 else [index] if count==1 else list(struct.unpack_from('<'+str(count)+'I',data,index_offset+index))
    result={}
    for index in indices:
        kind,label,value=struct.unpack_from('<3I',data,field_offset+index*12)
        name=data[label_offset+label*16:label_offset+(label+1)*16].rstrip(b'\0').decode()
        if not name.startswith(('Mod_Start','Mod_Time','Mod_ID','Mod_Min','Mod_Entry','Time','Calendar','Game','Module','Save')):continue
        if kind in (0,1,2,3,4,5):result[name]=value
        elif kind==10:
            size=integer(data,data_offset+value);result[name]=data[data_offset+value+4:data_offset+value+4+size].decode(errors='replace')
        elif kind==13:
            size=integer(data,data_offset+value);result[name]=data[data_offset+value+4:data_offset+value+4+size].hex()
    return result
rows=[]
for save in sorted([*(root/'user/saves').rglob('*.sav'), *(root/'user/modules').glob('*.mod')]):
    data=save.read_bytes();assert data[:4] in (b'SAV ',b'ERF ',b'MOD ')
    count,key_offset,resource_offset=integer(data,16),integer(data,24),integer(data,28)
    resources=[]
    for index in range(count):
        entry=data[key_offset+index*24:key_offset+(index+1)*24]
        name=entry[:16].rstrip(b'\0').decode();resource_id=integer(entry,16)
        offset,size=struct.unpack_from('<II',data,resource_offset+resource_id*8)
        contents=data[offset:offset+size]
        info={'name':name,'type':struct.unpack_from('<H',entry,20)[0],'bytes':size}
        if name.lower() in ('module','saveinfo') and contents[4:8]==b'V3.2':info['fields']=fields(contents)
        resources.append(info)
    rows.append({'path':save.relative_to(root).as_posix(),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'resources':resources})
print(json.dumps({'saves':rows}))
