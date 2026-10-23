#!/usr/bin/env python3
"""MIT. Native SCS dedicated servers and publisher Trackmania distribution."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import time
import zipfile

def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module

native=helper('native-config');release=helper('native-release');steam=helper('steam-template')
GAMES={'ats':(2239530,'American Truck Simulator','amtrucks_server'),'ets2':(1948160,'Euro Truck Simulator 2','eurotrucks2_server')}
TRACKMANIA={'version':'2026-05-15','url':'https://nadeo-download.cdn.ubi.com/trackmania/TrackmaniaServer_2026-05-15_5379519e729b882f67892b593c65bfe6ff11989e55f3ddd1ca6ab3029ca1df1a.zip','sha256':'5379519e729b882f67892b593c65bfe6ff11989e55f3ddd1ca6ab3029ca1df1a','bytes':253509378}

def confined(root,path):
    root=Path(root).resolve();path=Path(path)
    if not path.resolve().is_relative_to(root) or path.is_symlink():raise ValueError('Native path leaves server volume')
    for parent in path.parents:
        if parent==root:break
        if parent.is_symlink():raise ValueError('Native path uses symlink')
    return path

def text(env,key,default='',limit=255):
    value=env.get(key,default)
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def ports(env):
    raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Missing allocated ports')
    available={int(p) for p in raw.split(',')}
    if any(not 1<=p<=65535 for p in available):raise ValueError('Invalid allocation')
    primary=int(env['SERVER_PORT']);query=int(env['QUERY_PORT']) if env.get('QUERY_PORT') else next(iter(sorted(available-{primary})),0)
    if primary not in available or query not in available or primary==query:raise ValueError('Distinct allocated game/query ports required')
    return primary,query

def patch_sii(content,values):
    # Only complete scalar lines in the one server_config unit are managed.
    # Strings and comments are lexed to avoid matching a quoted fake key.
    structural=re.sub(r'(?m)^\s*(?:#|//)[^\r\n]*','',content)
    if not re.match(r'\s*SiiNunit\s*\{',structural) or len(re.findall(r'(?m)^\s*server_config\s*:',structural))!=1:raise ValueError('Expected one native server_config unit')
    seen=set();lines=[]
    for line in content.splitlines(keepends=True):
        match=re.match(r'^(\s*)([a-z_]+)(\s*:\s*)("(?:\\.|[^"\\])*"|[^\s#]+)(\s*(?://[^\r\n]*|#[^\r\n]*)?)(\r?\n)?$',line)
        if match and match[2] in values:
            key=match[2]
            if key in seen:raise ValueError('Duplicate managed SII key')
            seen.add(key);line=match[1]+key+match[3]+json.dumps(values[key],ensure_ascii=False)+match[5]+(match[6] or '')
        lines.append(line)
    if seen!=set(values):raise ValueError('Native SII missing managed fields')
    return ''.join(lines)

def patch_xml(content,values):
    # Parse for structure/security, patch only text spans to retain publisher and
    # operator comments, formatting, unknown elements and XML-RPC configuration.
    import xml.etree.ElementTree as ET
    import html
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)',content,re.I):raise ValueError('External XML declarations rejected')
    try:root=ET.fromstring(content)
    except ET.ParseError:raise ValueError('Malformed dedicated XML') from None
    if root.tag!='dedicated':raise ValueError('Wrong dedicated XML root')
    spans=[]
    for section,fields in values.items():
        if len(root.findall(section))!=1:raise ValueError('Duplicate/missing dedicated XML section')
        section_match=list(re.finditer(r'<'+section+r'\s*>[\s\S]*?</'+section+r'\s*>',content))
        if len(section_match)!=1:raise ValueError('Unsupported dedicated XML section')
        part=section_match[0]
        for key,value in fields.items():
            if len(root.findall(section+'/'+key))!=1:raise ValueError('Duplicate/missing dedicated XML field')
            hits=list(re.finditer(r'(<'+key+r'\s*>)([^<]*)(</'+key+r'\s*>)',part[0]))
            if len(hits)!=1:raise ValueError('Unsupported dedicated XML field')
            hit=hits[0];spans.append((part.start()+hit.start(2),part.start()+hit.end(2),html.escape(str(value),quote=False)))
    for start,end,value in sorted(spans,reverse=True):content=content[:start]+value+content[end:]
    return content

@contextlib.contextmanager
def preserve(root):
    state=confined(root,root/'.voltra/truck-trackmania-preserve');state.mkdir(parents=True,exist_ok=True)
    manifest=confined(root,state/'publisher.json');prior=json.loads(manifest.read_text()) if manifest.exists() else {}
    excluded={'.voltra','.steam','steamcmd','steamapps','.cache'}
    files=lambda:[p for p in root.rglob('*') if not any(x in excluded for x in p.relative_to(root).parts) and p.is_file()]
    records=[]
    with tempfile.TemporaryDirectory(dir=state) as temporary:
        for p in files():
            confined(root,p);name=p.relative_to(root).as_posix()
            protected=name.startswith(('.local/share/','UserData/','MatchSettings/')) or p.suffix.lower() in ('.sii','.dat','.cfg','.txt','.xml','.json','.lua')
            if not protected and (p.name in ('TrackmaniaServer','TrackmaniaServer.exe','amtrucks_server','eurotrucks2_server') or prior.get(name)==release.sha256(p)):continue
            info=p.stat();backup=Path(temporary)/str(len(records));shutil.copyfile(p,backup)
            records.append({'path':name,'target':name,'backup':str(backup),'uid':info.st_uid,'gid':info.st_gid,'mode':info.st_mode&0o7777,'atime_ns':info.st_atime_ns,'mtime_ns':info.st_mtime_ns,'link':None})
        try:
            yield
            native.private_write(manifest,json.dumps({p.relative_to(root).as_posix():release.sha256(p) for p in files()}))
        finally:
            restore=helper('source-install').restore_file
            for record in records:restore(root,record)

def install(root,game,env):
    root=Path(root).resolve()
    with preserve(root):
        if game in GAMES:
            app,_,binary=GAMES[game]
            if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Wrong SCS Steam app')
            steam.update(root,app,env,required=('bin/linux_x64/'+binary,))
            return
        if game!='trackmania':raise ValueError('Unknown native recipe')
        with tempfile.TemporaryDirectory(dir=confined(root,root/'.voltra')) as temporary:
            archive=Path(temporary)/'publisher.zip';release.download(TRACKMANIA,archive)
            with zipfile.ZipFile(archive) as z:
                seen=set();total=0
                for entry in z.infolist():
                    parts=PurePosixPath(entry.filename).parts
                    if not parts or entry.filename.startswith('/') or '\\' in entry.filename or any(p in ('..','.') or ':' in p for p in parts):raise ValueError('Unsafe publisher ZIP path')
                    if entry.filename in seen or entry.external_attr>>16&0o170000==0o120000:raise ValueError('Duplicate/symlink ZIP member')
                    seen.add(entry.filename);total+=entry.file_size
                    if total>2*1024**3:raise ValueError('Oversized publisher ZIP')
                for entry in z.infolist():
                    target=confined(root,root/entry.filename)
                    if entry.is_dir():target.mkdir(parents=True,exist_ok=True);continue
                    if target.exists() and entry.filename.startswith(('UserData/','MatchSettings/')):continue
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with z.open(entry) as source,target.open('wb') as output:shutil.copyfileobj(source,output)
            confined(root,root/'TrackmaniaServer').chmod(0o755)
            for target,source in [('UserData/Config/dedicated_cfg.txt','UserData/Config/dedicated_cfg.default.txt'),('MatchSettings/example.txt','UserData/Maps/MatchSettings/example.txt')]:
                target=confined(root,root/target)
                if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(confined(root,root/source),target);target.chmod(0o600)

def configure(root,game,env):
    root=Path(root).resolve();secrets=[]
    if game in GAMES:
        _,folder,binary=GAMES[game];primary,query=ports(env)
        target=confined(root,root/'.local/share'/folder/'server_config.sii')
        if not target.exists():return [str(root/'bin/linux_x64'/binary)],secrets
        token=text(env,'STEAM_TOKEN','',32);secrets.append(token)
        updated=patch_sii(target.read_text(),{'connection_dedicated_port':primary,'query_dedicated_port':query,'server_logon_token':token,'lobby_name':text(env,'LOBBY_NAME',folder,64)})
    elif game=='trackmania':
        target=confined(root,root/'UserData/Config/dedicated_cfg.txt')
        login=text(env,'MASTERSERVER_LOGIN','',30);password=text(env,'MASTERSERVER_PASSWORD','',30);secrets.extend((login,password,text(env,'SERVER_PASSWORD','',30)))
        port=int(env['SERVER_PORT'])
        if not 1<=port<=65535:raise ValueError('Invalid game port')
        updated=patch_xml(target.read_text(),{'masterserver_account':{'login':login,'password':password},'server_options':{'name':text(env,'SERVER_NAME','Trackmania',255),'comment':text(env,'SERVER_COMMENT','',1024),'password':secrets[-1]},'system_config':{'server_port':port}})
        path=text(env,'GAME_CONFIG',r'MatchSettings\example.txt',255).replace('\\','/')
        if Path(path).is_absolute() or '..' in PurePosixPath(path).parts or ':' in path:raise ValueError('Game settings must remain within server')
        confined(root,root/'UserData/Maps'/path)
    else:raise ValueError('Unknown native recipe')
    original=target.read_text()
    if original!=updated:native.private_write(confined(root,root/'.voltra/truck-trackmania-config'/str(time.time_ns())),original);native.private_write(target,updated)
    else:target.chmod(0o600)
    return ([str(root/'TrackmaniaServer'),'/dedicated_cfg=dedicated_cfg.txt','/game_settings='+path,'/noDaemon'] if game=='trackmania' else [str(root/'bin/linux_x64'/GAMES[game][2])]),secrets

def run(root,game,env):
    if game in GAMES and env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install(root,game,env)
    argv,secrets=configure(root,game,env);environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'):environment.pop(key,None)
    environment['HOME']=str(root);environment['XDG_DATA_HOME']=str(root/'.local/share')
    # First boot is the publisher-supported SCS config generation step. It may
    # fail on missing operator exports. Never manufacture those exports.
    code=helper('native-console').run(root,argv,environment,'\x03',secrets,terminal_input=True)
    return code if code>=0 else 128-code

if __name__=='__main__':
    try:
        mode,game=sys.argv[1:3];root=Path.cwd();env=dict(os.environ)
        if mode=='install':install(root,game,env);sys.exit(0)
        if mode=='run':sys.exit(run(root,game,env))
        raise ValueError('Unknown action')
    except (ValueError,OSError,KeyError):print('Native setup failed. Check publisher configuration, allocations, operator packages and dedicated-account prerequisites.',file=sys.stderr);sys.exit(1)
