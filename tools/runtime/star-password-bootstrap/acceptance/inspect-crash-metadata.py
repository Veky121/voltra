#!/usr/bin/env python3
"""MIT. Read-only fixed markers/metadata; never emit native text or filenames."""
import argparse
import hashlib
import json
from pathlib import Path

MARKERS={
    'fatal_error':b'Fatal error:',
    'assertion_failed':b'Assertion failed:',
    'unhandled_exception':b'Unhandled Exception:',
    'access_violation':b'EXCEPTION_ACCESS_VIOLATION',
    'out_of_memory':b'Ran out of memory allocating',
    'request_exit':b'FPlatformMisc::RequestExit(',
    'request_exit_with_status':b'FPlatformMisc::RequestExitWithStatus(',
    'crash_handler':b'CrashReportClient',
}

def inspect(root):
    root=Path(root);rows=[]
    for label,relative in [('game','StarRupture/Saved/Logs/StarRupture.log'),('ue4ss','StarRupture/Binaries/Win64/ue4ss/UE4SS.log')]:
        p=root/relative;r={'log':label,'present':p.exists()}
        if p.exists() and not p.is_symlink() and p.is_file() and p.stat().st_size<=32*1024**2:
            body=p.read_bytes();r.update(bytes=len(body),mtime_ns=p.stat().st_mtime_ns,markers={name:token in body for name,token in MARKERS.items()})
        rows.append(r)
    crashes=root/'StarRupture/Saved/Crashes';files=[]
    if crashes.exists() and not crashes.is_symlink():
        for p in crashes.rglob('*'):
            if p.is_symlink(): raise ValueError('Crash symlink rejected')
            if not p.is_file(): continue
            if len(files)>=64: raise ValueError('Crash enumeration bound exceeded')
            info=p.stat();suffix=p.suffix.lower()
            files.append({'kind':{'.xml':'xml','.dmp':'dump','.log':'log'}.get(suffix,'other'),'bytes':info.st_size,'mtime_ns':info.st_mtime_ns,'sha256':hashlib.sha256(p.read_bytes()).hexdigest() if info.st_size<=32*1024**2 else None})
    return {'read_only':True,'logs':rows,'crash_directory_present':crashes.exists(),'crash_files':files,'cause_established':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True)
    print(json.dumps(inspect(parser.parse_args().root)))
