"""Package built browser extensions and a minimal reproducible source archive."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from hashlib import sha256
import json

root = Path(__file__).resolve().parent
workspace = root.parent
manifest = json.loads((root/'manifest.json').read_text())
version = manifest['version_name']
artifacts = []

def archive(path, entries):
    with ZipFile(path, 'w', ZIP_DEFLATED) as output:
        for source, name in sorted(entries, key=lambda entry: entry[1]):
            output.write(source, name)
    with ZipFile(path) as result:
        assert result.testzip() is None
    artifacts.append(path)

for directory, suffix in [('dist',''), ('dist-firefox','-firefox-unsigned')]:
    build = root/directory
    assert json.loads((build/'manifest.json').read_text())['version'] == manifest['version']
    archive(root/f'voltra-companion-{version}{suffix}.zip',
            [(path,path.relative_to(build).as_posix()) for path in build.rglob('*') if path.is_file()])

sources = [path for path in root.iterdir() if path.is_file() and path.suffix in {'.js','.mjs','.py','.json','.md','.txt','.html','.css'} and path.name != 'SHA256SUMS.txt']
for directory in ['src','tests']:
    sources += [p for p in (root/directory).rglob('*') if p.is_file() and p.suffix in {'.js','.mjs','.py'}]
sources += [workspace/'web/package.json', workspace/'web/package-lock.json',
            workspace/'web/src/notificationEvents.ts', workspace/'LICENSE.md']
sources += [workspace/f'web/public/brand/voltra-{size}.png' for size in [16,32,48,128]]
archive(root/f'voltra-companion-{version}-source.zip', [(p,p.relative_to(workspace).as_posix()) for p in sources])
(root/'SHA256SUMS.txt').write_text(''.join(sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in artifacts))
for path in artifacts: print(path.name)
