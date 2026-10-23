#!/usr/bin/env python3
"""MIT. Original PocketMine ARM source build, pinned per supported channel.

This is a native ARM compiler path, never an emulation or x64 proof.
Upstream fixes dependency versions in the reviewed script; the receipt records
the acquired archives separately from independently publisher-verified hashes.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess


def plan(channel):
    if channel not in ('PM4','PM5'):raise ValueError('Unknown PocketMine build channel')
    return ['bash','compile.sh','-P'+channel[-1],'-j2','-c','downloads','-l','build-cache']+(['-z8.2'] if channel=='PM5' else [])


def runtime_files(stage):
    result={};base=stage/'bin'
    for path in base.rglob('*'):
        if not path.resolve().is_relative_to(base.resolve()):raise ValueError('PocketMine ARM runtime link escapes installation')
        if path.is_file():result[str(path.relative_to(base))]=hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def build(stage,channel,identity,download):
    if platform.machine() not in ('aarch64','arm64'):raise ValueError('PocketMine source build requires a native ARM64 host')
    stage=Path(stage).resolve();stage.mkdir(parents=True,exist_ok=True)
    binary=stage/'bin/php7/bin/php';receipt_path=stage/'arm-build-receipt.json'
    if binary.is_file() and receipt_path.is_file():
        receipt=json.loads(receipt_path.read_text())
        if receipt.get('channel')==channel and receipt.get('source')==identity and receipt.get('runtime_files')==runtime_files(stage):return receipt
        raise ValueError('Existing PocketMine ARM build differs; preserve it for operator review')
    missing=[name for name in ('bash','make','autoconf','automake','m4','getconf','gzip','bzip2','bison','g++','git','cmake','pkg-config','re2c','curl') if not shutil.which(name)]
    if missing:raise ValueError('PocketMine ARM compiler prerequisites missing: '+','.join(missing))
    script=stage/'compile.sh';download(identity,script)
    environment=dict(os.environ)
    # Let the publisher detect native aarch64. Passing its linux64 target would
    # force x86 compiler flags. Never inherit an operator's cross-compile flags.
    for key in ('CFLAGS','CXXFLAGS','LDFLAGS','CC','CXX','COMPILE_TARGET','PHP_VERSION'):environment.pop(key,None)
    if channel=='PM4':environment['PHP_VERSION']='8.1.27'
    with (stage/'compiler-output.log').open('wb') as output:
        subprocess.run(plan(channel),cwd=stage,env=environment,stdout=output,stderr=subprocess.STDOUT,check=True,timeout=7200)
    if not binary.is_file():raise ValueError('PocketMine ARM compiler did not produce PHP')
    header=binary.read_bytes()[:20]
    if len(header)<20 or header[:5]!=b'\x7fELF\x02' or int.from_bytes(header[18:20],'little')!=183:raise ValueError('PocketMine compiler output is not ARM64 ELF')
    archives={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (stage/'downloads').glob('*') if p.is_file() and not p.is_symlink()}
    receipt={'channel':channel,'architecture':'aarch64','source':identity,'php_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'runtime_files':runtime_files(stage),'dependency_archive_sha256_recorded':archives,'dependency_archive_hashes_independently_verified':False,'native_acceptance':False}
    (stage/'arm-build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt
