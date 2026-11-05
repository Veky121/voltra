"""Extract real installer heredocs and import them in isolated subprocesses."""
import json,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
profiles=json.loads((ROOT/'artifacts/game-parity-20261029/minecraft-imported-consent/profiles.pending.json').read_text())
runner=r'''
import sys,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
module=__import__(sys.argv[2])
with tempfile.TemporaryDirectory() as d:
 root=Path(d)
 secret=root/'operator.secret';secret.write_bytes(b'private fixture bytes')
 for content in (None,b'# operator\r\neula=true\r\n',b'# revoked\neula=false\n'):
  path=root/'eula.txt';path.unlink(missing_ok=True)
  if content is not None:path.write_bytes(content)
  before={p.name:p.read_bytes() for p in root.iterdir()}
  calls=[]
  module._install=lambda *args: calls.append(args) or {'fixture':True}
  for value in ('false','invalid'):
   try:module.install(root,{'EULA_ACCEPTED':value})
   except ValueError:pass
   else:raise AssertionError('revocation bypass')
  assert not calls
  assert {p.name:p.read_bytes() for p in root.iterdir()}==before
  if content and b'eula=true' in content:
   module.install(root,{})
  else:
   try:module.install(root,{})
   except ValueError:pass
   else:raise AssertionError('missing consent')
  module.install(root,{'EULA_ACCEPTED':'true'})
  assert path.read_bytes()==(content if content is not None else b'eula=true\n')
  assert secret.read_bytes()==b'private fixture bytes'
print('PASS emitted imports, missing/refused consent, native true/false, preservation')
'''
for recipe,profile in profiles.items():
 with tempfile.TemporaryDirectory() as d:
  script=profile['egg']['scripts']['installation']['script']
  blocks=re.findall(r"cat > ([^\n ]+) <<'([^']+)'\n(.*?)\n\2",script,re.S)
  assert blocks
  for path,_,body in blocks:
   target=Path(d)/Path(path).name
   target.write_text(body,encoding='utf-8')
  module={'magma':'magma_install','mohist':'mohist_owner','spongeforge':'spongeforge_install'}[recipe.split('/')[2]]
  result=subprocess.run([sys.executable,'-I','-c',runner,d,module],capture_output=True,text=True)
  print(recipe,result.stdout,result.stderr);assert result.returncode==0
