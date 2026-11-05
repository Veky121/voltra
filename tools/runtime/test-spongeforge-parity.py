"""Offline subprocess tests of the actual pending profile's emitted modules."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

RECIPE='minecraft/java/spongeforge/egg-sponge-forge.json'
PROFILE=Path('artifacts/game-parity-20261029/spongeforge-owner/profile.pending.json')
CHILD=r'''
import socket

import spongeforge_install as s
import minecraft_install as mc
import modded_java_install as mod
from pathlib import Path
from unittest.mock import patch
import tempfile
import unittest
socket.socket=lambda *a,**k: (_ for _ in ()).throw(AssertionError('Network forbidden'))
import zipfile
class Checks(unittest.TestCase):
 def test_compatibility(self):
  self.assertEqual(s.compatibility('1.12.2-2860-7.4.8')[1],'1.12.2-14.23.5.2860')
  self.assertEqual(s.compatibility('1.20.6-50.0.22-11.0.0')[1],'1.20.6-50.0.22')
  for value in ('1.20.6-custom','../escape','1.99-123-1.0'):
   with self.assertRaises(ValueError):s.compatibility(value)
 def test_refusal_before_resolution_or_writes(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(s.fork,'resolve',side_effect=AssertionError('metadata')):
   root=Path(tmp)/'absent'
   for env in ({},{'EULA_ACCEPTED':'true','SF_MC_VERSION':'1.20.6-custom'},{'EULA_ACCEPTED':'true','SERVER_JARFILE':'../bad.jar'},{'EULA_ACCEPTED':'true','USE_EXISTING_JAR':'yes'}):
    with self.assertRaises(ValueError):s.install(root,env)
    self.assertFalse(root.exists())
 def test_install_update_and_failure_preserve_operator_bytes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'server';root.mkdir()
   protected={'server.properties':b'# retained\nlevel-name=custom\nunknown=1\n','custom/level.dat':b'world','mods/operator.jar':b'mod','config/sponge/global.conf':b'unknown=1','eula.txt':b'# consent owned\neula=true\n'}
   for name,data in protected.items():
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
   def acquire(release,path,root):
    with zipfile.ZipFile(path,'w') as jar:jar.writestr('META-INF/MANIFEST.MF','Manifest-Version: 1.0\n')
    return 'a'*64
   def install(plan,ready,**kw):
    (ready/'forge.jar').write_bytes(b'forge')
    (ready/'server.properties').write_bytes(b'publisher defaults')
    (ready/'eula.txt').write_bytes(b'eula=true')
   plan={'launch':'-jar forge.jar','java':8}
   env={'EULA_ACCEPTED':'true','SF_MC_VERSION':'1.12.2-2860-7.4.8'}
   with patch.object(s.fork,'acquire',side_effect=acquire),patch.object(mod,'resolve',return_value=plan) as resolve,patch.object(mc,'install',side_effect=install):
    s.install(root,env);s.install(root,env)
    self.assertEqual(resolve.call_args.args[1]['FORGE_VERSION'],'1.12.2-14.23.5.2860')
   with patch.object(mod,'resolve',return_value=plan),patch.object(s.fork,'acquire',side_effect=ValueError('checksum')):
    with self.assertRaisesRegex(ValueError,'checksum'):s.install(root,env)
   for name,data in protected.items():self.assertEqual((root/name).read_bytes(),data)
   with patch.object(s.fork,'resolve',return_value={'version':'1.12.2-2860-7.4.9'}),patch.object(mod,'resolve',side_effect=AssertionError('loader metadata')):
    with self.assertRaisesRegex(ValueError,'previous SpongeForge'):s.install(root,env)
 def test_seed_once_without_implicit_consent(self):
  from minecraft_pack_install import publish
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'root';stage=Path(tmp)/'stage';stage.mkdir()
   (stage/'server.jar').write_bytes(b'fixture');(stage/'server.properties').write_bytes(b'unknown=default')
   (stage/'eula.txt').write_bytes(b'eula=true')
   publish(stage,root,{},'server.jar');(root/'server.properties').write_bytes(b'operator')
   publish(stage,root,{},'server.jar')
   self.assertEqual((root/'server.properties').read_bytes(),b'operator');self.assertFalse((root/'eula.txt').exists())
unittest.main()
'''
script=json.loads(PROFILE.read_text(encoding='utf-8-sig'))[RECIPE]['egg']['scripts']['installation']['script']
with tempfile.TemporaryDirectory(prefix='spongeforge-emitted-') as tmp:
 folder=Path(tmp)
 for name,marker,source in re.findall(r"cat\s+>\s*([^\s]+)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)",script):
  (folder/Path(name).name).write_text(source+'\n',encoding='utf-8-sig' if False else 'utf-8')
 (folder/'checks.py').write_text(CHILD,encoding='utf-8')
 result=subprocess.run([sys.executable,'-B','checks.py'],cwd=folder,capture_output=True,text=True,timeout=90)
 print(result.stdout+result.stderr)
 sys.exit(result.returncode)

