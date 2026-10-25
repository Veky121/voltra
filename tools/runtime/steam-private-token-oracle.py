#!/usr/bin/env python3
"""MIT. PUBLIC filename parser oracle only, never authentication/credentials.

Every candidate is an unproved experiment until real native filename receipts
say otherwise. This module is not imported by any production worker/capability.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import time


FIXTURES={
    'plain':'literal',
    'plus':'+quit',
    'minus':'-literal',
    'edge_spaces':'  literal  ',
    'inner_spaces':'literal value tail',
    'quote':'literal"quote"',
    'quote_space':'literal "quote" tail',
    'leading_quote':'"literal value',
    'trailing_quote':'literal value"',
    'slashes':r'literal\path\tail',
    'slash_quote':r'literal\"quote\" tail',
    'trailing_slash':'literal value\\',
    'mixed':'  +literal "quote" \\ λé  ',
    'single_quote':"literal 'quote' tail",
    'semicolon':'literal; value',
    'unicode':'λé_日本語 value',
}


def validate_public(value):
    if not isinstance(value,str) or not value or len(value)>2048 or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid public filename fixture')
    value.encode('utf-8',errors='strict')
    return value


def candidates(value):
    """Deliberately varied native-language hypotheses; none is an auth codec."""
    validate_public(value)
    return {
        'literal_wrapped':'"'+value+'"',
        'quotes_backslash_only':'"'+value.replace('"','\\"')+'"',
        'slashes_and_quotes_escaped':'"'+value.replace('\\','\\\\').replace('"','\\"')+'"',
        'doubled_quotes':'"'+value.replace('"','""')+'"',
        'bare_literal':value,
        'bare_escaped_spaces_quotes':value.replace('"','\\"').replace(' ','\\ '),
        'single_wrapped':"'"+value+"'",
        'quad_quotes':'"'+value.replace('"','""""')+'"',
    }


def prepare(root):
    root=Path(root);directory=root/'public-filename-oracle'
    if directory.exists():raise ValueError('Do not overwrite previous native evidence')
    directory.mkdir(mode=0o700)
    rows=[];commands=['@ShutdownOnFailedCommand 0']
    for name,value in FIXTURES.items():
        # Keep tokens truly literal and distinguish opener markers from paths.
        path=directory/value
        marker='VOLTRA_PUBLIC_TOKEN_'+secrets.token_hex(12)
        path.write_bytes(('@sSteamCmdForcePlatformType '+marker+'\n').encode());path.chmod(0o600)
        for encoding,token in candidates(value).items():
            rows.append({'fixture':name,'encoding':encoding,'marker':marker,'token':token})
    return rows


def probe(executable,parent,*,timeout=480,receipt_path=None):
    path=Path(__file__).with_name('steam-private-fd-transport.py')
    spec=importlib.util.spec_from_file_location('public_memfd_transport',path);transport=importlib.util.module_from_spec(spec);spec.loader.exec_module(transport)
    rows=prepare(parent);observed=[];deadline=time.monotonic()+timeout
    # Native baseline proves SteamCMD resolves runscript relative filenames
    # against its own private program directory, not the launcher's private cwd.
    for path in (Path(parent)/'public-filename-oracle').iterdir():
        target=Path(executable).parent/path.name
        if target.exists() and not target.read_bytes().startswith(b'@sSteamCmdForcePlatformType VOLTRA_'):
            raise ValueError('Refuse to replace non-fixture program files')
        shutil.copy2(path,target)
    def receipt():
        result={'scope':'Public fake filenames only; no account/auth/application/download commands','authentication_performed':False,'private_capability_enabled':False,'cases':observed}
        if receipt_path:Path(receipt_path).write_text(json.dumps(result,indent=2)+'\n')
        return result
    # Independent process per encoding gives exact case attribution and cannot
    # misattribute a cvar echoed from a preceding successful command.
    receipt()
    for row in rows:
        remaining=deadline-time.monotonic()
        if remaining<=0:receipt();raise TimeoutError('Bounded public parser utility deadline')
        output=[];script=('runscript '+row['token']+'\nquit\n').encode('utf-8')
        result=transport.run_script(executable,script,parent=parent,timeout=min(remaining,10),public_probe_observer=lambda chunk,_:output.append(chunk))
        raw=b''.join(output)
        observed.append({'fixture':row['fixture'],'encoding':row['encoding'],'exact_file_opened':row['marker'].encode() in raw,'exit_code':result['exit_code'],'native_output_sha256':hashlib.sha256(raw).hexdigest()})
        receipt()
    return receipt()


if __name__=='__main__':
    raise SystemExit('Research oracle requires an explicitly reviewed bounded utility driver; no automatic native run')
