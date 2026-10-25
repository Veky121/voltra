#!/usr/bin/env python3
"""MIT. Private, versioned-symbol-verified MariaDB client for stock Onset plugin."""
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from steam_template import _publish

PIN={'version':'1:10.11.19-0+deb12u1','url':'https://deb.debian.org/debian-security/pool/updates/main/m/mariadb/libmariadb3_10.11.19-0+deb12u1_amd64.deb','sha256':'cfd599e218eb53c471014b40d180f2f7f9ca7debaacfbd271bc9e4f4cc6eec39','bytes':179504}
LIBRARY_SHA256='2db2abfde1604086774bcb5e7a8f6216728f21e8ca3b7d79ecfb40c215a49763'
SYMBOLS=('mysql_real_connect','mysql_set_character_set','mysql_thread_init','mysql_fetch_field','mysql_errno','mysql_thread_end','mysql_store_result','mysql_stat','mysql_insert_id','mysql_num_rows','mysql_server_init','mysql_options','mysql_field_count','mysql_character_set_name','mysql_server_end','mysql_ssl_set','mysql_next_result','mysql_real_query','mysql_warning_count','mysql_error','mysql_affected_rows','mysql_real_escape_string','mysql_close','mysql_init','mysql_fetch_row','mysql_num_fields','mysql_free_result')
RELATIVE='.voltra/onset-mariadb/lib/libmariadbclient.so.18'


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate(path):
    if digest(path)!=LIBRARY_SHA256:raise ValueError('Private MariaDB library identity differs from signed package pin')
    library=ctypes.CDLL(str(path),mode=os.RTLD_NOW|os.RTLD_LOCAL)
    loader=ctypes.CDLL(None);lookup=loader.dlvsym;lookup.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p];lookup.restype=ctypes.c_void_p
    if not all(lookup(library._handle,name.encode(),b'libmysqlclient_18') for name in SYMBOLS):raise ValueError('Private MariaDB client lacks required exact versioned plugin exports')
    return {'version':'libmysqlclient_18','resolved_sql_symbols':len(SYMBOLS)}


def location(root):
    root=Path(root).resolve();target=root/RELATIVE
    if target.is_symlink() or not target.resolve().is_relative_to(root) or not target.is_file() or digest(target)!=LIBRARY_SHA256:raise ValueError('Private Onset MariaDB library missing or changed; reinstall for review')
    return target.parent


def download(package):
    spec=importlib.util.spec_from_file_location('onset_native_release',Path(__file__).with_name('native-release.py'));release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
    release.download(PIN,package)


def provision(root):
    root=Path(root).resolve();target=root/RELATIVE;state=root/'.voltra/onset-mariadb';receipt=state/'release.json';license=state/'copyright'
    if any(p.is_symlink() or not p.resolve().is_relative_to(root) for p in (state,target,receipt,license)):raise ValueError('Private compatibility path leaves owned server')
    if target.exists():
        if digest(target)!=LIBRARY_SHA256:raise ValueError('Operator-modified MariaDB client retained; no overwrite')
        if receipt.is_file() and license.is_file():
            old=json.loads(receipt.read_text())
            if old.get('package_sha256')!=PIN['sha256'] or old.get('library_sha256')!=LIBRARY_SHA256 or old.get('copyright_sha256')!=digest(license):raise ValueError('Private compatibility receipt changed; no overwrite')
            return old
    if receipt.exists() or license.exists():raise ValueError('Incomplete compatibility state retained for operator review')
    state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.candidate-',dir=state) as directory:
        stage=Path(directory);package=stage/'client.deb';download(package)
        result=subprocess.run(['dpkg-deb','--extract',str(package),str(stage/'package')],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:raise ValueError('Signed MariaDB package extraction failed')
        source=stage/'package/usr/lib/x86_64-linux-gnu/libmariadb.so.3';copyright=stage/'package/usr/share/doc/libmariadb3/copyright'
        if not source.resolve().is_relative_to(stage) or not copyright.resolve().is_relative_to(stage):raise ValueError('Package library/license leaves staging')
        abi=validate(source);content=source.read_bytes();legal=copyright.read_bytes()
        data={'package_version':PIN['version'],'package_url':PIN['url'],'package_sha256':PIN['sha256'],'library_sha256':LIBRARY_SHA256,'copyright_sha256':hashlib.sha256(legal).hexdigest(),'abi':abi,'compatibility':'Actual libmysqlclient_18 exports verified; no unverified soname symlink','source':'https://github.com/MariaDB/server/tree/mariadb-10.11.19'}
        names=[str(license.relative_to(root)),str(receipt.relative_to(root)),RELATIVE]
        payloads=[legal,(json.dumps(data,indent=2)+'\n').encode(),content];created=[]
        try:
            for name,payload in zip(names,payloads):
                existed=(root/name).exists()
                _publish(root,name,lambda output,payload=payload:output.write(payload),0o644)
                if not existed:created.append(name)
        except BaseException:
            for name in reversed(created):
                path=root/name
                if path.resolve().is_relative_to(root) and not path.is_symlink():path.unlink(missing_ok=True)
            raise
        return data
