"""Stage the exact variant proposal and test its emitted import graph offline."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/stationeers-bepinex-owner'
RECIPE = 'stationeers/stationeers_bepinex/egg-stationeers--bep-in-ex.json'
OUT.mkdir(parents=True, exist_ok=True)
original = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
proposal = json.loads(json.dumps(original))
source = ROOT/'internal/panel/game_library/scripts/stationeers-bepinex-owner.py'
script = proposal['egg']['scripts']['installation']['script']
old = 'PYTHONPATH=.voltra python3 .voltra/stationeers_wurm_starbound_install.py stationeers'
assert script.count(old) == 1
script = script.replace(old, "cat > .voltra/stationeers_bepinex_owner.py <<'VOLTRA_BEPINEX_OWNER'\n" + source.read_text() + "\nVOLTRA_BEPINEX_OWNER\nPYTHONPATH=.voltra python3 .voltra/stationeers_bepinex_owner.py install")
proposal['egg']['scripts']['installation']['script'] = script
proposal['egg']['startup'] = proposal['egg']['startup'].replace('stationeers_wurm_starbound_runtime.py', 'stationeers_bepinex_owner.py')
assert proposal['egg']['variables'] == original['egg']['variables']
(OUT/'profile-proposal.json').write_text(json.dumps({RECIPE:proposal}, indent=2)+'\n')

fixture = r'''
from pathlib import Path
import tempfile
import stationeers_bepinex_owner as owner
import stationeers_wurm_starbound_runtime as runtime
env={'VOLTRA_STATIONEERS_VARIANT':'bepinex','STATIONEERS_MOD_FRAMEWORK':'launchpad'}
with tempfile.TemporaryDirectory() as work:
 root=Path(work)
 # Invalid prerequisite must refuse before shared acquisition or state writes.
 owner.shared_install=lambda *a: (_ for _ in ()).throw(AssertionError('acquired'))
 for bad in ({**env,'STATIONEERS_MOD_FRAMEWORK':'invalid'}, {**env,'VOLTRA_STATIONEERS_VARIANT':'vanilla'}, {**env,'STATIONEERS_MOD_FRAMEWORK':'stationeersmods'}, {**env,'MAX_PLAYERS':'0'}, {**env,'WORLD_NAME':'Space'}, {**env,'AUTOSAVE':'yes'}, {**env,'SAVE_NAME':'../world'}):
  try: owner.install(root,bad)
  except ValueError: pass
  else: raise AssertionError('invalid prerequisites accepted')
  assert list(root.iterdir())==[]
 native=b'<?xml version="1.0"?><Settings><!-- keep --><Unknown><row>1</row><row>2</row></Unknown><ServerPassword>private</ServerPassword></Settings>\r\n'
 (root/'setting.xml').write_bytes(native)
 for name in ('saves/world.save','mods/operator.bin','BepInEx/config/plugin.cfg','modconfig.xml'):
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator\x00bytes')
 before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
 for fail in (False,True):
  def operation(*args):
   (root/'setting.xml').write_text('publisher overwrite')
   (root/'saves/world.save').write_text('changed')
   (root/'mods/new').write_text('publisher new')
   if fail: raise RuntimeError('simulated acquisition failure')
   return {'simulated':True}
  owner.shared_install=operation
  try: owner.install(root,env)
  except RuntimeError:
   assert fail
  for name,data in before.items(): assert (root/name).read_bytes()==data
  assert not (root/'mods/new').exists()
 # Existing XML must not be serialized or overridden by ordinary env defaults.
 owner._configure=lambda *a: (['server','-settings','ServerName','default','GamePort','123','UpdatePort','124','ServerPassword','default'],{},'quit',[],{})
 argv,environment,stop,credentials,options=owner.configure(root,'stationeers',env)
 assert 'private' in credentials
 assert argv==['server','-settings','GamePort','123','UpdatePort','124']
 assert (root/'setting.xml').read_bytes()==native
 # malformed and entity-bearing XML refuse before acquisition without byte changes.
 for data in (b'<broken', b'<!DOCTYPE a><Settings/>'):
  (root/'setting.xml').write_bytes(data)
  owner.shared_install=lambda *a: (_ for _ in ()).throw(AssertionError('acquired'))
  try: owner.install(root,env)
  except (ValueError,owner.ET.ParseError): pass
  else: raise AssertionError('unsafe XML accepted')
  assert (root/'setting.xml').read_bytes()==data
print('PASS emitted imports; prerequisite refusal; XML refusal; boot precedence; success/failure preservation')
'''
with tempfile.TemporaryDirectory() as folder:
 emitted = Path(folder)
 matches = re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2",script,re.S)
 assert matches
 for name,_,body in matches: (emitted/name).write_text(body+'\n')
 (emitted/'fixture.py').write_text(fixture)
 result = subprocess.run([sys.executable,'-I', '-c', "import sys,runpy;sys.path.insert(0,sys.argv[1]);runpy.run_path(sys.argv[1]+'/fixture.py')",str(emitted)],capture_output=True,text=True)
 (OUT/'test-result.json').write_text(json.dumps({'command':'python tools/runtime/stationeers-bepinex-owner-test.py','isolation':'fresh subprocess -I, only exact installer-emitted modules plus fixture','emitted_files':[name for name,_,_ in matches],'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr},indent=2)+'\n')
 print(result.stdout,result.stderr)
 assert result.returncode == 0
