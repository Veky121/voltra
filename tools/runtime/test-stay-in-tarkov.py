"""Offline only. Extract actual emitted module names into isolated subprocesses."""
import json, pathlib, re, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/stay-in-tarkov-owner'
class Emitted(unittest.TestCase):
 def test_emitted(self):
  profile=json.loads((OUT/'profile.pending.json').read_text())['eft/egg-stay-in-tarkov.json']
  canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['eft/egg-stay-in-tarkov.json']
  self.assertEqual(profile['egg']['variables'],canonical['egg']['variables'])
  script=profile['egg']['scripts']['installation']['script']
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp)
   for name,marker,body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2",script,re.S):
    (base/name).write_text(body,encoding='utf-8')
   code=r'''
import pathlib, tempfile, unittest, json, os
from unittest.mock import patch
import stay_in_tarkov as s
ACK={'ACKNOWLEDGE_LEGACY_PREREQUISITES':'true','SERVER_PORT':'6969'}
class Tests(unittest.TestCase):
 def test_refusal(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d)
   for env in ({},dict(ACK,SERVER_PORT='0'),ACK):
    with self.assertRaises(ValueError): s.install(root,env)
    self.assertEqual(list(root.iterdir()),[])
 def test_native_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d); p=root/'Aki_Data/Server/configs/http.json';p.parent.mkdir(parents=True)
   raw=b'\xef\xbb\xbf{ "ip":"127.0.0.1", "port":6969,"secret":"keep","unknown":[1,1,{"x":2}]}\r\n'
   p.write_bytes(raw);s.configuration(root,ACK);self.assertEqual(p.read_bytes(),raw)
   with self.assertRaises(ValueError):s.configuration(root,dict(ACK,SERVER_PORT='6970'))
   self.assertEqual(p.read_bytes(),raw)
   for bad in (b'{"port":6969,"port":6969}', b'{/*comment*/"port":6969}'):
    p.write_bytes(bad)
    with self.assertRaises(ValueError):s.configuration(root,ACK)
    self.assertEqual(p.read_bytes(),bad)
 def test_elf(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'binary'; h=bytearray(20);h[:6]=b'\x7fELF\x02\x01';h[18]=62;p.write_bytes(h);s.elf(p)
   h[18]=183;p.write_bytes(h)
   with self.assertRaises(ValueError):s.elf(p)
 def test_simulated_publication(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);stage=root/'stage';stage.mkdir()
   for name in ('Aki.Server.exe','user/profiles/save.json','user/mods/custom/config.json','Aki_Data/Server/configs/http.json'):
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator')
    q=stage/name;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(b'new')
   before={p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file() and not p.is_relative_to(stage)}
   def publish(root,name,writer,mode):
    import io
    out=io.BytesIO();writer(out);p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(out.getvalue())
   original=s.legacy.write_json
   with patch.object(s.legacy,'_publish',publish),patch.object(s.legacy,'write_json',side_effect=ValueError('simulated receipt failure')):
    with self.assertRaises(ValueError):s.legacy.publish_tree(root,stage,{'game':'sit'},'Aki.Server.exe')
   for n,b in before.items():self.assertEqual((root/n).read_bytes(),b)
   with patch.object(s.legacy,'_publish',publish):s.legacy.publish_tree(root,stage,{'game':'sit'},'Aki.Server.exe')
   for n,b in before.items():
    if n!='Aki.Server.exe':self.assertEqual((root/n).read_bytes(),b)
unittest.main()
'''
   result=subprocess.run([sys.executable,'-I','-c','import sys;sys.path.insert(0,'+repr(str(base))+');'+code],capture_output=True,text=True)
   (OUT/'isolated-tests.txt').write_text(result.stdout+result.stderr)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
if __name__=='__main__':unittest.main()
