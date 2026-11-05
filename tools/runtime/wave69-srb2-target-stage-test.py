"""Source-only candidate and emitted-entrypoint fixtures. Run with WSL python3 -B."""
import copy
import difflib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from unittest.mock import patch
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/wave69-srb2-target'
KEY = 'sonic_robo_blast_2/egg-sonic-robo-blast2.json'
CAT = 'internal/panel/game_library/overrides.json'
HELPER = 'internal/panel/game_library/scripts/sonic-rimworld.py'
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda p: json.loads((ROOT / p).read_bytes())
pattern = re.compile(r"cat\s+>\s*(?:\"([^\"\r\n]+\.py)\"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)")

def emitted(script):
    return {(m[1] or m[2] or m[3]): m[5]+'\n' for m in pattern.finditer(script)}

def denied(*a, **kw):
    raise AssertionError('Unmocked external boundary')

def snapshot(root):
    return {str(p.relative_to(root)): [p.lstat().st_mode, os.readlink(p) if p.is_symlink() else sha(p.read_bytes()) if p.is_file() else 'directory'] for p in sorted(root.rglob('*'))}

def main():
    original = (ROOT / CAT).read_bytes()
    review = read('artifacts/game-parity-20261029/helper-copy-review-wave68/review-8/report.json')
    hashes = review['input_hashes'] if 'input_hashes' in review else None
    # Locate the recorded hash objects without depending on report layout.
    def records(value):
        if isinstance(value, dict):
            for k,v in value.items():
                if k in (CAT, HELPER) and isinstance(v, dict) and 'actual' in v: yield k,v
                yield from records(v)
        elif isinstance(value,list):
            for v in value: yield from records(v)
    checked = {}
    for path, rec in records(review):
        actual = sha((ROOT/path).read_bytes())
        assert actual == rec['actual'] == rec['frozen'] == rec['root_snapshot'], path
        checked[path] = actual
    assert set(checked) == {CAT, HELPER}, checked
    source = json.loads(original)[KEY]
    candidate = copy.deepcopy(source)
    script = source['egg']['scripts']['installation']['script']
    modules = emitted(script)
    old = modules['.voltra/sonic_rimworld.py']
    assert sha(old.encode()) == review['entries'][0]['bodySHA256']
    before = "if path.is_symlink() or not path.resolve().is_relative_to(root):raise ValueError('Native data directory escapes the server volume')"
    after = before.replace(':raise', ' or path.exists() and not path.is_dir():raise')
    assert old.count(before) == 1
    new = old.replace(before, after)
    candidate['egg']['scripts']['installation']['script'] = script.replace(old.rstrip('\n'),new.rstrip('\n'))
    changed = emitted(candidate['egg']['scripts']['installation']['script'])
    assert changed.keys() == modules.keys()
    assert all(changed[k] == v for k,v in modules.items() if k != '.voltra/sonic_rimworld.py')
    assert changed['.voltra/sonic_rimworld.py'] == new
    check = copy.deepcopy(candidate); check['egg']['scripts']['installation']['script'] = script
    assert check == source
    results = []
    sys.dont_write_bytecode = True
    with tempfile.TemporaryDirectory(prefix='wave69-srb2-') as temporary:
        fixture = Path(temporary)
        for file, body in modules.items():
            p = fixture/file; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(body.encode())
            compile(body,file,'exec')
        # JSON heredocs are also actual emitted bytes, never current helper replacements.
        for name in ('sonic-rimworld-releases.json','sonic-rimworld-licenses.json'):
            match = re.search(r"cat > \.voltra/"+re.escape(name)+r" <<'([^']+)'\r?\n([\s\S]*?)\r?\n\1",script)
            assert match, name
            (fixture/'.voltra'/name).write_bytes(match[2].encode())
        sys.path.insert(0,str(fixture/'.voltra'))
        def load(name,file):
            spec=importlib.util.spec_from_file_location(name,fixture/'.voltra'/file)
            module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
        with patch.object(subprocess,'Popen',denied), patch.object(subprocess,'run',denied), patch.object(os,'system',denied), patch.object(urllib.request,'urlopen',denied):
            for name in ('steam_template','additional_survival_install','native_console'):load(name,name+'.py')
            for version, body in [('old',old),('patched',new)]:
                (fixture/'.voltra/sonic_rimworld.py').write_bytes(body.encode())
                module=load('wave69_'+version,'sonic_rimworld.py')
                for kind in ('file','directory','missing','symlink-in','symlink-out','dangling','bad-port','bad-name'):
                    with tempfile.TemporaryDirectory(dir=fixture,prefix='root-') as d:
                        root=Path(d);target=root/'SRB2'
                        if kind=='file':target.write_bytes(b'operator owned');target.chmod(0o640)
                        if kind=='directory':target.mkdir();(target/'keep').write_text('keep')
                        if kind.startswith('symlink') or kind=='dangling':
                            dest=root/'inside' if kind=='symlink-in' else fixture/'outside' if kind=='symlink-out' else root/'absent'
                            if kind!='dangling':dest.mkdir(exist_ok=True)
                            target.symlink_to(dest)
                        env=dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010')
                        if kind=='bad-port':env['SERVER_PORT']='28011'
                        if kind=='bad-name':env['SRV_NAME']='bad;quit'
                        initial=snapshot(root); events=[]
                        def download(*a):events.append('acquisition')
                        def make(*a,**kw):
                            assert a[0][0]=='make';events.append('make');raise RuntimeError('controlled make stop')
                        namespace=dict(module.__dict__,__name__='__main__')
                        entry=body[body.index("if __name__=='__main__':"):]
                        previous=Path.cwd()
                        try:
                            os.chdir(root)
                            with patch.dict(os.environ,env,clear=True),patch.object(sys,'argv',['sonic_rimworld.py','install','sonic']),patch.object(module.release,'download',download),patch.object(module.release,'extract',lambda *a:None),patch.object(module.publisher,'extract_zip',lambda *a:None),patch.object(module.publisher,'publish',denied),patch.object(subprocess,'run',make):
                                try:exec(compile(entry,'emitted-entrypoint','exec'),namespace)
                                except (ValueError,RuntimeError) as error:message=str(error)
                                else:raise AssertionError('entrypoint unexpectedly succeeded')
                        finally:os.chdir(previous)
                        reaches = kind in ('directory','missing') or kind=='file' and version=='old'
                        assert events == (['acquisition','acquisition','make'] if reaches else []),(version,kind,events)
                        identical=snapshot(root)==initial
                        if not reaches:assert identical,(version,kind)
                        results.append(dict(version=version,case=kind,events=events,root_identical=identical,result='pass',stop=message))
    assert not Path(temporary).exists()
    assert sha((ROOT/CAT).read_bytes()) == checked[CAT]
    assert sha((ROOT/HELPER).read_bytes()) == checked[HELPER]
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'recipe-fragment.json').write_text(json.dumps({KEY:candidate},indent=2)+'\n')
    (OUT/'helper.diff').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='embedded-before',tofile='embedded-candidate')))
    report=dict(outcome='source_candidate_passed',tests=results,passed=len(results),failures=0,skips=0,input_before=checked,input_after={p:sha((ROOT/p).read_bytes()) for p in checked},emitted_before_sha256=sha(old.encode()),emitted_after_sha256=sha(new.encode()),fragment_sha256=sha((OUT/'recipe-fragment.json').read_bytes()),trigger='Existing regular SRB2 target passed old preflight and reached mocked archive acquisition and make before impossible publication.',preservation='Exact recipe copy except one guard clause in one embedded helper. All other emitted Python bodies, RimWorld branches, nonscript metadata, pins, controls, permissions, revisions and statuses unchanged.',original37statuses='unknown; no historical status files written; selected original runtime_verified field retained without promotion',cleanup='All temporary fixtures removed; no bytecode caches; no real acquisition, compiler, game, publisher or subprocess executed.',adoption_contract='Candidate only. Integrator must recheck before hashes and adopt only this recipe fragment under its own canonical-write grant. No canonical files changed.',remaining_native_gaps=['Native build and installation','Protocol and gameplay','Lifecycle and signal behavior','External reachability'])
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(passed=len(results),failures=0,skips=0,report=str(OUT/'report.json'))))

if __name__ == '__main__':main()
