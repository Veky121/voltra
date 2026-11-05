"""Offline tests execute emitted modules in a clean isolated Python subprocess."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/magma-owner'
profile = json.loads((OUT / 'profile.pending.json').read_text(encoding='utf-8'))
script = next(iter(profile.values()))['egg']['scripts']['installation']['script']
RUNNER = r'''
import sys
sys.path.insert(0, sys.argv[1])
import hashlib, json, tempfile, unittest, zipfile, socket
from pathlib import Path
from unittest.mock import patch
import magma_install as magma
import java_fork_install as fork
socket.socket = lambda *a, **k: (_ for _ in ()).throw(AssertionError('offline fixture forbids network'))

def snapshot(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and '.voltra' not in p.parts}

class Emitted(unittest.TestCase):
    def test_preflight_refusal_no_writes_or_acquisition(self):
        for change in ({'EULA_ACCEPTED':'false'}, {'MC_VERSION':'1.21.1'},
                       {'TAG_VERSION':'$(bad)'}, {'SERVER_JARFILE':'../bad.jar'},
                       {'USE_EXISTING_JAR':'yes'}):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d)/'absent'
                with patch.object(fork,'resolve',side_effect=AssertionError('network')):
                    with self.assertRaises(ValueError):magma.install(root, {'EULA_ACCEPTED':'true',**change})
                self.assertFalse(root.exists())

    def test_success_update_and_failed_update_preserve_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            protected={'world/level.dat':b'world', 'mods/operator.jar':b'mod',
                       'plugins/operator.jar':b'plugin','config/operator.toml':b'# unknown\nx=1\n',
                       'eula.txt':b'# explicit operator choice\neula=false\n'}
            for name,data in protected.items():
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
            def acquire(release,path,root):
                with zipfile.ZipFile(path,'w') as z:
                    z.writestr('META-INF/MANIFEST.MF','Main-Class: fixture.Server\n')
                return 'a'*64  # synthetic fixture, never a publisher integrity claim
            with patch.object(fork,'acquire',side_effect=acquire):
                magma.install(root,{'EULA_ACCEPTED':'true'})
                self.assertIn('enable-rcon=false', (root/'server.properties').read_text())
                (root/'server.properties').write_bytes(b'# unknown\r\nlevel-name=world\r\nfoo=bar\r\n')
                before=snapshot(root)
                magma.install(root,{'EULA_ACCEPTED':'true'})
                self.assertEqual(before,snapshot(root))
            with patch.object(fork,'acquire',side_effect=ValueError('fixture integrity failure')):
                with self.assertRaisesRegex(ValueError,'integrity'):magma.install(root,{'EULA_ACCEPTED':'true'})
            self.assertEqual(before,snapshot(root))
            import minecraft_pack_install as pack
            replace=pack.os.replace
            def fail_receipt(source,destination):
                if str(source).endswith('receipt.json'):raise OSError('fixture publication failure')
                return replace(source,destination)
            with patch.object(fork,'acquire',side_effect=acquire), patch.object(pack.os,'replace',side_effect=fail_receipt):
                with self.assertRaisesRegex(OSError,'publication'):magma.install(root,{'EULA_ACCEPTED':'true'})
            self.assertEqual(before,snapshot(root))
            for name,data in protected.items():self.assertEqual((root/name).read_bytes(),data)

    def test_existing_jar_never_resolves_or_accepts_eula(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with zipfile.ZipFile(root/'custom.jar','w') as z:z.writestr('META-INF/MANIFEST.MF','Main-Class: fixture.Server\n')
            before=snapshot(root)
            with patch.object(fork,'resolve',side_effect=AssertionError('network')):
                magma.install(root,{'EULA_ACCEPTED':'true','USE_EXISTING_JAR':'true','SERVER_JARFILE':'custom.jar'})
            self.assertEqual(before,snapshot(root))

    def test_exact_tag_failure_no_fallback(self):
        with patch.object(fork,'github_release',side_effect=ValueError('missing exact tag')):
            with self.assertRaisesRegex(ValueError,'exact'):fork.resolve('magma',{'MC_VERSION':'1.18.2','TAG_VERSION':'missing'})

unittest.main(argv=['emitted'],verbosity=2)
'''
with tempfile.TemporaryDirectory(prefix='magma-emitted-') as d:
    folder = Path(d)
    files = re.findall(r"cat\s+>\s*([^\s]+)\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)", script)
    for name, marker, source in files:
        (folder / Path(name).name).write_text(source + '\n', encoding='utf-8')
    runner = folder / 'runner.py'
    runner.write_text(RUNNER, encoding='utf-8')
    result = subprocess.run([sys.executable, '-I', str(runner), d], capture_output=True, text=True, timeout=60)
    (OUT / 'offline-tests.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    print(result.stdout + result.stderr)
    raise SystemExit(result.returncode)
