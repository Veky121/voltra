"""MIT. Offline public-loader wrapper fixtures; no Proton/game/network execution."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path('internal/palworldloader/assets/runtime.py').resolve()
ARCHIVE=Path('.local/palworld-proton-dependencies/UE4SS-Palworld-g2281fa31.zip').resolve()
spec=importlib.util.spec_from_file_location('runtime',SOURCE);runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def operation(self,root,stage):
        previous=Path.cwd()
        try:
            os.chdir(root)
            with patch.object(runtime.sys,'argv',['runtime.py',stage]),contextlib.redirect_stdout(io.StringIO()) as output:runtime.main()
            return json.loads(output.getvalue())
        finally:os.chdir(previous)

    def test_bundle_integrity_and_corruption(self):
        runtime.bundle()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);manifest={'schema':1,'files':{'owned':hashlib.sha256(b'original').hexdigest()}}
            (root/'bundle.json').write_text(json.dumps(manifest));(root/'owned').write_bytes(b'altered')
            with patch.object(runtime,'HERE',root),self.assertRaisesRegex(ValueError,'checksum'):runtime.bundle()
            manifest['files']={'../escape':'00'};(root/'bundle.json').write_text(json.dumps(manifest))
            with patch.object(runtime,'HERE',root),self.assertRaisesRegex(ValueError,'Unsafe'):runtime.bundle()

    def test_cache_install_reinstall_preserves_custom_files_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);pin=runtime.loader.pins()[0]['archive'];cache=root/'.voltra/public-cache'/pin['sha256'];cache.parent.mkdir(parents=True);cache.write_bytes(ARCHIVE.read_bytes())
            with patch.object(runtime.urllib.request,'build_opener',side_effect=AssertionError('Network forbidden')):
                self.assertFalse(self.operation(root,'install')['native_verified'])
                custom=root/'Pal/Binaries/Win64/ue4ss/Mods/Operator/Scripts/main.lua';custom.parent.mkdir(parents=True);custom.write_bytes(b'-- private operator Lua')
                before={str(path.relative_to(root)):(path.read_bytes(),path.stat().st_mode,path.stat().st_uid,path.stat().st_gid) for path in root.rglob('*') if path.is_file()}
                self.operation(root,'install');self.operation(root,'verify')
                after={str(path.relative_to(root)):(path.read_bytes(),path.stat().st_mode,path.stat().st_uid,path.stat().st_gid) for path in root.rglob('*') if path.is_file()}
                self.assertEqual(before,after)
                self.assertEqual((root/(runtime.TOOLS+'runtime-probe.exe')).read_bytes(),(runtime.HERE/'runtime-probe.exe').read_bytes())

    def test_legacy_conflict_prevents_download_and_any_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);legacy=root/'Pal/Binaries/Win64/winmm.dll';legacy.parent.mkdir(parents=True);legacy.write_bytes(b'operator legacy')
            with patch.object(runtime,'archive',side_effect=AssertionError('Acquisition forbidden')),self.assertRaises(ValueError):self.operation(root,'install')
            self.assertEqual(legacy.read_bytes(),b'operator legacy');self.assertFalse((root/'.voltra').exists())

    def test_corrupt_cache_is_preserved_without_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);pin=runtime.loader.pins()[0]['archive'];cache=root/'.voltra/public-cache'/pin['sha256'];cache.parent.mkdir(parents=True);cache.write_bytes(b'corrupt')
            with patch.object(runtime.urllib.request,'build_opener',side_effect=AssertionError('Network forbidden')),self.assertRaisesRegex(ValueError,'corrupt'):runtime.archive(root)
            self.assertEqual(cache.read_bytes(),b'corrupt')

    def test_public_acquisition_bounded_and_verified(self):
        payload=b'reviewed-public-zip';pin={'url':'https://github.com/owner/repo/releases/download/fixed/a.zip','bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}
        class Response(io.BytesIO):headers={'Content-Length':str(len(payload))}
        class Opener:
            def open(self,request,timeout):
                self.request=request;self.timeout=timeout
                return Response(payload)
        opener=Opener()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(runtime.loader,'pins',return_value=({'archive':pin},'unused')),patch.object(runtime.urllib.request,'build_opener',return_value=opener):
                result=runtime.archive(root)
            self.assertEqual(result.read_bytes(),payload);self.assertEqual(opener.timeout,45)
            self.assertNotIn('Authorization',opener.request.headers);self.assertNotIn('Cookie',opener.request.headers)
        class Oversized(io.BytesIO):headers={}
        class BadOpener:
            def open(self,*args,**kwargs):return Oversized(payload+b'oversized')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(runtime.loader,'pins',return_value=({'archive':pin},'unused')),patch.object(runtime.urllib.request,'build_opener',return_value=BadOpener()),self.assertRaisesRegex(ValueError,'mismatch'):runtime.archive(root)
            self.assertFalse((root/'.voltra').exists())


if __name__=='__main__':unittest.main()
