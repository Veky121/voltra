"""Offline dedicated runtime fixtures. These do not start a game."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module); return module
installer = load('terraria_release_install', 'terraria-release-install.py')
m = load('tmodloader_runtime', 'tmodloader-runtime.py')

ELF = b'\x7fELF\x02\x01' + b'\0'*12 + (62).to_bytes(2,'little')
def fixture(root, major=8, version=None):
    release = {'kind':'tmodloader','version':version or ('0.11.8.9' if major is None else '2023.06.25.36' if major==6 else '2026.08.3.0'),'arch':'x64'}
    def put(name, data):
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    if major is None:
        for name in ('tModLoaderServer.exe','mscorlib.dll','System.dll','FNA.dll'):put(name,b'MZfixture')
        for name in ('monoconfig','monomachineconfig'):put(name,b'config')
        put('lib64/libSDL2-2.0.so.0',ELF);put('tModLoaderServer.bin.x86_64',ELF)
    else:
        put('tModLoader.dll',b'MZfixture')
        put('tModLoader.runtimeconfig.json',json.dumps({'runtimeOptions':{'tfm':f'net{major}.0','framework':{'name':'Microsoft.NETCore.App','version':f'{major}.0.0'}}}).encode())
        put('tModLoader.deps.json',json.dumps({'libraries':{'tModLoader/1.4.4.9':{}}}).encode())
        put('Libraries/Native/Linux/libSDL2-2.0.so.0',ELF)
        put('Libraries/Native/Linux/libSDL2.so',ELF)
    m.inspect_payload(root,release)
    files={p.relative_to(root).as_posix():{'sha256':installer.digest(p)}for p in root.rglob('*')if p.is_file()and '.voltra'not in p.relative_to(root).parts}
    state=root/'.voltra/terraria-release';state.mkdir(parents=True,exist_ok=True)
    (state/'release.json').write_text(json.dumps({**release,'files':files}))
    return release

class RuntimeTests(unittest.TestCase):
    def test_actual_framework_not_release_tag_selects_runtime(self):
        for major in (6,8,None):
            with self.subTest(major=major),tempfile.TemporaryDirectory()as temporary:
                root=Path(temporary);item=fixture(root,major)
                self.assertEqual(major,item['runtime_major']);self.assertEqual('mono-kickstart'if major is None else'dotnet',item['runtime_family'])

    def test_modern_literal_argv_runtime_probe_and_environment(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);fixture(root)
            def run(argv,**kwargs):
                self.assertEqual(['/usr/bin/dotnet','--list-runtimes'],argv)
                self.assertEqual('LatestPatch',kwargs['env']['DOTNET_ROLL_FORWARD'])
                return subprocess.CompletedProcess(argv,0,'Microsoft.NETCore.App 8.0.24 [/runtime]\n','')
            with mock.patch.object(m.shutil,'which',return_value='/usr/bin/dotnet'):
                args,env,identity=m.plan(root,{'LANGUAGE':'9','DOTNET_STARTUP_HOOKS':'evil','LD_PRELOAD':'evil','MONO_PATH':'evil'},run,machine='x86_64')
            self.assertEqual(['/usr/bin/dotnet',str(root/'tModLoader.dll'),'-server'],args[:3])
            self.assertEqual(['-lang','9'],args[-2:]);self.assertIn('/home/container/mods',args)
            for key in ('DOTNET_STARTUP_HOOKS','LD_PRELOAD','MONO_PATH'):self.assertNotIn(key,env)
            self.assertEqual(8,identity['major'])

    def test_legacy_direct_dedicated_without_dotnet_or_shell(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);fixture(root,None)
            args,env,identity=m.plan(root,{},run=lambda *_args,**_kwargs:self.fail('No legacy runtime probe executes a game'),machine='x86_64')
            self.assertEqual(str(root/'tModLoaderServer.bin.x86_64'),args[0]);self.assertNotIn('-server',args)
            self.assertEqual('all',env['MONO_IOMAP']);self.assertEqual('1.3.5.3',identity['terraria_version'])
            self.assertIn('-tmlsavedirectory',args);self.assertIn('-modpath',args)

    def test_private6_reuses_verified_primitive_and_patch_family(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);fixture(root,6);verified=[]
            primitive=types.SimpleNamespace(verify_runtime=lambda root,arch:verified.append(arch),runtime_path=lambda root,arch:root/'private6',check_dynamic_dependencies=lambda:None)
            with mock.patch.dict(sys.modules,{'tshock_runtime':primitive}):
                args,env,identity=m.plan(root,{},run=lambda argv,**kwargs:subprocess.CompletedProcess(argv,0,'Microsoft.NETCore.App 6.0.36 [/private]\n',''),machine='x86_64')
            self.assertEqual(['x64'],verified);self.assertEqual(str(root/'private6/dotnet'),args[0]);self.assertEqual(str(root/'private6'),env['DOTNET_ROOT']);self.assertEqual(6,identity['major'])

    def test_changed_dependency_wrong_architecture_and_incomplete_commit_fail(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);fixture(root,None)
            with self.assertRaises(ValueError):m.plan(root,{},machine='aarch64')
            (root/'System.dll').write_bytes(b'MZoperator')
            with self.assertRaisesRegex(ValueError,'changed'):m.plan(root,{},machine='x86_64')
            fixture(root,None);(root/'.voltra/terraria-release/transaction.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'interrupted'):m.plan(root,{},machine='x86_64')

    def test_enabled_mod_guard_preserves_unselected_worlds_and_disabled_mods(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);before=fixture(root);world=root/'saves/Worlds/old.wld';world.parent.mkdir(parents=True);world.write_bytes(b'old world');sidecar=world.with_suffix('.twld');sidecar.write_bytes(b'moddata')
            mods=root/'mods';mods.mkdir();version=b'2026.08.3.0';(mods/'Future.tmod').write_bytes(b'TMOD'+bytes([len(version)])+version)
            (mods/'enabled.json').write_text('[]')
            legacy={**before,'version':'0.11.8.9','runtime_family':'mono-kickstart','terraria_version':'1.3.5.3'}
            m.compatibility_preflight(root,legacy,{'WORLD_NAME':'new_world'})
            (mods/'enabled.json').write_text('["Future"]')
            with self.assertRaisesRegex(ValueError,'incompatible/newer'):m.compatibility_preflight(root,legacy)
            with self.assertRaisesRegex(ValueError,'incompatible/newer'):m.compatibility_preflight(root,{**before,'version':'2023.06.25.36'})
            m.compatibility_preflight(root,before)
            self.assertEqual(b'old world',world.read_bytes());self.assertEqual(b'moddata',sidecar.read_bytes())

    def test_framework_and_dependency_validation_fail_closed(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);item=fixture(root)
            (root/'tModLoader.deps.json').write_text('{"libraries":{}}')
            with self.assertRaisesRegex(ValueError,'branch'):m.inspect_payload(root,item)
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary)
            with self.assertRaisesRegex(ValueError,'framework'):fixture(root,7)

    def test_enabled_mod_parser_is_bounded_and_does_not_load_plugins(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);item=fixture(root);mods=root/'mods';mods.mkdir();enabled=mods/'enabled.json';enabled.write_text('["Chosen"]')
            for data in (b'not a mod',b'TMOD\x80',b'TMOD\xff\xff\xff\xff\xff',b'TMOD\x7f'+b'x'*127,b'TMOD\x051.2!3'):
                (mods/'Chosen.tmod').write_bytes(data)
                with self.subTest(data=data[:10]),self.assertRaises(ValueError):m.compatibility_preflight(root,item)
            enabled.write_text('["../escape"]')
            with self.assertRaises(ValueError):m.compatibility_preflight(root,item)
            enabled.write_text('[]');m.compatibility_preflight(root,item)

    def test_missing_dependency_receipt_and_unavailable_framework_refuse_start(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);fixture(root);receipt=root/'.voltra/terraria-release/release.json';value=json.loads(receipt.read_text());del value['files']['tModLoader.deps.json'];receipt.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'ownership'):m.plan(root,{},machine='x86_64')
            fixture(root)
            with mock.patch.object(m.shutil,'which',return_value='/usr/bin/dotnet'):
                with self.assertRaisesRegex(ValueError,'framework'):m.plan(root,{},run=lambda argv,**kwargs:subprocess.CompletedProcess(argv,0,'Microsoft.NETCore.App 9.0.1 [/runtime]\n',''),machine='x86_64')

    def test_generated_sdl_alias_missing_or_changed_blocks_before_runtime_probe(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);fixture(root);receipt=root/'.voltra/terraria-release/release.json';value=json.loads(receipt.read_text());del value['files']['Libraries/Native/Linux/libSDL2.so'];receipt.write_text(json.dumps(value))
            alias=root/'Libraries/Native/Linux/libSDL2.so'
            for replacement in (None,b'operator SDL'):
                if replacement is None:alias.unlink()
                else:alias.write_bytes(replacement)
                with self.subTest(replacement=replacement),self.assertRaisesRegex(ValueError,'SDL compatibility alias'):
                    m.plan(root,{},run=lambda *_args,**_kwargs:self.fail('Alias denial must precede any runtime probe'),machine='x86_64')
            alias.write_bytes(ELF);m.verify_sdl_alias(root)

    @unittest.skipUnless(os.name=='posix','Actual Linux symlink fixture')
    def test_sdl_alias_only_accepts_exact_relative_verified_library(self):
        with tempfile.TemporaryDirectory()as temporary,tempfile.TemporaryDirectory()as outside:
            root=Path(temporary);fixture(root);alias=root/'Libraries/Native/Linux/libSDL2.so';alias.unlink()
            external=Path(outside)/'libSDL2.so';external.write_bytes(ELF)
            for target in (str(external),'../Linux/libSDL2-2.0.so.0','missing.so'):
                alias.symlink_to(target)
                with self.subTest(target=target),self.assertRaisesRegex(ValueError,'unsafe target'):m.verify_sdl_alias(root)
                alias.unlink()
            alias.symlink_to('libSDL2-2.0.so.0');m.verify_sdl_alias(root)
            self.assertEqual(ELF,external.read_bytes())

if __name__=='__main__':unittest.main()
