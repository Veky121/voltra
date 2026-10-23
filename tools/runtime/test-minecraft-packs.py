import importlib.util
import json
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/minecraft-pack-install.py'
spec = importlib.util.spec_from_file_location('packs', SOURCE)
packs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packs)


class Publication(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.stage, self.root = self.base / 'stage', self.base / 'server'
        self.stage.mkdir()
        self.root.mkdir()
        self.put(self.stage, 'server.jar', b'publisher-v1')

    def put(self, root, name, value):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
        return path

    def publish(self):
        return packs.publish(self.stage, self.root, {'provider': 'fixture', 'version': '1'}, 'server.jar')

    def test_first_defaults_without_eula_acceptance(self):
        self.put(self.stage, 'mods/required.jar', b'required')
        self.put(self.stage, 'eula.txt', b'eula=true\n')
        self.publish()
        self.assertEqual((self.root / 'mods/required.jar').read_bytes(), b'required')
        self.assertFalse((self.root / 'eula.txt').exists())

    def test_existing_operator_files_and_named_world_retained(self):
        self.put(self.root, 'server.properties', b'level-name=MyAdventure\n')
        names = ['mods/required.jar', 'plugins/custom.jar', 'config/x.toml', 'MyAdventure/level.dat',
                 'user_jvm_args.txt', 'eula.txt', 'server.properties']
        for name in names:
            if name != 'server.properties':
                self.put(self.root, name, b'operator')
            self.put(self.stage, name, b'publisher-default')
        before = {name: (self.root / name).read_bytes() for name in names}
        self.publish()
        self.assertEqual(before, {name: (self.root / name).read_bytes() for name in names})

    def test_tracked_program_upgraded_modified_program_retained(self):
        self.publish()
        self.put(self.stage, 'server.jar', b'publisher-v2')
        self.publish()
        self.assertEqual((self.root / 'server.jar').read_bytes(), b'publisher-v2')
        self.put(self.root, 'server.jar', b'operator-jar')
        self.put(self.stage, 'server.jar', b'publisher-v3')
        self.publish()
        self.assertEqual((self.root / 'server.jar').read_bytes(), b'operator-jar')

    def test_prevalidation_refuses_adapter_state_before_writes(self):
        self.put(self.stage, '.voltra/native_console.py', b'bad')
        with self.assertRaisesRegex(ValueError, 'adapter state'):
            self.publish()
        self.assertFalse((self.root / 'server.jar').exists())

    def test_failure_rolls_back_existing_program_and_new_defaults(self):
        self.publish()
        receipt = (self.root / '.voltra/minecraft-pack/release.json').read_bytes()
        self.put(self.stage, 'server.jar', b'publisher-v2')
        self.put(self.stage, 'mods/new.jar', b'new')
        replace = packs.os.replace
        def fail_receipt(source, destination):
            if Path(destination).name == 'release.json':
                raise OSError('fixture publication failure')
            return replace(source, destination)
        with patch.object(packs.os, 'replace', side_effect=fail_receipt):
            with self.assertRaises(OSError):
                self.publish()
        self.assertEqual((self.root / 'server.jar').read_bytes(), b'publisher-v1')
        self.assertFalse((self.root / 'mods/new.jar').exists())
        self.assertEqual((self.root / '.voltra/minecraft-pack/release.json').read_bytes(), receipt)

    def test_traversal_and_cross_platform_names_rejected(self):
        for name in ['../outside', '/outside', 'C:/outside', 'mods\\outside']:
            with self.assertRaises(ValueError):
                packs.target(self.root, name)

    def test_existing_custom_world_does_not_receive_publisher_chunks(self):
        self.put(self.root, 'server.properties', b'level-name=MyAdventure\n')
        self.put(self.root, 'MyAdventure/level.dat', b'operator-world')
        self.put(self.stage, 'MyAdventure/region/new.mca', b'publisher-world')
        self.publish()
        self.assertFalse((self.root / 'MyAdventure/region/new.mca').exists())

    def test_technic_dynamic_version_and_original_build_control(self):
        recipe='minecraft/java/technic/tekkit-smp/egg-tekkit-smp.json'
        lookup=lambda url: {'recommended':'1.0.5','latest':'1.0.6'}
        result=packs.technic_release(recipe, {'BUILD_TYPE':'latest'}, lookup)
        self.assertEqual(result['version'], 'v1.0.6')
        self.assertTrue(result['url'].endswith('_v1.0.6.zip'))
        with self.assertRaises(ValueError):
            packs.technic_release(recipe, {'MODPACK_VERSION':'$(bad)'}, lookup)

    def test_missing_or_ambiguous_launch_rejected(self):
        self.put(self.stage, 'forge-1.jar', b'one')
        self.put(self.stage, 'forge-2.jar', b'two')
        with self.assertRaises(ValueError):
            packs.select_launch(self.stage, 'java -jar forge-*.jar')
        with self.assertRaises(ValueError):
            packs.select_launch(self.stage, 'java -jar missing.jar')

    def test_modrinth_skips_client_only_and_keeps_optional_server_mods(self):
        row={'path':'mods/server.jar','hashes':{'sha512':'a'*128},'fileSize':4,
             'downloads':['https://cdn.modrinth.com/test.jar'],'env':{'server':'optional'}}
        client=dict(row, path='mods/client.jar', env={'server':'unsupported'})
        index={'formatVersion':1,'game':'minecraft','dependencies':{'minecraft':'1.20.1','fabric-loader':'0.16.10'},'files':[row,client]}
        version, loader, selected, files=packs.parse_modrinth(index)
        self.assertEqual((version,loader,selected),('1.20.1','fabric','0.16.10'))
        self.assertEqual([f['path'] for f in files], ['mods/server.jar'])

    def test_modrinth_conflicting_loader_and_duplicate_paths_rejected(self):
        index={'formatVersion':1,'game':'minecraft','dependencies':{'minecraft':'1.20.1','forge':'47.4.0','fabric-loader':'0.16.10'},'files':[]}
        with self.assertRaises(ValueError):
            packs.parse_modrinth(index)
        row={'path':'mods/server.jar','hashes':{'sha512':'a'*128},'fileSize':4,'downloads':['https://cdn.modrinth.com/test.jar']}
        index['dependencies']={'minecraft':'1.20.1'}
        index['files']=[row,row]
        with self.assertRaises(ValueError):
            packs.parse_modrinth(index)

    def test_curseforge_missing_key_is_explicit_without_publication(self):
        with self.assertRaisesRegex(ValueError,'API_KEY'):
            packs.install_curseforge(self.root,{'PROJECT_ID':'123'})
        self.assertEqual(list(self.root.iterdir()),[])

    def test_ftb_all_original_selection_controls_and_ambiguity(self):
        def metadata(url):
            if '/search/' in url:return {'packs':[18]}
            if url.endswith('/18'):return {'versions':[{'id':10,'name':'old','released':1},{'id':20,'name':'new','released':2}]}
            selected=int(url.rsplit('/',1)[1]);return {'id':selected,'targets':[{'name':'java','version':'8.0.312+7'}]}
        project,selected,java,_=packs.ftb_selection({'FTB_SEARCH_TERM':'Vanilla'},metadata)
        self.assertEqual((project,selected,java),('18','20',8))
        self.assertEqual(packs.ftb_selection({'FTB_MODPACK_ID':'18','FTB_VERSION_STRING':'old'},metadata)[1],'10')
        self.assertEqual(packs.ftb_selection({'FTB_MODPACK_ID':'18','FTB_VERSION_STRING':'old','FTB_MODPACK_VERSION_ID':'20'},metadata)[1],'20')
        with self.assertRaises(ValueError):packs.ftb_selection({'FTB_SEARCH_TERM':'Many'},lambda url:{'packs':[1,2]})

    def test_ftb_installer_is_confined_and_original_flags_retained(self):
        commands=[]
        def metadata(url):
            if url.endswith('/18'):return {'versions':[{'id':20,'name':'new','released':2}]}
            return {'id':20,'targets':[{'name':'java','version':'17.0.1'}]}
        def run(command,**kwargs):
            commands.append((command,kwargs))
            ready=Path(kwargs['cwd'])
            self.assertNotEqual(ready,self.root)
            self.put(ready,'forge-1.20.jar',b'publisher-program')
            self.put(ready,'mods/author.jar',b'publisher-mod')
            self.put(ready,'eula.txt',b'eula=true\n')
        def acquire(pin,destination,cache):destination.write_bytes(b'fixture-installer')
        with patch.dict(sys.modules,{'modded_java_install':SimpleNamespace(metadata=metadata),
                                    'minecraft_install':SimpleNamespace(bootstrap_java=lambda major,root:'/private/java/bin/java')}):
            with patch.object(packs,'acquire',side_effect=acquire),patch('subprocess.run',side_effect=run),patch('platform.machine',return_value='x86_64'):
                receipt=packs.install_ftb(self.root,{'FTB_MODPACK_ID':'18'})
        argv,options=commands[0]
        self.assertEqual(argv[1:],['-pack','18','-version','20','-no-colours','-no-java','-auto','-force'])
        self.assertEqual(options['timeout'],1800)
        self.assertTrue(options['check'])
        self.assertEqual(receipt['identity']['java'],17)
        self.assertFalse((self.root/'eula.txt').exists())
        self.assertTrue((self.root/'mods/author.jar').is_file())


if __name__ == '__main__':
    unittest.main()
