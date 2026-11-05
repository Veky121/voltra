"""Stage the exact variant proposal and test its emitted import graph offline."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/stationeers-bepinex-runtime'
RECIPE = 'stationeers/stationeers_bepinex/egg-stationeers--bep-in-ex.json'
OUT.mkdir(parents=True, exist_ok=True)
original = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
proposal = json.loads(json.dumps(original))
source = ROOT/'internal/panel/game_library/scripts/stationeers-bepinex-owner.py'
script = proposal['egg']['scripts']['installation']['script']
# Refresh only this unapplied fragment from current shared helper sources.
pattern = r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2"
def refresh(match):
 name, delimiter, body = match.groups()
 candidate = ROOT/'internal/panel/game_library/scripts'/name.replace('_', '-')
 if candidate.is_file(): body = candidate.read_text().rstrip('\n')
 return f"cat > .voltra/{name} <<'{delimiter}'\n{body}\n{delimiter}"
script = re.sub(pattern, refresh, script, flags=re.S)
old = 'PYTHONPATH=.voltra python3 .voltra/stationeers_wurm_starbound_install.py stationeers'
if script.count(old) == 1:
 script = script.replace(old, "cat > .voltra/stationeers_bepinex_owner.py <<'VOLTRA_BEPINEX_OWNER'\n" + source.read_text() + "\nVOLTRA_BEPINEX_OWNER\nPYTHONPATH=.voltra python3 .voltra/stationeers_bepinex_owner.py install")
else:
 assert script.count('PYTHONPATH=.voltra python3 .voltra/stationeers_bepinex_owner.py install') == 1
 assert len(re.findall(r"cat > \.voltra/stationeers_bepinex_owner.py <<", script)) == 1
proposal['egg']['scripts']['installation']['script'] = script
proposal['egg']['startup'] = proposal['egg']['startup'].replace('stationeers_wurm_starbound_runtime.py', 'stationeers_bepinex_owner.py')
assert proposal['egg']['variables'] == original['egg']['variables']
(OUT/'profile-proposal.json').write_text(json.dumps({RECIPE:proposal}, indent=2)+'\n')

fixture = (ROOT/'tools/runtime/stationeers-bepinex-runtime-fixture.py').read_text()
with tempfile.TemporaryDirectory() as folder:
 emitted = Path(folder)
 matches = re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2",script,re.S)
 assert matches
 for name,_,body in matches: (emitted/name).write_text(body+'\n')
 (emitted/'fixture.py').write_text(fixture)
 result = subprocess.run([sys.executable,'-I', '-c', "import sys,runpy;sys.path.insert(0,sys.argv[1]);runpy.run_path(sys.argv[1]+'/fixture.py')",str(emitted)],capture_output=True,text=True)
 (OUT/'test-result.json').write_text(json.dumps({'command':'python tools/runtime/stationeers-bepinex-runtime-test.py','isolation':'fresh subprocess -I, only exact installer-emitted modules plus fixture','emitted_files':[name for name,_,_ in matches],'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr},indent=2)+'\n')
 print(result.stdout,result.stderr)
 assert result.returncode == 0

(OUT/'emitted-hashes.json').write_text(json.dumps({name:hashlib.sha256((body+'\n').encode()).hexdigest() for name,_,body in matches},indent=2)+'\n')
