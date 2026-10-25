"""MIT. Staged explicit native/legacy schema and independent plaintext audit.

Commitments are ONLY for CSPRNG-generated disposable test inputs. Never create
unsalted commitments for user passwords. No crypto format or key is invented.
"""
import hashlib
import json
import os
import re
import stat
from pathlib import Path

MAXIMUM=1024*1024


def schema(value):
    if not isinstance(value,dict): return 'invalid'
    upper,lower='Password' in value,'password' in value
    if upper==lower: return 'invalid'
    key='Password' if upper else 'password'
    if not isinstance(value[key],str) or not value[key]: return 'invalid'
    return 'native_uppercase' if upper else 'published_legacy_lowercase'


def random_test_commitments(credentials):
    result=[]
    for value in credentials:
        if not isinstance(value,bytes) or not re.fullmatch(rb'[A-Za-z0-9_-]{43}',value):
            raise ValueError('Only disposable random test inputs are admitted')
        result.append({'random_test_only':True,'algorithm':'sha256','length':43,'sha256':hashlib.sha256(value).hexdigest()})
    return result


def persist_random_test_commitments(path,credentials):
    """Stage a before-trial reference, exclusively in an owned private directory."""
    path=Path(path)
    if not path.is_absolute() or any(p.is_symlink() for p in (path,*path.parents)):
        raise ValueError('Private commitment path required')
    if os.name=='posix' and (path.parent.stat().st_uid!=os.geteuid() or stat.S_IMODE(path.parent.stat().st_mode)!=0o700):
        raise ValueError('Owned private commitment directory required')
    commitments=random_test_commitments(credentials)
    descriptor=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|getattr(os,'O_NOFOLLOW',0),0o600)
    with os.fdopen(descriptor,'w') as stream:
        json.dump({'purpose':'disposable_random_test_only','commitments':commitments},stream)
        stream.flush();os.fsync(stream.fileno())
    return commitments


def plaintext(body,credentials=(),commitments=()):
    found=any(value and value in body for value in credentials)
    for row in commitments:
        if row.get('random_test_only') is not True or row.get('algorithm')!='sha256' or row.get('length')!=43 or not re.fullmatch('[0-9a-f]{64}',row.get('sha256','')):
            raise ValueError('Invalid disposable test commitment')
        # Fixed input length makes a post-crash raw scan possible even for
        # malformed JSON. No candidate substring is exported or persisted.
        wanted=row['sha256']
        found=found or any(hashlib.sha256(body[index:index+43]).hexdigest()==wanted for index in range(max(0,len(body)-42)))
    return found


def audit_body(body,credentials=(),commitments=()):
    if len(body)>MAXIMUM: return {'bounded':False,'plaintext_audit_complete':False,'schema':'uninspected'}
    # Independent scan happens FIRST, including when parsing/schema fails.
    reference_available=bool(credentials or commitments)
    leaked=plaintext(body,credentials,commitments) if reference_available else None
    report={'bounded':True,'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body),'plaintext_reference_available':reference_available,'plaintext_detected':leaked,'plaintext_audit_complete':reference_available}
    try: value=json.loads(body)
    except (ValueError,UnicodeError,RecursionError):
        report.update(json_valid=False,schema='invalid');return report
    report.update(json_valid=True,schema=schema(value))
    if not reference_available: return report
    # Also inspect decoded JSON string values (e.g. escaped ASCII). Bound traversal
    # independently of the schema; invalid objects still get a plaintext verdict.
    pending=[(value,0)];visited=0
    while pending:
        current,depth=pending.pop();visited+=1
        if depth>64 or visited>10000:
            report['plaintext_audit_complete']=False;break
        if isinstance(current,str):
            try: encoded=current.encode('utf-8')
            except UnicodeError:
                report['plaintext_audit_complete']=False;continue
            report['plaintext_detected']=report['plaintext_detected'] or plaintext(encoded,credentials,commitments)
        elif isinstance(current,dict):
            pending.extend((v,depth+1) for v in current.values())
            pending.extend((k,depth+1) for k in current.keys())
        elif isinstance(current,list): pending.extend((v,depth+1) for v in current)
    return report


def audit_files(root,credentials=(),commitments=()):
    root=Path(root)
    if not root.is_absolute() or root.is_symlink(): raise ValueError('Unowned audit root')
    rows=[]
    for name in ('Password.json','PlayerPassword.json'):
        path=root/name;row={'file':name,'present':path.exists()}
        if path.is_symlink(): row.update(boundary_valid=False,plaintext_audit_complete=False)
        elif path.exists():
            info=path.stat();row.update(uid=info.st_uid,gid=info.st_gid,mode=oct(stat.S_IMODE(info.st_mode)),bytes=info.st_size)
            if not path.is_file() or info.st_size>MAXIMUM: row.update(boundary_valid=False,plaintext_audit_complete=False)
            else: row.update(boundary_valid=True,**audit_body(path.read_bytes(),credentials,commitments))
        rows.append(row)
    return rows
