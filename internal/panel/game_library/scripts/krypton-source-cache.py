"""Optional immutable cache for locally built OSS output, never a publisher JAR."""
import hashlib
import json
import platform
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from minecraft_pack_install import digest, target

INPUTS=('krypton-source-build.py','krypton-source-releases.json','krypton-gradle-verification.xml',
        'krypton-registry-data.py','KryptonRegistrySupplement.java','krypton-config.py')


def context():
    base=Path(__file__).parent
    # Wings normalizes installer-script CRLF before writing these six UTF-8
    # heredoc inputs. Apply exactly that transform to context TEXT only. Bundle,
    # JAR, archives, data and all cache-member verification remain raw SHA256.
    hashes={file:hashlib.sha256((base/file).read_bytes().replace(b'\r\n',b'\n')).hexdigest() for file in INPUTS}
    identity={'schema':2,'text_normalization':'exact six INPUTS: Wings CRLF to LF only',
              'files':hashes,'platform':'linux/amd64','java':17,'mode':'locally-built-repaired-source-output'}
    return hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest(),identity


def restore(root,ready):
    pins=json.loads(Path(__file__).with_name('krypton-source-cache.json').read_text())
    if not pins.get('available'):return None
    if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):return None
    key,identity=context()
    if key!=pins['context_sha256']:return None # Changed source always rebuilds, never stale output.
    checksum=pins['bundle_sha256']
    if len(checksum)!=64 or any(c not in '0123456789abcdef' for c in checksum):raise ValueError('Invalid pinned Krypton source-cache identity')
    blob=target(root,'.voltra/public-cache/'+checksum)
    if not blob.exists():return None
    if blob.is_symlink() or not blob.is_file() or blob.stat().st_size!=pins['bundle_bytes'] or digest(blob)!=checksum:
        raise ValueError('Krypton source-output cache failed immutable bundle verification')
    with zipfile.ZipFile(blob) as archive:
        rows=archive.infolist();seen=set()
        if len(rows)>200 or sum(row.file_size for row in rows)>128*1024**2:raise ValueError('Krypton source cache exceeds limits')
        for row in rows:
            raw=row.orig_filename;parts=raw.split('/');path=PurePosixPath(raw)
            if not raw or raw.startswith('/') or '\\' in raw or ':' in raw or any(p in ('','.','..') for p in parts) or any(ord(c)<32 or ord(c)==127 for c in raw):raise ValueError('Unsafe Krypton source cache path')
            if raw not in ('manifest.json','Krypton.jar','config.conf') and (len(parts)<2 or parts[0]!='licenses'):raise ValueError('Krypton source cache contains an operator/runtime path')
            if str(path) in seen or ((row.external_attr>>16)&0o170000) not in (0,0o100000):raise ValueError('Krypton source cache duplicate/link/device')
            seen.add(str(path))
        manifest=json.loads(archive.read('manifest.json'))
        if manifest['context_sha256']!=key or manifest['context']!=identity or manifest.get('native_verified') is not False or manifest.get('publisher_release') is not False:
            raise ValueError('Krypton source cache provenance mismatch')
        if set(manifest['files'])!=seen-{'manifest.json'}:raise ValueError('Krypton source cache manifest file set mismatch')
        if not {'Krypton.jar','config.conf','licenses/krypton-repaired-source/build-provenance.json'}.issubset(seen):raise ValueError('Krypton source cache required output missing')
        contents={}
        for row in rows:
            if row.filename=='manifest.json':continue
            data=archive.read(row);record=manifest['files'][row.filename]
            if len(data)!=record['bytes'] or hashlib.sha256(data).hexdigest()!=record['sha256']:raise ValueError('Krypton source cache member integrity mismatch')
            contents[row.filename]=data
        if manifest['files']['Krypton.jar']['sha256']!=pins['jar_sha256']:raise ValueError('Krypton source cache JAR identity mismatch')
        provenance=json.loads(contents['licenses/krypton-repaired-source/build-provenance.json'])
        if provenance['sha256']!=pins['jar_sha256'] or provenance.get('config_only_exit_code')!=0 or provenance.get('native_verified') is not False:
            raise ValueError('Krypton source cache lacks successful config-only/source proof')
        for relative,data in contents.items():
            out=target(ready,relative);out.parent.mkdir(parents=True,exist_ok=True)
            with out.open('xb') as destination:destination.write(data)
        provenance={**provenance,'source_output_cache':{'context_sha256':key,'bundle_sha256':checksum,'origin':'locally built OSS source output; not publisher release'}}
        return Path(ready)/'Krypton.jar',provenance
