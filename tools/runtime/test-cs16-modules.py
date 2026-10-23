#!/usr/bin/env python3
import importlib.util
import io
import json
import hashlib
import shutil
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

scripts=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
sys.modules['goldsrc_install']=types.SimpleNamespace(install=lambda *args:None)
sys.modules['native_release']=types.SimpleNamespace(download=lambda *args:None,sha256=lambda path:'fixture')
spec=importlib.util.spec_from_file_location('modules',scripts/'cs16-modules-install.py')
modules=importlib.util.module_from_spec(spec);spec.loader.exec_module(modules)


class ModuleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);(self.root/'.voltra').mkdir();(self.root/'cstrike').mkdir()
        self.release=json.loads((scripts/'cs16-modules-release.json').read_text(encoding='utf-8-sig'))
        (self.root/'.voltra/cs16-modules-release.json').write_text(json.dumps(self.release))
        self.env={'HLDS_GAME':'cstrike','SRCDS_BETAID':'steam_legacy','VERSION':'latest'}

    def test_staged_profile_embeds_exact_compilable_helpers(self):
        path=Path(__file__).resolve().parents[2]/'.local/cs16-modules/profiles.json'
        if not path.exists():self.skipTest('Generate the staged profile first')
        profile=next(iter(json.loads(path.read_text()).values()));script=profile['egg']['scripts']['installation']['script']
        for name in ('cs16-modules-install.py','cs16-modules-runtime.py','native-release.py'):
            target=name.replace('-','_');prefix=f"cat > .voltra/{target} <<'VOLTRA_SOURCE'\n"
            self.assertEqual(script.count(prefix),1)
            embedded=script.split(prefix,1)[1].split('\nVOLTRA_SOURCE\n',1)[0]
            self.assertEqual(embedded,(scripts/name).read_text())
            compile(embedded,target,'exec')
        self.assertTrue(script.endswith('PYTHONPATH=.voltra python3 .voltra/cs16_modules_install.py\n'))

    def test_exact_selection_and_prerequisites(self):
        self.assertEqual(modules.selection(self.env,self.release),list(modules.MODULES))
        self.assertEqual(modules.selection({**self.env,'INSTALL_MODULES':''},self.release),[])
        for value in ('reunion','amxmodx','reapi','rehlds,rehlds','rehlds;quit','unknown'):
            with self.subTest(value=value),self.assertRaises(ValueError):modules.selection({**self.env,'INSTALL_MODULES':value},self.release)
        for key,value in [('VERSION','../evil'),('HLDS_GAME','valve'),('SRCDS_BETAID','')]:
            with self.subTest(key=key),self.assertRaises(ValueError):modules.selection({**self.env,key:value},self.release)

    def test_traversal_links_duplicate_archive_rejected(self):
        for name,link in [('../escape',False),('/etc/passwd',False),('addons/link',True),('addons/evil\\path',False)]:
            archive=self.root/'evil.zip'
            with zipfile.ZipFile(archive,'w') as output:
                info=zipfile.ZipInfo(name)
                if link:info.external_attr=(0o120777<<16)
                output.writestr(info,b'x')
            with self.subTest(name=name),self.assertRaises(ValueError):modules.extract(archive,'amxmodx',self.root/'ready')

    def test_linux_mapping_and_windows_exclusion(self):
        archive=self.root/'public.zip'
        with zipfile.ZipFile(archive,'w') as output:
            output.writestr('addons/metamod/metamod_i386.so',b'elf')
            output.writestr('addons/metamod/metamod.dll',b'windows')
        self.assertEqual(modules.extract(archive,'metamod-r',self.root/'ready'),['cstrike/addons/metamod/metamod_i386.so'])

    def test_special_members_rejected_even_outside_selected_paths(self):
        for mode in (0o010600,0o020600,0o060600,0o140600):
            archive=self.root/'special.zip'
            with zipfile.ZipFile(archive,'w') as output:
                info=zipfile.ZipInfo('bin/win32/excluded');info.external_attr=mode<<16
                output.writestr(info,b'')
            with self.subTest(mode=mode),self.assertRaises(ValueError):modules.extract(archive,'rehlds',self.root/'ready')

    def test_registration_idempotent_preserves_operator_lines(self):
        (self.root/'cstrike/liblist.gam').write_text('game "Counter-Strike"\ngamedll_linux "dlls/cs.so"\n')
        folder=self.root/'cstrike/addons/metamod';folder.mkdir(parents=True)
        plugins=folder/'plugins.ini';plugins.write_text('linux addons/operator.so\n');plugins.chmod(0o600)
        modules.register(self.root,modules.MODULES);once=plugins.read_bytes();modules.register(self.root,modules.MODULES)
        self.assertEqual(plugins.read_bytes(),once);self.assertIn(b'operator.so',once)
        self.assertEqual(plugins.stat().st_mode&0o777,0o600)
        self.assertIn('addons/metamod/metamod_i386.so',(self.root/'cstrike/liblist.gam').read_text())

    def test_empty_selection_still_validates_publisher(self):
        with patch.object(modules,'publisher_install') as update:
            modules.install(self.root,{**self.env,'INSTALL_MODULES':''})
            update.assert_called_once()
        record=json.loads((self.root/'.voltra/cs16-modules.json').read_text())
        self.assertEqual(record['modules'],[])

    def test_real_reviewed_archives_unpack_together(self):
        cache=Path(__file__).resolve().parents[2]/'.local/cs16-modules'
        if not all((cache/(name+'.zip')).exists() for name in modules.MODULES):self.skipTest('Reviewed archive fixtures not mounted')
        ready=self.root/'ready';files=[]
        for name in modules.MODULES:files.extend(modules.extract(cache/(name+'.zip'),name,ready))
        for required in ('engine_i486.so','cstrike/dlls/cs.so','cstrike/addons/metamod/metamod_i386.so','cstrike/addons/amxmodx/modules/reapi_amxx_i386.so'):
            self.assertIn(required,files)
        self.assertEqual(len(files),len(set(files)))

    def test_full_overlay_reinstall_retains_operator_plugins_stats_and_salt(self):
        cache=Path(__file__).resolve().parents[2]/'.local/cs16-modules'
        if not (cache/'rehlds.zip').exists():self.skipTest('Reviewed archive fixtures not mounted')
        (self.root/'cstrike/liblist.gam').write_text('gamedll_linux "dlls/cs.so"\n')
        def download(record,target):
            source=cache/(record['module']+'.zip')
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),record['sha256'])
            shutil.copyfile(source,target)
        with patch.object(modules,'download',side_effect=download):
            modules.install(self.root,self.env)
            stats=self.root/'cstrike/addons/amxmodx/data/csstats.dat';stats.write_bytes(b'operator scores')
            plugin=self.root/'cstrike/addons/amxmodx/configs/plugins.ini';plugin.write_text('operator.amxx\n');plugin.chmod(0o600)
            config=self.root/'cstrike/reunion.cfg';before=config.read_bytes();self.assertIn(b'SteamIdHashSalt',before)
            modules.install(self.root,self.env)
            self.assertEqual(config.read_bytes(),before);self.assertEqual(stats.read_bytes(),b'operator scores')
            self.assertEqual(plugin.read_text(),'operator.amxx\n');self.assertEqual(plugin.stat().st_mode&0o777,0o600)


if __name__=='__main__':unittest.main(verbosity=2)
