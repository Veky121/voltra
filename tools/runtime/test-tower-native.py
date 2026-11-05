"""Offline tests execute the exact staged installer-emitted module layout."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
REPORT=ROOT/'artifacts/game-parity-20261029/tower-unite-owner'
class TowerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); (self.root/'.voltra').mkdir()
        profile=json.loads((REPORT/'profile-proposal.json').read_text())['tower_unite/egg-tower-unite.json']
        for name, data in re.findall(r"cat > .voltra/(\S+) <<'VOLTRA_TOWER_SOURCE'\n(.*?)\nVOLTRA_TOWER_SOURCE",profile['egg']['scripts']['installation']['script'],re.S):
            (self.root/'.voltra'/name).write_text(data,encoding='utf-8')
        self.env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','SERVER_PORT':'7777','VOLTRA_ALLOCATED_PORTS':'7777,7778,27015','STEAM_LOGIN_TOKEN':'offline-synthetic-token','STEAM_ADMIN_ID':'76561198000000001','AUTO_UPDATE':'0'}
    def run_code(self,code):
        result=subprocess.run([sys.executable,'-c',"import sys;sys.path.insert(0,'.voltra');import tower_native as t;from pathlib import Path;import os;root=Path.cwd();env=dict(os.environ);"+code],cwd=self.root,env=self.env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
    def test_installed_imports_seed_and_native_authority_bom(self):
        self.run_code("t.configure(root,env);p=root/t.CONFIG;b=p.read_bytes();p.write_bytes(b'\\xef\\xbb\\xbf'+b.replace(b'Tower Unite Server',b'Operator Title')+b'\\r\\n[Unknown]\\r\\nArray=a\\r\\nArray=b\\r\\n');before=p.read_bytes();t.configure(root,env);assert p.read_bytes()==before;assert not t.prepare(root,env)[0]['update']")
    def test_ambiguous_native_keys_refuse_without_write(self):
        self.run_code("t.configure(root,env);p=root/t.CONFIG;p.write_bytes(p.read_bytes()+b'\\n[/SCRIPT/TOWERNETWORKING.DEDICATEDSERVEROPTIONS]\\nServerTitle=ambiguous\\n');before=p.read_bytes();\ntry:t.configure(root,env)\nexcept ValueError:pass\nelse:raise AssertionError('accepted ambiguity')\nassert p.read_bytes()==before")
    def test_validation_before_acquisition(self):
        self.env['STEAM_LOGIN_TOKEN']=''
        self.run_code("t.base.install=lambda *a: (_ for _ in ()).throw(AssertionError('acquired'));\ntry:t.install(root,env)\nexcept ValueError:pass\nelse:raise AssertionError('missing token accepted')\nassert not (root/'Tower').exists()")
    def test_update_failure_and_success_restore_saves_mods_and_config(self):
        self.run_code("\nfor name in ['Tower/Saved/state.bin','Tower/Condos/C_Condo/custom.map','Tower/Mods/custom.pak','Tower/Plugins/custom/config.json']:\n p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator\\x00bytes')\nnames=[p for p in (root/'Tower').rglob('*') if p.is_file()];before={p:p.read_bytes() for p in names}\nfor fail in [True,False]:\n def update(*args):\n  for p in names:p.write_bytes(b'depot overwrite')\n  if fail:raise RuntimeError('simulated failure')\n t.base.install=update\n try:t.install(root,env)\n except RuntimeError:\n  assert fail\n assert all(p.read_bytes()==b for p,b in before.items())")
    def test_condo_native_settings_and_arrays_preserved(self):
        self.env.update(TOWER_MODE='condo',TOWER_LOGIN_TOKEN='offline-tower-token')
        self.run_code("p=root/'Tower/Condos/C_Condo/C_Condo.map';p.parent.mkdir(parents=True);p.write_bytes(b'owned export');t.configure(root,env);p=root/t.CONFIG;b=p.read_bytes().replace(b'CondoAutoSave = True',b'CondoAutoSave = False');p.write_bytes(b);t.configure(root,env);assert p.read_bytes()==b;assert '-nosteamclient' in t.prepare(root,env)[0]['args']")
if __name__=='__main__':unittest.main(verbosity=2)
