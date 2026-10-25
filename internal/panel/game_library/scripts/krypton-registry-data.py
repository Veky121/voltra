"""SPDX-License-Identifier: MIT
Exact 1.19.3 data adapter. Mojang inputs are proprietary temporary build inputs,
never a publisher Krypton binary, runtime dependency, or redistributed class.
"""
import hashlib
import json
import re
import shutil
import zipfile
from pathlib import Path
from krypton_source_build import name, run_phase

CLASSES={
 'SharedConstants':'net.minecraft.SharedConstants','Bootstrap':'net.minecraft.server.Bootstrap',
 'Block':'net.minecraft.world.level.block.Block','Blocks':'net.minecraft.world.level.block.Blocks',
 'BlockBehaviour':'net.minecraft.world.level.block.state.BlockBehaviour',
 'BlockStateBase':'net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase',
 'Material':'net.minecraft.world.level.material.Material','SoundType':'net.minecraft.world.level.block.SoundType',
 'IdMapper':'net.minecraft.core.IdMapper','StateProperties':'net.minecraft.world.level.block.state.properties.BlockStateProperties',
 'Property':'net.minecraft.world.level.block.state.properties.Property'}


def mappings(text):
    spec={};current=None
    for line in text.splitlines():
        if line and not line.startswith(' '):
            current=None
            for short,long in CLASSES.items():
                if line.startswith(long+' -> '):current=short;spec[short]={'class':line.split(' -> ')[1].rstrip(':')}
        elif current and ' -> ' in line:
            left,right=line.strip().split(' -> ');left=re.sub(r'^\d+:\d+:','',left)
            if current in ('Material','SoundType','Blocks','StateProperties') and '(' in left:continue
            key=left.split(' ',1)[1].split('(')[0]
            if current=='Property' and key=='getName' and left.endswith('(java.lang.Comparable)'):
                spec[current]['getNameValue']=right;continue
            if '(' in left and not left.endswith('()') and not (current=='IdMapper' and key=='getId' and left.endswith('(java.lang.Object)')):continue
            if key not in spec[current] or '(' in left:spec[current][key]=right
    if set(spec)!=set(CLASSES):raise ValueError('Official mappings do not contain the exact expected registry classes')
    return spec


def properties(source):
    """Parse the pinned Kotlin definitions, not an alias guess or weaker schema."""
    text=(source/'server/src/main/kotlin/org/kryptonmc/krypton/state/property/KryptonProperties.kt').read_text()
    props={}
    def enums(kind):
        if kind=='Direction.Axis':return ['x','y','z']
        files=list((source/'api/src/main/kotlin').rglob(kind+'.kt'))
        if len(files)!=1:raise ValueError('Expected one pinned property enum: '+kind)
        s=re.sub(r'/\*.*?\*/','',files[0].read_text(),flags=re.S);s=s[s.index('enum class '+kind):];s=s[s.index('{')+1:].split(';')[0]
        values=re.findall(r'^\s*([A-Z][A-Z_0-9]*)\s*(?:,|\(|$)',s,re.M)
        if not values or len(values)!=len(set(values)):raise ValueError('Unsupported pinned enum syntax: '+kind)
        return [v.lower() for v in values]
    for match in re.finditer(r'val (\w+): (BooleanProperty|IntProperty|EnumProperty<([^>]+)>|DirectionProperty)\s*=\s*([^\n]+)',text):
        symbol,kind,enum,expr=match.groups();key=re.search(r'\("([^\"]+)"',expr).group(1)
        if kind=='BooleanProperty':values=['false','true']
        elif kind=='IntProperty':
            low,high=map(int,re.search(r', (\d+), (\d+)\)',expr).groups());values=list(map(str,range(low,high+1)))
        elif kind=='DirectionProperty':
            values=['down','up','north','south','west','east']
            if symbol=='HOPPER_FACING':values.remove('up')
            elif symbol=='HORIZONTAL_FACING':values=['north','south','east','west']
            elif symbol=='VERTICAL_DIRECTION':values=['up','down']
            elif symbol!='FACING':raise ValueError('Unsupported pinned direction expression')
        else:
            values=enums(enum)
            if symbol=='HORIZONTAL_AXIS':values=['x','z']
            elif symbol=='STRAIGHT_RAIL_SHAPE':values=[v for v in values if v not in ('north_east','north_west','south_east','south_west')]
        props[symbol]={'name':key,'values':values}
    if len(props)!=len(re.findall(r'val \w+:',text)):raise ValueError('Unsupported pinned Krypton property definition')
    signatures=[(v['name'],tuple(sorted(v['values']))) for v in props.values()]
    if len(set(signatures))!=len(signatures):raise ValueError('Ambiguous pinned Krypton property signatures')
    return props


def unpack_server(archive,work):
    """Validate the whole publisher archive before extracting only version/libs."""
    with zipfile.ZipFile(archive) as z:
        rows=z.infolist();seen=set()
        if len(rows)>20000 or sum(r.file_size for r in rows)>512*1024**2:raise ValueError('Registry input archive exceeds limits')
        for row in rows:
            path=name(row.orig_filename)
            if str(path) in seen:raise ValueError('Duplicate registry input archive path')
            seen.add(str(path))
            if ((row.external_attr>>16)&0o170000) not in (0,0o100000,0o040000):raise ValueError('Registry input archive contains link/device')
        jars=[]
        for row in rows:
            if row.filename.endswith('.jar') and row.filename.startswith(('META-INF/versions/','META-INF/libraries/')):
                out=work.joinpath(*name(row.filename).parts);out.parent.mkdir(parents=True,exist_ok=True)
                with z.open(row) as incoming,out.open('xb') as destination:shutil.copyfileobj(incoming,destination)
                jars.append(out)
        if len([p for p in jars if 'versions' in p.parts])!=1:raise ValueError('Expected one official version JAR')
        return sorted(jars)


def ordered(data):
    if isinstance(data,dict) and data and all(isinstance(v,dict) and isinstance(v.get('id'),int) for v in data.values()):
        ids=[v['id'] for v in data.values()]
        if sorted(ids)!=list(range(len(ids))):raise ValueError('Registry IDs must be unique and contiguous from zero')
        return dict(sorted(data.items(),key=lambda kv:kv[1]['id']))
    return data


def supplement(sources,work,java,acquire,env,pins):
    work.mkdir();inputs=work/'inputs';inputs.mkdir();downloaded={}
    # Private empty input root deliberately never consults operator/public cache for proprietary inputs.
    for key,pin in pins.items():
        if key=='version':continue
        file=inputs/key;acquire(pin,file,inputs)
        if file.stat().st_size!=pin['bytes'] or hashlib.sha1(file.read_bytes()).hexdigest()!=pin['sha1']:
            raise ValueError('Official registry-generation input identity mismatch')
        downloaded[key]=file
    metadata=json.loads(downloaded['metadata'].read_text())
    if metadata.get('id')!='1.19.3':raise ValueError('Registry metadata version mismatch')
    for key in ('server','server_mappings'):
        record=metadata['downloads'][key]
        if any(record[k]!=pins[key][p] for k,p in [('url','url'),('sha1','sha1'),('size','bytes')]):raise ValueError('Official registry metadata download identity mismatch')
    jars=unpack_server(downloaded['server'],work)
    (work/'spec.json').write_text(json.dumps(mappings(downloaded['server_mappings'].read_text())))
    (work/'properties.json').write_text(json.dumps(properties(sources/'krypton')))
    blocks=sources/'articdata-src/1_19_3_blocks.json';output=work/'blocks.json'
    generator=Path(__file__).with_name('KryptonRegistrySupplement.java')
    run_phase([str(java/'bin/java'),'-Xmx1024m','--class-path',':'.join(map(str,jars)),str(generator),str(work/'spec.json'),str(blocks),str(output),str(work/'properties.json')],work,env,timeout=180)
    data=json.loads(output.read_text())
    if len(data)!=972:raise ValueError('Expected exact Minecraft1.19.3 block registry')
    blocks.write_text(json.dumps(ordered(data),separators=(',',':')))
    ordered_counts={}
    # These are the four ID-based maps consumed by auto-registration loaders.
    # Other data files contain sparse protocol IDs or non-registry structures.
    for filename in ('1_19_3_blocks.json','1_19_3_custom_statistics.json','1_19_3_items.json','1_19_3_sounds.json'):
        file=sources/'articdata-src'/filename
        original=json.loads(file.read_text());result=ordered(original)
        if result is not original:
            file.write_text(json.dumps(result,separators=(',',':')));ordered_counts[file.name]=len(result)
    proof={'official_inputs':pins,'block_count':len(data),'default_state_ids_verified':True,'property_signatures_verified':True,
           'ordered_registries':ordered_counts,'generator_sha256':hashlib.sha256(generator.read_bytes()).hexdigest(),
           'adapter_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'proprietary_binaries_redistributed':False,
           'minecraft_main_started':False,'world_created':False,'license':'MIT for generator; Mojang inputs proprietary temporary generation inputs'}
    # Keep only JSON generation provenance. Never put Mojang classes/JARs/mappings in ready/cache.
    return proof
