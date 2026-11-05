"""Source-only emitted-caller proof. Run with WSL Python; no native execution."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, re, tempfile, types, socket, subprocess, os
from pathlib import Path
from unittest.mock import patch
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parents[2]
OUT = BASE/'artifacts/game-parity-20261029/wave69-gtac-ragecoop-proof'
RECIPES = ['gta/gtac/egg-grand-theft-auto-connected.json', 'gta/ragecoop/egg-rage-c-o-o-p.json']
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return (BASE/p).read_bytes()
def emit(script):
    pattern = r"cat\s+>\s*(?:\"([^\"\r\n]+\.py)\"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)"
    return {Path(m[1] or m[2] or m[3]).name: m[5]+'\n' for m in re.finditer(pattern, script)}

def main():
    assert sys.platform == 'linux', 'Isolated WSL fixtures required'
    OUT.mkdir(parents=True, exist_ok=True)
    checkpoint=json.loads(read('artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json'))
    frozen={x['path']:x['sha256'] for x in checkpoint}
    paths=['internal/panel/game_library/overrides.json','tools/runtime/embedded-python.mjs']
    paths += ['internal/panel/game_library/scripts/'+n+'.py' for n in ['gtac-runtime','ragecoop-runtime','gta-runtime','native-config','gtac-install','ragecoop-install']]
    before={p:sha(read(p)) for p in paths}
    assert all(p in frozen and frozen[p]==h for p,h in before.items()), 'Checkpoint drift'
    catalog=json.loads(read(paths[0])); candidates={}; records=[]; tests=[]
    def check(name, condition):
        tests.append({'name':name,'passed':bool(condition)})
        assert condition,name
    for recipe in RECIPES:
        profile=catalog[recipe]; script=profile['egg']['scripts']['installation']['script']; modules=emit(script)
        old=modules['gta-runtime.py']
        assert sha(old.encode())=='a9d7d6c1c665abd2c545a9f285b96d280a56290d2f9cade63be1e6a7a09d2427'
        # Preserve the older body; amend only proven backup-byte and symlink-write behavior.
        guard="if not path.resolve().is_relative_to(root):raise ValueError('Configuration escapes volume')"
        assert old.count(guard)==1
        fixed=old.replace(guard,"if not path.resolve().is_relative_to(root) or any(p.is_symlink() for p in (path,*path.parents) if p.is_relative_to(root)):raise ValueError('Configuration escapes volume')")
        start=fixed.index('def write_config('); end=fixed.index('\ndef ',start+1)
        writer=fixed[start:end]; assert writer.count('path.read_text()')==2
        fixed=fixed[:start]+writer.replace('path.read_text()',"path.read_bytes().decode('utf-8')")+fixed[end:]
        staged=json.loads(json.dumps(profile))
        # One literal heredoc body only, including the exact emitted final LF.
        assert script.count(old)==1
        staged['egg']['scripts']['installation']['script']=script.replace(old,fixed)
        candidates[recipe]=staged
        newmods=emit(staged['egg']['scripts']['installation']['script'])
        check(recipe+' untouched other emitted helpers',all(newmods[n]==s for n,s in modules.items() if n!='gta-runtime.py'))
        a=json.loads(json.dumps(staged)); a['egg']['scripts']['installation']['script']=script
        check(recipe+' all nonscript metadata identical',a==profile)
        caller='gtac-runtime.py' if '/gtac/' in recipe else 'ragecoop-runtime.py'
        folder,filename,tag,port=('gtac','server.xml','server','port') if '/gtac/' in recipe else ('ragecoop','Settings.xml','Settings','Port')
        records.append({'recipe':recipe,'profile_before_sha256':sha(json.dumps(profile,sort_keys=True).encode()),'profile_after_sha256':sha(json.dumps(staged,sort_keys=True).encode()),'startup':profile['egg']['startup'],'startup_sha256':sha(profile['egg']['startup'].encode()),'installation_before_sha256':sha(script.encode()),'installation_after_sha256':sha(staged['egg']['scripts']['installation']['script'].encode()),'emitted_before':{n:sha(s.encode()) for n,s in modules.items()},'emitted_after':{n:sha(s.encode()) for n,s in newmods.items()},'emitted_final_lf':all(s.endswith('\n') for s in newmods.values()),'old_writer':old[start:old.index('\ndef ',start+1)],'candidate_writer':fixed[start:fixed.index('\ndef ',start+1)]})
        for version,body in [('old',old),('candidate',fixed)]:
            with tempfile.TemporaryDirectory(prefix='wave69-gtac-ragecoop-') as temp:
                root=Path(temp); code=root/'.voltra'; code.mkdir()
                for n,s in modules.items(): (code/n).write_bytes(s.encode())
                (code/'gta-runtime.py').write_bytes(body.encode())
                # Import actual emitted text at its emitted path; __main__ never executes.
                m=types.ModuleType(caller);m.__file__=str(code/caller)
                exec(compile(modules[caller],m.__file__,'exec'),m.__dict__)
                env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010'}
                target=root/folder/filename;target.parent.mkdir()
                for bom,newline in [(b'',b'\n'),(b'',b'\r\n'),(b'\xef\xbb\xbf',b'\r\n')]:
                    raw=bom+b'<'+tag.encode()+b'>'+newline+b'<!--operator-->'+newline+b'<'+port.encode()+b'>7777</'+port.encode()+b'>'+newline+b'<Unknown>keep</Unknown>'+newline+b'</'+tag.encode()+b'>'+newline
                    target.write_bytes(raw)
                    backups=root/'.voltra/gta-backups'
                    prior=set(backups.glob('*')) if backups.exists() else set()
                    m.configure(root,env)
                    created=set(backups.glob('*'))-prior;check(f'{recipe} {version} single backup {bom!r} {newline!r}',len(created)==1)
                    backup=created.pop().read_bytes(); expected=raw if version=='candidate' else raw.replace(b'\r\n',b'\n')
                    check(f'{recipe} {version} backup bytes {bom!r} {newline!r}',backup==expected)
                    check(f'{recipe} {version} unknown and managed port',ET.fromstring(target.read_bytes()).findtext('Unknown')=='keep' and ET.fromstring(target.read_bytes()).findtext(port)=='28010')
                previous=target.read_bytes()
                try: m.configure(root,{**env,'SERVER_PORT':'28011'})
                except ValueError: pass
                else: raise AssertionError('Unallocated port accepted')
                check(recipe+version+' invalid port leaves config',target.read_bytes()==previous)
                # Directory symlink within volume: valid XML reads; old writer mutates safe sentinel.
                target.unlink();target.parent.rmdir(); sentinel=root/'operator';sentinel.mkdir();target.parent.symlink_to(sentinel,target_is_directory=True)
                actual=sentinel/filename;actual.write_bytes(raw)
                try: m.configure(root,env)
                except ValueError:
                    check(recipe+version+' symlink rejection only candidate',version=='candidate' and actual.read_bytes()==raw)
                else: check(recipe+version+' symlink old writes sentinel',version=='old' and actual.read_bytes()!=raw)
    after={p:sha(read(p)) for p in paths};check('all comparison inputs unchanged',before==after)
    (OUT/'profiles.pending.json').write_text(json.dumps(candidates,indent=2)+'\n')
    report={'scope':'source only; controlled WSL temp fixtures; actual emitted callers; no native/ABI acceptance','comparison_inputs':{p:{'before':h,'after':after[p],'green_checkpoint':frozen[p]} for p,h in before.items()},'recipes':records,'tests':tests,'passed':len(tests),'failed':0,'skips':['No FIFO opened: callers read before writer and no bounded refusal exists.','No native engine/ABI, publisher, acquisition, process, or gameplay checks.'],'findings':['Both actual callers lose CRLF backup bytes during valid allocated-port update. BOM survives backup but CRLF does not. Candidate uses UTF-8 byte decode with existing private_write newline="".','Both callers allow an in-volume directory symlink to redirect managed configuration writes. Candidate rejects symlink paths in writer before publication; wrappers still read first.','Size and nonregular read safety remain unresolved at caller layer. Writer-only guards cannot bound the prior read. No unsupported claim that current wrappers compensate.'],'ownership':'Managed XML values remain caller-owned; Unknown/operator values preserved semantically by existing XML editor. Backup must preserve complete original bytes; candidate does not claim active XML lexical preservation. No managed/seed ownership changes.','original37statuses':'unknown: not independently inventoried; protected source inputs unchanged and no status files written','cleanup':'All fixtures TemporaryDirectory context-cleaned; bytecode disabled; no background commands.','adoption_contract':'UNAPPLIED. Integrator must require original profile/script/helper hashes, merge only gta-runtime write_config body changes into each exact recipe, preserve every other helper and all nonscript metadata, rerun fixtures against merged output. Do not replace whole profiles over concurrent work. No revision/status/permission/default changes.','remaining_gaps':['Caller reads precede writer validation, including potential FIFO blocking and unbounded XML parsing. No FIFO opened.','No race-hardening or multi-file crash atomicity claim.','Native engine, ABI, real installer, live startup and gameplay remain unverified.']}
    report['development_failures']=['First driver attempt refused before fixture execution because it assumed VOLTRA_SOURCE as the heredoc delimiter. Removed delimiter assumption and used the uniquely matched exact emitted body; subsequent run passed.']
    report['trace']={
        'gtac':'startup -> .voltra/gtac-runtime.py run -> configure -> managed_values -> emitted gta-runtime allocated/text/number -> write_config -> emitted native-config private_write. configure reads XML first; install uses gtac-install.py, not shared openmp/mtasa configure.',
        'ragecoop':'startup -> .voltra/ragecoop-runtime.py run -> configure -> emitted gta-runtime allocated/text/number -> write_config -> emitted native-config private_write. configure resolves containment then is_file/read_text first; validate_only suppresses publication but startup uses default false. install uses ragecoop-install.py.',
        'guards':'GTAC rejects XML entity declarations, wrong root, duplicate managed elements and invalid managed values. RAGECOOP additionally checks resolved containment; in-volume symlink passes it. Neither caller bounds size or rejects symlink ancestors before read. Directory symlink counterexamples use valid parseable XML and allocated ports.'}
    report['execution_boundary']='Only configure was invoked, never run/install. All emitted modules compiled/imported by configure are actual extracted bodies with final LF. Native-config private_write is the existing emitted pure filesystem helper. Socket, Popen, system and execve refused globally; no acquisition or publisher modules invoked. Fixtures exist only in Linux TemporaryDirectory, no /home/container access.'
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':len(tests),'failed':0,'report':str(OUT/'report.json')}))

if __name__=='__main__':
    with patch.object(socket,'socket',side_effect=AssertionError('network forbidden')),patch.object(subprocess,'Popen',side_effect=AssertionError('process forbidden')),patch.object(os,'system',side_effect=AssertionError('shell forbidden')),patch.object(os,'execve',side_effect=AssertionError('exec forbidden')):
        main()
