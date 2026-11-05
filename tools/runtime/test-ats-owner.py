"""Offline packaging checks. No network, Docker, publisher process or imports of stagers."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/ats-owner'
recipe='truck-simulator/american-truck-simulator/egg-american-truck-simulator-dedicated-server.json'
profile=json.loads((OUT/'profile-fragment.json').read_text(encoding='utf-8'))[recipe]

class PackagedATS(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name); self.helpers=self.root/'.voltra';self.helpers.mkdir()
  script=profile['egg']['scripts']['installation']['script']
  for name,content in re.findall(r"cat > .voltra/([^ ]+) <<'ATS_SOURCE'\n([\s\S]*?)\nATS_SOURCE\n",script):
   (self.helpers/name).write_text(content,encoding='utf-8')
  self.env={**os.environ,'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','STEAM_TOKEN':'','LOBBY_NAME':'Seed','SRCDS_APPID':'2239530','AUTO_UPDATE':'0','VOLTRA_STEAM_AUTO_UPDATE':'0','STEAM_USER':'anonymous','STEAM_PASS':'','STEAM_AUTH':'','SRCDS_BETAPASS':''}
 def tearDown(self): self.tmp.cleanup()
 def packages(self):
  folder=self.root/'.local/share/American Truck Simulator';folder.mkdir(parents=True)
  for name in ('server_packages.sii','server_packages.dat'): (folder/name).write_bytes(b'offline fixture, not publisher-valid')
  return folder
 def snapshot(self): return {p.relative_to(self.root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()}
 def call(self,env=None):
  return subprocess.run([sys.executable,'-B','-I',str(self.helpers/'ats-native.py'),'preflight'],cwd=self.root,env=env or self.env,capture_output=True)
 def test_packaged_preflight_before_acquisition_no_writes(self):
  self.packages();before=self.snapshot();self.assertEqual(self.call().returncode,0);self.assertEqual(before,self.snapshot())
  script=profile['egg']['scripts']['installation']['script'];self.assertLess(script.index('python3 - preflight'),script.index('apt-get update'))
  self.assertTrue((self.helpers/'steam_template.py').exists())
  # Load the real packaged dependency graph from emitted names in isolation.
  result=subprocess.run([sys.executable,'-B','-I','-c',"import runpy,sys; m=runpy.run_path(sys.argv[1]); m['shared']()",str(self.helpers/'ats-native.py')],cwd=self.root,capture_output=True)
  self.assertEqual(result.returncode,0,result.stderr.decode())
 def test_missing_packages_refuse_without_writes(self):
  before=self.snapshot();self.assertNotEqual(self.call().returncode,0);self.assertEqual(before,self.snapshot())
 def test_invalid_values_refuse_before_writes(self):
  self.packages()
  for key,value in [('LOBBY_NAME','x'*64),('STEAM_TOKEN','invented'),('QUERY_PORT','28000'),('AUTO_UPDATE','yes'),('SRCDS_APPID','270880'),('STEAM_PASS','private'),('SERVER_PORT','0')]:
   before=self.snapshot();self.assertNotEqual(self.call({**self.env,key:value}).returncode,0,key);self.assertEqual(before,self.snapshot())
 def test_native_authority_and_malformed_refusal(self):
  folder=self.packages()
  code="""import runpy,sys
from pathlib import Path
m=runpy.run_path(sys.argv[1]); root=Path.cwd(); env=dict(__import__('os').environ)
target,content,token=m['preflight'](root,env)
content=content.replace('lobby_name: "Seed"','lobby_name: "Operator" // retained').replace('moderator_list: 0','moderator_list: 1\\n moderator_list[0]: 123456')
target.write_text(content,encoding='utf-8')
_,updated,_=m['preflight'](root,{**env,'LOBBY_NAME':'Changed'})
assert 'lobby_name: "Operator" // retained' in updated
assert 'moderator_list[0]: 123456' in updated
assert target.read_text(encoding='utf-8')==content
"""
  result=subprocess.run([sys.executable,'-B','-I','-c',code,str(self.helpers/'ats-native.py')],cwd=self.root,env=self.env,capture_output=True)
  self.assertEqual(result.returncode,0,result.stderr.decode())
  target=folder/'server_config.sii'; original=target.read_text(encoding='utf-8')
  for invalid in [original.replace('max_players: 8','max_players: 9'),original.replace('traffic: true','traffic: true\n traffic: false'),original.replace('traffic: true','Traffic: true'),original+'garbage']:
   target.write_text(invalid,encoding='utf-8');before=self.snapshot();self.assertNotEqual(self.call().returncode,0);self.assertEqual(before,self.snapshot())

if __name__=='__main__': unittest.main()
