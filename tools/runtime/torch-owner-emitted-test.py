import json,re,tempfile,subprocess,os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
p=Path('artifacts/game-parity-20261029/torch-owner')
profile=next(iter(json.loads((p/'profiles.json').read_text()).values()))
script=profile['egg']['scripts']['installation']['script']
with tempfile.TemporaryDirectory() as d:
 for name,body in re.findall(r"cat > .voltra/([^ ]+) <<'VOLTRA_VANILLA_SOURCE'\n(.*?)\nVOLTRA_VANILLA_SOURCE",script,re.S):
  Path(d,name).write_text(body,encoding='utf-8')
 r=subprocess.run([sys.executable,'tools/runtime/torch-owner-test.py','-v'],env={**os.environ,'TORCH_EMITTED':d,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True)
 (p/'tests.txt').write_text(r.stdout+r.stderr)
 print(r.stdout+r.stderr);sys.exit(r.returncode)
