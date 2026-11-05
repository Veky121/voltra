"""Offline emitted-profile regression; never executes the shell installer."""
import hashlib, json, pathlib, re, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/krypton-owner'
RECIPE='minecraft/java/krypton/egg-krypton.json'

def stage():
    profile=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
    script=profile['egg']['scripts']['installation']['script']
    pattern=r"(cat > \.voltra/krypton_config.py <<'VOLTRA_FORK_SOURCE'\n).*?(\nVOLTRA_FORK_SOURCE)"
    script=script.replace('\r\n','\n').replace('\r','\n')
    replacement=(ROOT/'internal/panel/game_library/scripts/krypton-config.py').read_text().rstrip()
    script,count=re.subn(pattern,lambda m:m[1]+replacement+m[2],script,flags=re.S)
    if count!=1: raise ValueError('Expected exactly one emitted Krypton config helper')
    profile['egg']['scripts']['installation']['script']=script
    (OUT/'profile.pending.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
    return script

class EmittedTests(unittest.TestCase):
    def test_isolated_emitted_module(self):
        script=stage()
        with tempfile.TemporaryDirectory(prefix='krypton-emitted-') as directory:
            root=pathlib.Path(directory)
            modules=re.findall(r"cat > \.voltra/([^ /]+) <<'VOLTRA_FORK_SOURCE'\n(.*?)\nVOLTRA_FORK_SOURCE",script,re.S)
            self.assertGreater(len(modules),10)
            for name,body in modules: (root/name).write_text(body+'\n')
            runner=root/'runner.py'
            runner.write_text('''import sys, pathlib, tempfile
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import krypton_config as k
calls=[]
def run(args,where,env,timeout):
    calls.append(args)
    (where/'config.conf').write_bytes(b'# publisher default\\nserver { port=25565 }\\n')
k.run_phase=run
with tempfile.TemporaryDirectory() as d:
    r=pathlib.Path(d); jar=r/'pinned.jar';jar.write_bytes(b'fixture')
    java=pathlib.Path(sys.executable)
    occupied=r/'occupied';occupied.mkdir();(occupied/'operator').write_bytes(b'keep')
    for j,v,s in [(r/'absent.jar',java,r/'missing'),(jar,r/'absent-java',r/'missing'),(jar,java,occupied)]:
        try:k.generate(j,v,s)
        except (ValueError,FileNotFoundError):pass
        else:raise AssertionError('invalid preflight accepted')
    assert not calls and not (r/'missing').exists()
    assert (occupied/'operator').read_bytes()==b'keep'
    result=k.generate(jar,java,r/'new')
    assert result.read_bytes().startswith(b'# publisher')
    assert calls[0][-1]=='--init' and len(calls)==1
    def failed(*args,**kwargs):raise RuntimeError('init failed')
    k.run_phase=failed
    try:k.generate(jar,java,r/'failed')
    except RuntimeError:pass
    else:raise AssertionError('initialization failure swallowed')
    assert (occupied/'operator').read_bytes()==b'keep'
print('emitted config module: preflight, initialization, failure preservation passed')
''')
            result=subprocess.run([sys.executable,'-I',str(runner)],cwd=root,text=True,capture_output=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            (OUT/'emitted-test.log').write_text(result.stdout+result.stderr)

if __name__=='__main__':unittest.main()
