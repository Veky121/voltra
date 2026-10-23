#!/usr/bin/env python3
"""MIT. Per-assembly UTF-8 console imports for the publisher's Linux Mono build."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from native_config import private_write
from valheim_vrising_install import confined

SOURCE='''/* SPDX-License-Identifier: MIT
 * Linux terminals already use UTF-8; accept only the requested UTF-8 codepage.
 * These are the only Windows imports mapped by the adjacent assembly config.
 */
__attribute__((visibility("default"))) int SetConsoleOutputCP(unsigned int cp) { return cp == 65001; }
__attribute__((visibility("default"))) int SetConsoleCP(unsigned int cp) { return cp == 65001; }
'''
LICENSE='SPDX-License-Identifier: MIT\nCopyright (c) 2026 Voltra contributors\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n'
BEGIN='<!-- VOLTRA_STATIONEERS_UTF8_BEGIN -->'
END='<!-- VOLTRA_STATIONEERS_UTF8_END -->'
BLOCK=BEGIN+'''
  <dllmap dll="kernel32.dll" os="linux" cpu="x86-64">
    <dllentry dll="/home/container/.voltra/stationeers/console-compat/libvoltra_console_utf8.so" name="SetConsoleOutputCP" target="SetConsoleOutputCP" />
    <dllentry dll="/home/container/.voltra/stationeers/console-compat/libvoltra_console_utf8.so" name="SetConsoleCP" target="SetConsoleCP" />
  </dllmap>
'''+END+'\n'


def native_preload(root,existing=()):
    """Unity resolves these imports through __Internal; expose only our symbols."""
    root=Path(root).resolve();library=confined(root,'.voltra/stationeers/console-compat/libvoltra_console_utf8.so');receipt=confined(root,'.voltra/stationeers/console-compat/build.json')
    if not library.is_file()or not receipt.is_file()or library.stat().st_size>1024*1024 or receipt.stat().st_size>65536:raise ValueError('Stationeers private console compatibility is incomplete; reinstall first')
    build=json.loads(receipt.read_text())
    if build.get('source_sha256')!=hashlib.sha256(SOURCE.encode()).hexdigest()or build.get('binary_sha256')!=hashlib.sha256(library.read_bytes()).hexdigest():raise ValueError('Stationeers private console compatibility differs from its build receipt')
    paths=[library]
    for value in existing:
        path=Path(value)
        if not path.is_absolute()or not path.is_relative_to(root):raise ValueError('Additional native preload must stay in the server volume')
        path=confined(root,path.relative_to(root).as_posix())
        if not path.is_file():raise ValueError('Additional native preload is missing')
        paths.append(path)
    return ':'.join(str(p)for p in paths)


def configuration(previous):
    if len(previous)>1024*1024:raise ValueError('Oversized Stationeers assembly configuration')
    if '<!DOCTYPE'in previous.upper()or'<!ENTITY'in previous.upper():raise ValueError('Unsupported assembly XML entities')
    document=ET.fromstring(previous or '<configuration></configuration>')
    if document.tag!='configuration':raise ValueError('Expected assembly configuration root')
    if BEGIN in previous or END in previous:
        if previous.count(BEGIN)!=1 or previous.count(END)!=1 or BLOCK not in previous:raise ValueError('Operator changed the managed console mapping; preserve and review it')
        return previous
    for mapping in document.findall('dllmap'):
        if mapping.get('dll','').lower().removeprefix('i:')=='kernel32.dll':raise ValueError('Existing operator kernel32 mapping must be reviewed before adding console compatibility')
    if not previous:previous='<configuration>\n</configuration>\n'
    closing=previous.rfind('</configuration>')
    if closing<0:raise ValueError('Assembly configuration requires an explicit closing root')
    return previous[:closing]+BLOCK+previous[closing:]


def provision(root):
    root=Path(root).resolve();state=confined(root,'.voltra/stationeers/console-compat');state.mkdir(parents=True,exist_ok=True)
    assembly=confined(root,'rocketstation_DedicatedServer_Data/Managed/Assembly-CSharp.dll')
    target=confined(root,'rocketstation_DedicatedServer_Data/Managed/Assembly-CSharp.dll.config')
    previous=target.read_text()if target.exists()else'';updated=configuration(previous)
    source=confined(root,'.voltra/stationeers/console-compat/console-utf8.c');library=confined(root,'.voltra/stationeers/console-compat/libvoltra_console_utf8.so');receipt=confined(root,'.voltra/stationeers/console-compat/build.json')
    source_hash=hashlib.sha256(SOURCE.encode()).hexdigest();old=json.loads(receipt.read_text())if receipt.exists()else{}
    cached=library.is_file()and old.get('source_sha256')==source_hash and old.get('binary_sha256')==hashlib.sha256(library.read_bytes()).hexdigest()
    if not cached:
        private_write(source,SOURCE);private_write(confined(root,'.voltra/stationeers/console-compat/LICENSE'),LICENSE)
        fd,temporary=tempfile.mkstemp(prefix='.library-',dir=state);os.close(fd)
        try:
            subprocess.run(['cc','-shared','-fPIC','-O2','-fvisibility=hidden','-Wl,-z,relro,-z,now,-z,noexecstack','-Wl,--build-id=none','-o',temporary,str(source)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            os.chmod(temporary,0o644);os.replace(temporary,library)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
        old={'source_sha256':source_hash,'binary_sha256':hashlib.sha256(library.read_bytes()).hexdigest(),'compiler':subprocess.check_output(['cc','--version'],text=True).splitlines()[0],'license':'MIT','mapped_imports':['SetConsoleOutputCP','SetConsoleCP']}
    if updated!=previous:
        if previous:private_write(confined(root,'.voltra/stationeers/console-compat/config-backups/'+str(time.time_ns())+'.config'),previous)
        metadata=target.stat()if target.exists()else root.stat();mode=metadata.st_mode&0o777 if target.exists()else 0o644
        private_write(target,updated);target.chmod(mode);os.chown(target,metadata.st_uid,metadata.st_gid)
    old.update({'vendor_assembly_sha256':hashlib.sha256(assembly.read_bytes()).hexdigest(),'dllmap_sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    private_write(receipt,json.dumps(old,indent=2)+'\n');return old
