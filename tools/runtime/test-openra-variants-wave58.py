"""Offline D2K/CNC fixtures. Every publisher/process boundary is mocked."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('variants58', ROOT/'internal/panel/game_library/scripts/openra-family.py')
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)

class Variants(unittest.TestCase):
    def test_invalid_controls_do_not_create_support_or_acquire(self):
        for mod in ('d2k', 'cnc'):
            for values in ({'AUTH':'yes'}, {'SERVER_MAP':'bad'}, {'PASSWORD':'bad\n'}, {'SERVER_PORT':'0'}, {'SERVER_NAME':'x'*256}):
                with self.subTest(mod=mod, values=values), tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp); env={'SERVER_PORT':'29101', **values}
                    with patch.object(f, 'get', side_effect=AssertionError('network')), patch.object(f.subprocess, 'run', side_effect=AssertionError('process')):
                        with self.assertRaises(ValueError): f.arguments(root, env, mod)
                        with patch.object(f.os, 'uname', create=True) as uname:
                            uname.return_value.machine='x86_64'
                            with self.assertRaises(ValueError): f.install(root, env, mod)
                    self.assertEqual(list(root.iterdir()), [])

    def test_invalid_version_and_failed_acquisition_preserve_legacy(self):
        for mod in ('d2k','cnc'):
            for version in ('invalid','release-20250330'):
                with self.subTest(mod=mod,version=version), tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp); old=root/'.openra/settings.yaml'; old.parent.mkdir(); old.write_bytes(b'# operator\nServer:\n\tUnknown: yes\n')
                    with patch.object(f.os,'uname',create=True) as uname, patch.object(f,'get',side_effect=AssertionError('network')), patch.object(f.release,'download',side_effect=ValueError('synthetic acquisition refusal')), patch.object(f.subprocess,'run',side_effect=AssertionError('process')):
                        uname.return_value.machine='x86_64'
                        with self.assertRaises(ValueError): f.install(root,{'SERVER_PORT':'29101','VERSION':version},mod)
                    self.assertFalse((root/'OpenRAData').exists())
                    self.assertEqual(old.read_bytes(),b'# operator\nServer:\n\tUnknown: yes\n')

    def test_positive_exact_emitted_helpers_and_pins(self):
        profiles=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
        for mod,variant,filename in [('d2k','openra_dune2000','egg-open-r-a--dune2000.json'),('cnc','openra_tiberian_dawn','egg-open-r-a--tiberian-dawn.json')]:
            recipe=f'openra/{variant}/{filename}'
            with self.subTest(mod=mod), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); ready=root/'ready'; ready.mkdir()
                # Use exact installed helper filenames, replacing only the owned helper.
                emitted=root/'.voltra'; emitted.mkdir()
                script=profiles[recipe]['egg']['scripts']['installation']['script']
                import re
                for name,tag,body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2\n",script,re.S):
                    (emitted/name).write_text(body+'\n')
                (emitted/'openra-family.py').write_bytes((ROOT/'internal/panel/game_library/scripts/openra-family.py').read_bytes())
                emitted_spec=importlib.util.spec_from_file_location('emitted58',emitted/'openra-family.py'); module=importlib.util.module_from_spec(emitted_spec); emitted_spec.loader.exec_module(module)
                asset=module.selected('release-20250330',mod)
                self.assertEqual(asset['sha256'],f.PINNED[mod][0])
                def extract(argv, cwd, **kw):
                    server=Path(cwd)/'squashfs-root/usr/lib/openra'; (server/f'mods/{mod}').mkdir(parents=True)
                    (server/'OpenRA.Server').write_bytes(b'synthetic executable')
                    (server/f'mods/{mod}/mod.yaml').write_bytes(b'Metadata:\n')
                def download(asset,target): target.write_bytes(b'synthetic archive')
                with patch.object(module.os,'uname',create=True) as uname, patch.object(module,'get',side_effect=AssertionError('network')), patch.object(module.release,'download',side_effect=download), patch.object(module.hashlib,'file_digest') as digest, patch.object(module.subprocess,'run',side_effect=extract), patch.object(module.publisher,'publish') as publish:
                    uname.return_value.machine='x86_64'; digest.return_value.hexdigest.return_value=asset['sha1']
                    module.install(root,{'SERVER_PORT':'29101'},mod)
                    self.assertEqual(publish.call_args.args[3]['mod'],mod)
                support=root/'OpenRAData'; support.mkdir(exist_ok=True); settings=support/'settings.yaml'; settings.write_bytes(b'# operator\n')
                argv=module.arguments(root,{'SERVER_PORT':'29101','PASSWORD':'$literal','AUTH':'true'},mod)
                self.assertIn('Game.Mod='+mod,argv); self.assertIn('Server.Password=$literal',argv)
                self.assertEqual(settings.read_bytes(),b'# operator\n')

if __name__=='__main__': unittest.main()
