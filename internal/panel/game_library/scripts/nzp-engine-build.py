#!/usr/bin/env python3
"""MIT. Reproducible-source NZ:P dedicated builds and private runtime libraries."""
import hashlib
import binascii
import csv
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

VRIL_COMMIT='ac0a0ac6b081be3b44e669dafe842b21b2a033d1'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def command(argv,cwd,timeout=600,environment=None):
 result=subprocess.run(argv,cwd=cwd,env=environment,timeout=timeout)
 if result.returncode:raise ValueError('NZP source build failed: '+str(argv[0]))

def build_vril(source,ready,patchfile):
 command(['patch','--batch','-p1','-i',str(patchfile)],source,30)
 build=source/'build/sdl';build.mkdir(parents=True,exist_ok=True)
 (build/'_build_info.h').write_text('#define GIT_HASH "ac0a0ac6-voltra-dedicated"\n#define GIT_BRANCH "voltra-dedicated"\n#define BUILD_DATE "2026-10-21T16:05:48Z"\n')
 binary=ready/'nzportable-server'
 environment={**os.environ,'CFLAGS':'-O2 -g0 -ffile-prefix-map='+str(source)+'=.'}
 command(['make','-f','Makefile.sdl','-j2','TARGET='+str(binary)],source,600,environment)
 if not binary.is_file():raise ValueError('Vril build did not produce dedicated binary')
 binary.chmod(0o755)
 library=ready/'lib';library.mkdir(exist_ok=True)
 result=subprocess.run(['ldd',str(binary)],capture_output=True,text=True,check=True,timeout=30)
 if 'not found' in result.stdout:raise ValueError('Vril build dependency is missing')
 glibc=('libc.so.','libm.so.','libdl.so.','libpthread.so.','librt.so.','libresolv.so.','libutil.so.')
 for name in sorted(set(re.findall(r'=>\s+(/[^\s]+)',result.stdout))):
  path=Path(name)
  if not path.name.startswith(glibc):shutil.copy2(path,library/path.name)
 licenses=ready/'licenses';licenses.mkdir(exist_ok=True)
 for path in Path('/usr/share/doc').glob('*/copyright'):shutil.copy2(path,licenses/(path.parent.name.replace(':','_')+'.copyright'))
 packages=subprocess.check_output(['dpkg-query','-W','-f=${binary:Package}\t${Version}\n'],text=True)
 (ready/'build-packages.txt').write_text(packages)
 shutil.copytree(source,ready/'source',ignore=shutil.ignore_patterns('build','.git'),dirs_exist_ok=True)
 report=dict(upstream_commit=VRIL_COMMIT,patch_sha256=digest(patchfile),binary_sha256=digest(binary),compiler=subprocess.check_output(['gcc','--version'],text=True).splitlines()[0],packages_sha256=hashlib.sha256(packages.encode()).hexdigest(),libraries={p.name:digest(p) for p in library.iterdir()})
 (ready/'dedicated-build.json').write_text(json.dumps(report,indent=2)+'\n')
 print('Reviewed Vril dedicated source patch built with private libraries and licenses.',flush=True)

def generate_legacy_table(source,target):
 # Publisher's generator uses pandas/fastcrc/colorama for CSV sorting and
 # CRC16/IBM-3740. The standard-library equivalent needs no extra runtime.
 with source.open(newline='') as stream:
  rows=list(csv.reader(stream));columns=rows.pop(0)
 if not columns or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',name) for name in columns):raise ValueError('Invalid legacy asset table columns')
 entries=[]
 for row in rows:
  if len(row)!=len(columns) or any('"' in value or '\\' in value or '\n' in value for value in row):raise ValueError('Invalid legacy asset table entry')
  entries.append((binascii.crc_hqx(row[0].encode(),0xffff),row))
 entries.sort(key=lambda item:item[0])
 text='var struct {\nfloat '+columns[0]+'_crc;\n'+''.join('string '+name+';\n' for name in columns[1:])+'float crc_strlen;\n}asset_conversion_table[]={\n'
 text+=''.join('{'+str(crc)+','+''.join('"'+value+'",' for value in row[1:])+str(len(row[0]))+'}'+(',' if index+1<len(entries) else '')+' // '+row[0]+'\n' for index,(crc,row) in enumerate(entries))+'};\n'
 target.write_text(text)

def build_legacy(assets,quakec,ready):
 generate_legacy_table(quakec/'tools/asset_conversion_table.csv',quakec/'source/server/hash_table.qc')
 compiler=quakec/'bin/fteqcc-cli-lin';compiler.chmod(0o755)
 compiled=quakec/'build/fte';compiled.mkdir(parents=True,exist_ok=True)
 for name,args in [('csqc',[]),('ssqc',['-O3','-DFTE']),('menu',['-O3','-DFTE'])]:
  command([str(compiler),*args,'-srcfile','../progs/'+name+'.src'],quakec/'bin',120)
 if not (compiled/'qwprogs.dat').is_file() or not (compiled/'csprogs.dat').is_file() or not (compiled/'menu.dat').is_file():raise ValueError('Legacy FTE compilation lacks required server/client/menu QuakeC')
 shutil.copytree(assets/'pc',ready,dirs_exist_ok=True)
 shutil.copytree(assets/'common',ready/'nzp',dirs_exist_ok=True)
 shutil.copytree(compiled,ready/'nzp',dirs_exist_ok=True)
 optional=ready/'optional-plugins';optional.mkdir(exist_ok=True)
 for plugin in ready.glob('fteplug_*.so'):shutil.move(str(plugin),optional/plugin.name)
 (optional/'README.txt').write_text('Publisher optional game/client plugins retained outside automatic loading. NZP dedicated QuakeC does not require them.\n')
 shutil.copytree(quakec,ready/'quakec-source',ignore=shutil.ignore_patterns('build'),dirs_exist_ok=True)
 for name in ['LICENSE.md','README.md']:
  if (assets/name).is_file():shutil.copy2(assets/name,ready/('ASSETS-'+name))
 print('Matched legacy FTE game code built; original assets and licenses retained.',flush=True)
