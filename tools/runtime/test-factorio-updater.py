"""Fixture coverage for the adapted updater. Does not authenticate to the mod portal.

Run: python3 test-factorio-updater.py path/to/factorio-update-mods.sh
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

if 'UPDATER' not in globals():
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python test-factorio-updater.py path/to/factorio-update-mods.sh')
    UPDATER = Path(sys.argv.pop(1)).read_text()

FAKE_CURL = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:];root=Path(os.environ['FIXTURE_ROOT'])
with open(root/'http-calls.txt','a') as log:log.write(('download' if '--config' in args else args[-1])+'\\n')
if '--config' in args:
 config=sys.stdin.read()
 assert 'privateFixtureToken' not in ' '.join(args)
 url=config.split('url = "',1)[1].split('"',1)[0]
 name=url.split('?',1)[0].rsplit('/',1)[1]
 body=(root/(name+'.payload')).read_bytes()
 out=args[args.index('-o')+1];Path(out).write_bytes(body)
 print(os.environ.get('FIXTURE_HTTP','200'),end='')
else:
 name=args[-1].split('/api/mods/')[1].split('/')[0]
 p=root/(name+'.json')
 if not p.exists():sys.exit(22)
 print(p.read_text())
'''

class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='voltra-modupdate-test-')
        self.root = Path(self.temp.name)
        self.mods = self.root/'mods'
        self.mods.mkdir()
        self.bin = self.root/'bin'
        self.bin.mkdir()
        (self.bin/'curl').write_text(FAKE_CURL)
        (self.bin/'curl').chmod(0o755)
        self.script = self.root/'updater.sh'
        self.script.write_text(UPDATER)
        self.env = dict(os.environ, PATH=str(self.bin)+os.pathsep+os.environ['PATH'], FIXTURE_ROOT=str(self.root), SERVER_USERNAME='fixture', SERVER_TOKEN='privateFixtureToken')
        self.list(['base','sample'])
        (self.mods/'sample_0.1.0.zip').write_bytes(b'previous working mod')
        self.release('sample')

    def tearDown(self):
        self.temp.cleanup()

    def list(self, names):
        (self.mods/'mod-list.json').write_text(json.dumps({'mods':[{'name':n,'enabled':True} for n in names]}))

    def release(self, name, version='1.0.0', deps=None, branch='2.0', extra=None):
        payload=(name+version).encode()
        (self.root/(name+'.payload')).write_bytes(payload)
        release={'file_name':name+'_'+version+'.zip','download_url':'/download/'+name,'sha1':hashlib.sha1(payload).hexdigest(),'version':version,'released_at':'2026-01-01','info_json':{'factorio_version':branch,'dependencies':deps or ['base >= 2.0.0']}}
        (self.root/(name+'.json')).write_text(json.dumps({'name':name,'releases':[release]+(extra or [])}))
        return release

    def snapshot(self):
        return {p.name:p.read_bytes() for p in self.mods.iterdir() if p.is_file()}

    def run_update(self):
        return subprocess.run(['bash',str(self.script),getattr(self,'game_version','2.0.77'),str(self.mods)],env=self.env,capture_output=True,text=True,timeout=20)

    def recycler_builtin(self, version='2.1.23'):
        self.game_version=version
        target=self.root/'data/recycler/info.json'
        target.parent.mkdir(parents=True)
        target.write_text(json.dumps({'name':'recycler','version':version,'factorio_version':'.'.join(version.split('.')[:2])}))

    def test_recycler_enabled_builtin_no_credentials_or_http(self):
        self.recycler_builtin()
        self.list(['base','recycler'])
        self.env['SERVER_USERNAME']='';self.env['SERVER_TOKEN']=''
        before=self.snapshot();result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(before,self.snapshot())
        self.assertFalse((self.root/'http-calls.txt').exists())

    def test_recycler_required_builtin_dependency(self):
        self.recycler_builtin()
        self.release('sample',branch='2.1',deps=['base >= 2.1.0','recycler >= 2.1.0'])
        result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn({'name':'recycler','enabled':True},json.loads((self.mods/'mod-list.json').read_text())['mods'])
        self.assertNotIn('/api/mods/recycler', (self.root/'http-calls.txt').read_text())

    def test_recycler_missing_2_0_or_mismatched_builtin_denied(self):
        for version, metadata in [('2.0.77',None),('2.0.77','2.0.77'),('2.1.23',None),('2.1.23','2.1.22')]:
            with self.subTest(version=version,metadata=metadata):
                self.game_version=version
                self.list(['base','recycler'])
                info=self.root/'data/recycler/info.json'
                if info.exists():info.unlink()
                if metadata:
                    info.parent.mkdir(parents=True,exist_ok=True)
                    info.write_text(json.dumps({'name':'recycler','version':metadata,'factorio_version':'.'.join(metadata.split('.')[:2])}))
                before=self.snapshot();result=self.run_update()
                self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertEqual(before,self.snapshot())
                self.assertFalse((self.root/'http-calls.txt').exists())

    def test_recycler_requirement_and_branch_mismatch_preserve_mods(self):
        self.recycler_builtin()
        for branch, dependency in [('2.1','recycler >= 2.2.0'),('2.0','recycler >= 2.1.0')]:
            with self.subTest(branch=branch,dependency=dependency):
                self.release('sample',branch=branch,deps=[dependency])
                self.assert_preserved_failure()

    def assert_preserved_failure(self):
        before=self.snapshot()
        result=self.run_update()
        self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(self.snapshot(),before)
        self.assertNotIn('privateFixtureToken',result.stdout+result.stderr)

    def test_success_keeps_backup_and_installs_required_dependency(self):
        self.release('sample',deps=['base >= 2.0.0','library >= 1.0.0','? optional >= 1.0.0'])
        self.release('library')
        result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertTrue((self.mods/'sample_1.0.0.zip').exists())
        self.assertTrue((self.mods/'library_1.0.0.zip').exists())
        self.assertFalse((self.mods/'sample_0.1.0.zip').exists())
        self.assertIn({'name':'library','enabled':True},json.loads((self.mods/'mod-list.json').read_text())['mods'])
        backups=list((self.root/'.voltra/mod-backups').iterdir())
        self.assertEqual((backups[0]/'sample_0.1.0.zip').read_bytes(),b'previous working mod')

    def test_failed_auth_preserves_all_old_files(self):
        self.env['FIXTURE_HTTP']='403'
        self.assert_preserved_failure()

    def test_bad_checksum_preserves_all_old_files(self):
        (self.root/'sample.payload').write_bytes(b'corrupt download')
        self.assert_preserved_failure()

    def test_missing_credentials_preserves_all_old_files(self):
        self.env['SERVER_TOKEN']=''
        self.assert_preserved_failure()

    def test_missing_dependency_metadata_preserves_old_files(self):
        self.release('sample',deps=['missing >= 1.0.0'])
        self.assert_preserved_failure()

    def test_other_factorio_branch_is_rejected(self):
        self.release('sample',branch='1.1')
        self.assert_preserved_failure()

    def test_future_factorio_branch_is_rejected(self):
        self.release('sample',branch='2.1')
        self.assert_preserved_failure()

    def test_base_minimum_above_installed_game_is_rejected(self):
        self.release('sample',deps=['base >= 2.0.99'])
        self.assert_preserved_failure()

    def test_dependency_conflict_is_rejected(self):
        self.list(['base','sample','other'])
        self.release('sample',deps=['library >= 2.0.0'])
        self.release('other',deps=['library < 2.0.0'])
        self.release('library',version='2.0.0')
        self.assert_preserved_failure()

    def test_ignored_mod_stays_unchanged(self):
        self.env['MOD_UPDATE_IGNORE']='sample'
        before=self.snapshot()
        result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(before,self.snapshot())

    def test_pinned_dependency_conflict_keeps_everything(self):
        self.env['MOD_UPDATE_IGNORE']='library'
        (self.mods/'library_0.1.0.zip').write_bytes(b'pinned library')
        self.release('sample',deps=['library >= 1.0.0'])
        self.release('library')
        self.assert_preserved_failure()

    def test_pinned_compatible_dependency_is_not_updated(self):
        self.env['MOD_UPDATE_IGNORE']='library'
        (self.mods/'library_1.0.0.zip').write_bytes(b'pinned library')
        self.release('sample',deps=['library >= 1.0.0'])
        self.release('library',version='2.0.0')
        result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual((self.mods/'library_1.0.0.zip').read_bytes(),b'pinned library')
        self.assertFalse((self.mods/'library_2.0.0.zip').exists())

    def test_incompatible_enabled_mod_is_rejected(self):
        self.list(['base','sample','other'])
        self.release('sample',deps=['! other'])
        self.assert_preserved_failure()

    def test_required_builtin_is_enabled_without_portal_download(self):
        self.release('sample',deps=['quality >= 2.0.0'])
        result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn({'name':'quality','enabled':True},json.loads((self.mods/'mod-list.json').read_text())['mods'])

    def test_conflict_with_later_required_dependency_is_rejected(self):
        self.list(['base','sample','other'])
        self.release('sample',deps=['! library'])
        self.release('other',deps=['library >= 1.0.0'])
        self.release('library')
        self.assert_preserved_failure()

    def test_builtin_and_disabled_mods_need_no_portal_auth(self):
        self.list(['base','space-age','quality','elevated-rails'])
        doc=json.loads((self.mods/'mod-list.json').read_text());doc['mods'].append({'name':'sample','enabled':False})
        (self.mods/'mod-list.json').write_text(json.dumps(doc))
        self.env['SERVER_TOKEN']=''
        before=self.snapshot();result=self.run_update()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(before,self.snapshot())

    def test_unsafe_filename_is_rejected(self):
        p=self.root/'sample.json';doc=json.loads(p.read_text());doc['releases'][0]['file_name']='../escaped.zip';p.write_text(json.dumps(doc))
        self.assert_preserved_failure()

if __name__ == '__main__':
    unittest.main()
