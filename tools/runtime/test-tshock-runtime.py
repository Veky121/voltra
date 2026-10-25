"""Offline synthetic runtime/bootstrap/dispatch fixtures; no game is executed."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPTS=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
m=load('terraria_release_install','terraria-release-install.py');runtime=load('tshock_runtime','tshock-runtime.py')
ELF=b'\x7fELF\x02\x01'+b'\0'*12+(62).to_bytes(2,'little')


def runtime_tar():
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w:gz')as archive:
        for name in ['dotnet','host/fxr/6.0.36/libhostfxr.so','shared/Microsoft.NETCore.App/6.0.36/libcoreclr.so']:
            entry=tarfile.TarInfo('./'+name);entry.mode=0o755;entry.size=len(ELF);archive.addfile(entry,io.BytesIO(ELF))
    return out.getvalue()


class TShockRuntime(unittest.TestCase):
    def setUp(self):
        self.data=runtime_tar();self.hash=hashlib.sha512(self.data).hexdigest();self.pin=patch.dict(runtime.RUNTIME_PINS,{'x64':self.hash});self.pin.start();self.addCleanup(self.pin.stop)

    def bootstrap(self,root):return runtime.ensure_runtime(root,'x64',opener=lambda *a,**kw:io.BytesIO(self.data))

    def receipt(self,root,major=6):
        value={'runtimeOptions':{'tfm':f'net{major}.0','framework':{'name':'Microsoft.NETCore.App','version':f'{major}.0.0'}}}
        body=ELF+json.dumps(value).encode();(root/'TShock.Server').write_bytes(body)
        state=root/'.voltra/terraria-release';state.mkdir(parents=True,exist_ok=True)
        record={'kind':'tshock','version':'5.2.4'if major==6 else'6.2.1','arch':'x64','files':{'TShock.Server':{'sha256':hashlib.sha256(body).hexdigest()}}};(state/'release.json').write_text(json.dumps(record));return record

    def test_bootstrap_publisher_hash_cache_and_tamper(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);identity=self.bootstrap(root);self.assertEqual('6.0.36',identity['version']);self.assertFalse(identity['upstream_supported'])
            with patch.object(runtime.urllib.request,'urlopen',side_effect=AssertionError('cache must remain offline')):runtime.verify_runtime(root,'x64')
            host=runtime.runtime_path(root,'x64')/'dotnet';host.write_bytes(ELF+b'operator mutation')
            with self.assertRaisesRegex(ValueError,'modified'):runtime.verify_runtime(root,'x64')
        with tempfile.TemporaryDirectory()as temporary:
            with self.assertRaisesRegex(ValueError,'SHA512'):runtime.ensure_runtime(Path(temporary),'x64',opener=lambda *a,**kw:io.BytesIO(b'corrupt'))

    def test_exact_family_dispatch_args_and_no_major_rollforward(self):
        for major in [6,9]:
            with self.subTest(major=major),tempfile.TemporaryDirectory()as temporary:
                root=Path(temporary);self.receipt(root,major)
                if major==6:self.bootstrap(root)
                calls=[]
                def run(args,**kwargs):
                    calls.append(args);return types.SimpleNamespace(returncode=0,stdout=''if args[0]=='ldd'else f'Microsoft.NETCore.App {major}.0.36 [fixed]\n',stderr='')
                with patch.object(runtime,'check_dynamic_dependencies'):
                    args,environment,identity=runtime.plan(root,{'SERVER_PORT':'28001','DOTNET_ROOT':'/untrusted','DOTNET_ROLL_FORWARD':'Major','LD_PRELOAD':'/untrusted/inject'},run=run,machine='x86_64')
                self.assertEqual(major,identity['major']);self.assertEqual('LatestPatch',environment['DOTNET_ROLL_FORWARD']);self.assertNotIn('LD_PRELOAD',environment)
                self.assertEqual([str(root/'TShock.Server'),'-config','serverconfig.txt','-configpath','/home/container/tshock','-logpath','/home/container/logs','-worldselectpath','/home/container/saves/Worlds','-ip','0.0.0.0','-port','28001','-noupnp'],args)
                if major==6:self.assertEqual(str(runtime.runtime_path(root,'x64')),environment['DOTNET_ROOT']);self.assertEqual(4,len(calls))
                else:self.assertNotIn('DOTNET_ROOT',environment);self.assertEqual([['dotnet','--list-runtimes']],calls)

    def test_wrong_framework_dependencies_pending_receipt_and_path_forgery(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);record=self.receipt(root);self.bootstrap(root)
            with patch.object(runtime,'check_dynamic_dependencies'):
                with self.assertRaisesRegex(ValueError,'dependency'):runtime.plan(root,{'SERVER_PORT':'28001'},run=lambda *a,**kw:types.SimpleNamespace(returncode=0,stdout='libmissing => not found',stderr=''),machine='x86_64')
            record['private_runtime']={'path':'/outside/arbitrary'};record['files']['/outside/arbitrary']={'sha256':'a'*64};(root/'.voltra/terraria-release/release.json').write_text(json.dumps(record))
            calls=[]
            def run(args,**kw):calls.append(args);return types.SimpleNamespace(returncode=0,stdout=''if args[0]=='ldd'else'Microsoft.NETCore.App 9.0.0 [other]\n',stderr='')
            with patch.object(runtime,'check_dynamic_dependencies'):
                with self.assertRaisesRegex(ValueError,'runtime family'):runtime.plan(root,{'SERVER_PORT':'28001'},run=run,machine='x86_64')
            self.assertTrue(all('/outside'not in' '.join(call)for call in calls))
            (root/'.voltra/terraria-release/transaction.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'Recover'):runtime.plan(root,{'SERVER_PORT':'28001'},run=run,machine='x86_64')

    def test_publisher_applyPatches_false_is_not_silently_overridden(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);record=self.receipt(root)
            config={'runtimeOptions':{'tfm':'net6.0','applyPatches':False,'framework':{'name':'Microsoft.NETCore.App','version':'6.0.0'}}}
            body=ELF+json.dumps(config).encode();(root/'TShock.Server').write_bytes(body);record['files']['TShock.Server']['sha256']=hashlib.sha256(body).hexdigest();(root/'.voltra/terraria-release/release.json').write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError,'publisher framework policy|Publisher framework policy'):
                runtime.plan(root,{'SERVER_PORT':'28001'},run=lambda*a,**kw:(_ for _ in()).throw(AssertionError('probe must not run')),machine='x86_64')

    @unittest.skipUnless(os.name=='posix','Linux symlink fixture')
    def test_runtime_symlinks_and_receipt_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory()as temporary,tempfile.TemporaryDirectory()as outside:
            root=Path(temporary);self.receipt(root);self.bootstrap(root);host=runtime.runtime_path(root,'x64')/'dotnet';host.unlink();host.symlink_to(Path(outside)/'dotnet')
            with self.assertRaises(ValueError):runtime.verify_runtime(root,'x64')
            receipt=root/'.voltra/terraria-release/release.json';receipt.unlink();receipt.symlink_to(Path(outside)/'receipt')
            with self.assertRaises(ValueError):runtime.plan(root,{'SERVER_PORT':'28001'},machine='x86_64')

    def test_closed_world_inventory_rejects_extra_hostfxr_and_framework_files(self):
        for name in ['host/fxr/99.0.0/libhostfxr.so','shared/Microsoft.NETCore.App/6.0.36/extra.dll','unexpected-empty-directory']:
            with self.subTest(name=name),tempfile.TemporaryDirectory()as temporary:
                root=Path(temporary);self.bootstrap(root);target=runtime.runtime_path(root,'x64');extra=target/name
                if name.endswith('directory'):extra.mkdir()
                else:extra.parent.mkdir(parents=True,exist_ok=True);extra.write_bytes(ELF)
                with self.assertRaisesRegex(ValueError,'unexpected'):runtime.verify_runtime(root,'x64')
        if os.name=='posix':
            with tempfile.TemporaryDirectory()as temporary,tempfile.TemporaryDirectory()as outside:
                root=Path(temporary);self.bootstrap(root);target=runtime.runtime_path(root,'x64');(target/'host/fxr/99.0.0').symlink_to(outside,target_is_directory=True)
                with self.assertRaisesRegex(ValueError,'linked'):runtime.verify_runtime(root,'x64')


if __name__=='__main__':unittest.main()
