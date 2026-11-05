"""Source-only WSL fixture/stager. No canonical writes or native execution."""
import sys
sys.dont_write_bytecode = True
import os, stat, json, re, hashlib, tempfile, subprocess, copy
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
OUT = BASE/'artifacts/game-parity-20261029/wave71-gta-read-safety'
SOURCE = BASE/'artifacts/game-parity-20261029/wave69-gtac-ragecoop-proof/profiles.pending.json'
PATTERN = re.compile(r"cat\s+>\s*(?:\"([^\"\r\n]+\.py)\"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)")
sha = lambda b: hashlib.sha256(b).hexdigest()
def emit(script):
    return {Path(m[1] or m[2] or m[3]).name:m[5]+'\n' for m in PATTERN.finditer(script)}

HELPER = '''# Match the 8 MiB native-config admission convention; never truncate.
CONFIG_LIMIT = 8 * 1024 * 1024

def read_configuration(root,path,default=None):
    import stat
    root=root.absolute();path=path.absolute()
    if not path.is_relative_to(root):raise ValueError('Configuration escapes volume')
    for part in reversed((path,*path.parents)):
        if part.is_relative_to(root):
            try:info=part.lstat()
            except FileNotFoundError:
                if part==path and default is not None:return default
                raise
            if stat.S_ISLNK(info.st_mode):raise ValueError('Configuration symlink unsupported')
            if part!=path and not stat.S_ISDIR(info.st_mode):raise ValueError('Configuration ancestor is not a directory')
    if not stat.S_ISREG(info.st_mode):raise ValueError('Configuration is not a regular file')
    if info.st_size>CONFIG_LIMIT:raise ValueError('Native configuration exceeds 8 MiB')
    fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        opened=os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode):raise ValueError('Configuration is not a regular file')
        if opened.st_size>CONFIG_LIMIT:raise ValueError('Native configuration exceeds 8 MiB')
        raw=stream.read(CONFIG_LIMIT+1)
    if len(raw)>CONFIG_LIMIT:raise ValueError('Native configuration exceeds 8 MiB')
    # Preserve read_text UTF-8 and universal-newline parsing semantics.
    return raw.decode('utf-8').replace('\\r\\n','\\n').replace('\\r','\\n')

'''

CHILD = r'''
import sys, runpy, os, socket, subprocess, json
sys.dont_write_bytecode=True
from pathlib import Path
from unittest.mock import patch
code,root,result=map(Path,sys.argv[1:])
events=[]
def blocked(*a,**k):
    events.append('forbidden-boundary');raise AssertionError('acquisition/process forbidden')
def console(*a,**k):events.append('mock-console');return 0
import types, importlib.util
spec=importlib.util.spec_from_file_location('native-console',code.with_name('native-console.py'))
mock=types.ModuleType('native-console');mock.run=console
original=importlib.util.module_from_spec
def factory(spec):return mock if spec.name=='native-console' else original(spec)
original_exec=importlib.machinery.SourceFileLoader.exec_module
def execute(loader,module):
    if module is not mock:return original_exec(loader,module)
os.environ.update(VOLTRA_SERVER_ROOT=str(root),SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',SERVER_PASSWORD='managed-secret')
error=None
with patch.object(socket,'socket',blocked),patch.object(socket,'create_connection',blocked),patch.object(subprocess,'Popen',blocked),patch.object(os,'execve',blocked),patch.object(importlib.util,'module_from_spec',factory),patch.object(importlib.machinery.SourceFileLoader,'exec_module',execute):
    try:runpy.run_path(str(code),run_name='__main__')
    except SystemExit as e:
        if e.code:error='SystemExit:'+str(e.code)
    except Exception as e:error=type(e).__name__+':'+str(e)
result.write_text(json.dumps(dict(error=error,events=events)))
'''

def snapshot(root):
    result={}
    def visit(p):
        s=p.lstat();kind=stat.S_IFMT(s.st_mode)
        value={'mode':s.st_mode,'size':s.st_size,'mtime_ns':s.st_mtime_ns}
        if stat.S_ISREG(s.st_mode):value['sha256']=sha(p.read_bytes())
        elif stat.S_ISLNK(s.st_mode):value['target']=os.readlink(p)
        result[str(p.relative_to(root))]=value
        if stat.S_ISDIR(s.st_mode):
            for child in sorted(p.iterdir()):visit(child)
    visit(root);return result

def main():
    assert sys.platform=='linux'
    OUT.mkdir(parents=True,exist_ok=True)
    source=SOURCE.read_bytes();profiles=json.loads(source);staged={};records=[];tests=[]
    inherited=json.loads((SOURCE.parent/'report.json').read_bytes())
    for recipe,profile in profiles.items():
        game='gtac' if '/gtac/' in recipe else 'ragecoop'
        caller=game+'-runtime.py'; filename='server.xml' if game=='gtac' else 'Settings.xml'
        tag='server' if game=='gtac' else 'Settings';port='port' if game=='gtac' else 'Port'
        script=profile['egg']['scripts']['installation']['script'];mods=emit(script);old=mods[caller]
        pin=next(x for x in inherited['recipes'] if x['recipe']==recipe)
        assert {n:sha(s.encode()) for n,s in mods.items()}==pin['emitted_after']
        new=old.replace('def configure(',HELPER+'def configure(',1)
        expression='path.read_text()' if game=='gtac' else "path.read_text() if path.is_file() else '<Settings/>'"
        replacement='read_configuration(root,path)' if game=='gtac' else "read_configuration(root,path,'<Settings/>')"
        assert new.count(expression)==1
        new=new.replace(expression,replacement)
        candidate=copy.deepcopy(profile);candidate['egg']['scripts']['installation']['script']=script.replace(old,new)
        assert script.count(old)==1
        after=emit(candidate['egg']['scripts']['installation']['script'])
        assert all(after[n]==s for n,s in mods.items() if n!=caller)
        restored=copy.deepcopy(candidate);restored['egg']['scripts']['installation']['script']=script;assert restored==profile
        staged[recipe]=candidate
        (OUT/(game+'-runtime.py.pending')).write_bytes(new.encode())
        records.append(dict(recipe=recipe,emitted_before={n:sha(s.encode()) for n,s in mods.items()},emitted_after={n:sha(s.encode()) for n,s in after.items()},final_heredoc_lf=new.endswith('\n'),installation_before=sha(script.encode()),installation_after=sha(candidate['egg']['scripts']['installation']['script'].encode())))
        for variant,body in [('wave69',old),('candidate',new)]:
          for case in ['lf','crlf','bom','missing','fifo','directory','oversize','at-limit','inside-link','outside-link','ancestor-link','bad-utf8','bad-root','entity','duplicate','invalid-port','invalid-type']:
            with tempfile.TemporaryDirectory(prefix='wave71-gta-') as temp:
                tree=Path(temp);root=tree/'volume';root.mkdir();code=root/'.voltra';code.mkdir();folder=root/game;folder.mkdir();path=folder/filename
                for n,s in mods.items():(code/n).write_bytes((body if n==caller else s).encode())
                raw=f'<{tag}>\n<!--operator-->\n<{port}>7777</{port}>\n<Password>operator-secret</Password><Unknown>café</Unknown>\n</{tag}>\n'.encode()
                if case in ['crlf','bom']:raw=raw.replace(b'\n',b'\r\n')
                if case=='bom':raw=b'\xef\xbb\xbf'+raw
                if case in ['oversize','at-limit']:
                    size=8*1024*1024+(case=='oversize');raw=raw.rstrip()+b' '*(size-len(raw.rstrip()))
                if case=='bad-utf8':raw=b'\xff'
                if case=='bad-root':raw=b'<wrong/>'
                if case=='entity':raw=b'<!DOCTYPE server><'+tag.encode()+b'/>'
                if case=='duplicate':raw=f'<{tag}><{port}>1</{port}><{port}>2</{port}></{tag}>'.encode()
                if case=='fifo':os.mkfifo(path)
                elif case=='directory':path.mkdir()
                elif case=='missing':pass
                elif case in ['inside-link','outside-link']:
                    dest=(root if case=='inside-link' else tree)/'operator.xml';dest.write_bytes(raw);path.symlink_to(dest)
                elif case=='ancestor-link':
                    folder.rmdir();dest=root/'operator';dest.mkdir();(dest/filename).write_bytes(raw);folder.symlink_to(dest,target_is_directory=True)
                else:path.write_bytes(raw)
                runner=tree/'child.py';runner.write_text(CHILD);result=tree.parent/(tree.name+'-result.json')
                env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1')
                child=CHILD
                if case=='invalid-port':child=child.replace("SERVER_PORT='28010'","SERVER_PORT='28011'")
                if case=='invalid-type':child=child.replace("SERVER_PASSWORD='managed-secret'","SERVER_PASSWORD='managed-secret',MAX_PLAYERS='bad'")
                runner.write_text(child)
                before=snapshot(tree)
                timed=False
                with subprocess.Popen([sys.executable,str(runner),str(code/caller),str(root),str(result)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True) as proc:
                    try:stdout,stderr=proc.communicate(timeout=3)
                    except subprocess.TimeoutExpired:
                        timed=True;os.killpg(proc.pid,9);stdout,stderr=proc.communicate(timeout=3)
                    assert proc.poll() is not None
                outcome=json.loads(result.read_bytes()) if result.exists() else {'error':'timeout' if timed else stderr.decode(),'events':[]}
                if result.exists():result.unlink()
                final=snapshot(tree);unchanged=before==final
                refusal=case not in ['lf','crlf','bom','at-limit'] and not(case=='missing' and game=='ragecoop')
                if variant=='candidate':
                    assert not timed,(game,case)
                    assert bool(outcome['error'])==refusal,(game,case,outcome)
                    if refusal:assert unchanged and outcome['events']==[],(game,case,outcome)
                if not outcome['error']:
                    import xml.etree.ElementTree as ET
                    config=ET.fromstring(path.read_bytes());assert config.findtext(port)=='28010'
                    if case!='missing':
                        assert config.findtext('Password')=='operator-secret' and config.findtext('Unknown')=='café'
                        backups=list((code/'gta-backups').glob('*'));assert len(backups)==1 and backups[0].read_bytes()==raw
                assert 'forbidden-boundary' not in outcome['events']
                tests.append(dict(game=game,variant=variant,case=case,timed_out=timed,reaped=True,no_write=unchanged,outcome=outcome,before=before,after=final))
            assert not tree.exists()
    assert SOURCE.read_bytes()==source
    (OUT/'candidate-fragments.json').write_text(json.dumps(staged,indent=2,ensure_ascii=False)+'\n')
    report=dict(scope='source-only mocked emitted __main__ entrypoints; no native acceptance',source_sha256=sha(source),records=records,tests=tests,case_count=len(tests),cleanup='All child processes reaped; each isolated fixture tree removed including FIFOs; no spawned native processes; acquisition/process boundaries blocked.',inherited_statuses='Unchanged: no acceptance/status metadata modified; all profile fields except caller heredoc are identical to wave69.',dependencies='Python >=3.9 for existing is_relative_to; Linux/POSIX os.O_NONBLOCK and os.O_NOFOLLOW. Existing emitted gta-runtime.py wave69 writer and native-config.py retained byte-for-byte.',limit='8 MiB, reject rather than truncate; matches assetto-vanilla-native.py and aska-file-authority.py native-config conventions.',residual_race='Ancestor lstat checks and open are separate: concurrent ancestor replacement can redirect open. O_NOFOLLOW protects only final component. After bounded read, unchanged wave69 writer reopens path without bound; concurrent replacement/growth can cause an unbounded read or changed backup. No race-free or crash-atomic claim. Static refusal guaranteed only without concurrent mutation.',integration='Unapplied proposal. Recheck exact wave69 input and emitted before hashes. Adopt only gtac-runtime.py and ragecoop-runtime.py heredoc deltas, retaining final LF. Preserve wave69 gta-runtime writer verbatim, other helpers, startup, metadata and statuses. Do not replace canonical profiles wholesale. Ownership yielded.')
    (OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(dict(cases=len(tests),source_sha256=sha(source),output=str(OUT))))

if __name__=='__main__':main()
