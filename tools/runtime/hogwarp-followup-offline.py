import hashlib,json,re,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/hogwarp-integration-followup'
OUT.mkdir(parents=True,exist_ok=True)
base=ROOT/'internal/panel/game_library/scripts'
names=['steam-template.py','native-config.py','native-console.py','source-install.py','source-next-install.py','tactical-install.py','tactical-runtime.py','publisher-install.py','publisher-runtime.py']
emitted={n.replace('-','_'): (base/n).read_bytes() for n in names}
emitted['hogwarp_owner.py']=(ROOT/'tools/runtime/hogwarp-owner.py').read_bytes()
with tempfile.TemporaryDirectory() as td:
 d=Path(td)
 for n,b in emitted.items(): (d/n).write_bytes(b)
 script=r'''
import os,sys,json,hashlib
from pathlib import Path
from unittest.mock import patch
import hogwarp_owner as h
root=Path(sys.argv[1])/'fixture'; root.mkdir()
pe=bytearray(80);pe[:2]=b'MZ';pe[60:64]=(64).to_bytes(4,'little');pe[64:70]=b'PE\0\0\x64\x86'
(root/'Server.Loader.exe').write_bytes(pe)
(root/'plugins').mkdir();(root/'plugins/private').write_bytes(b'operator-mod')
(root/'save.db').write_bytes(b'operator-save')
cfg=root/'config.json'
original=b'\xef\xbb\xbf{ "ApiKey":"private-fixture", "Port":11778, "Name":"native", "MaxPlayer":4, "unknown":[1.000e2,{"x":true}] }\r\n'
cfg.write_bytes(original)
env={'SERVER_PORT':'11778','VOLTRA_ALLOCATED_PORTS':'11778','API_KEY':'CHANGEME','SERV_NAME':'overwrite-attempt'}
def snapshot():return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
with patch.object(h.platform,'machine',return_value='x86_64'),patch.object(h.shutil,'which',return_value='/fixture/wine'),patch.dict(os.environ,{'DISPLAY':':fixture'}):
 for status in (0,7):
  with patch.object(h,'run',return_value=status) as run:
   assert h.main(root,env)==status
   assert run.call_args.kwargs['ready_marker']==b'Server started on port '
   assert run.call_args.kwargs['credentials']==['private-fixture']
  assert (root/'save.db').read_bytes()==b'operator-save'
  assert (root/'plugins/private').read_bytes()==b'operator-mod'
 seeded=cfg.read_bytes(); assert b'1.000e2' in seeded and seeded.startswith(b'\xef\xbb\xbf')
 assert json.loads(seeded.decode('utf-8-sig'))['Name']=='native'
 assert h.plan(root,env)[1]==seeded
 for bad in (b'{"ApiKey":"one","ApiKey":"two"}',b'{/*comment*/}',b'{"ApiKey":"CHANGEME"}',b'{"ApiKey":"valid","Port":42}',b'{"ApiKey":"valid","port":11778}'):
  cfg.write_bytes(bad);before=snapshot()
  try:h.main(root,env);raise AssertionError('accepted invalid config')
  except ValueError:pass
  assert snapshot()==before
 cfg.write_bytes(original)
 before=snapshot()
 with patch.object(h.platform,'machine',return_value='aarch64'):
  try:h.main(root,env);raise AssertionError('accepted ARM')
  except ValueError:pass
 assert snapshot()==before
print('PASS: isolated emitted imports, seed-once BOM/unknown arrays/numeric bytes, native secret authority, failure refusal, ARM refusal, simulated exits 0/7 save/mod retention; shared supervisor call contract only')
'''
 result=subprocess.run([sys.executable,'-I','-B','-c','import sys;sys.path.insert(0,sys.argv[1]);exec(sys.argv[2])',str(d),script,str(d/'fixture')],capture_output=True,text=True)
 (OUT/'offline-tests.txt').write_text(result.stdout+result.stderr)
 if result.returncode:raise SystemExit(result.stdout+result.stderr)
print(result.stdout)
