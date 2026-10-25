"""MIT. Staged native trace derivative; invocation requires separate root review."""
import contextlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bound_native_helpers', HERE/'native-once.py')
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
fixture = native.fixture
MODBASE = 'StarRupture/Binaries/Win64/ue4ss/Mods/'
ORIGINAL = MODBASE + 'VoltraPasswordBootstrap/'
PROBE = MODBASE + 'VoltraBoundTraceProbe/'
SNAPSHOTS = ['DSSettings.txt', '.pteroignore', ORIGINAL+'enabled.txt', MODBASE+'mods.txt']


def owned(root, relative):
    path = fixture.confined(root, relative)
    if path.exists() and (not path.is_file() or path.stat().st_size > 8*1024**2):
        raise ValueError('Diagnostic file boundary rejected')
    if os.name == 'posix' and path.exists() and path.stat().st_uid != os.geteuid():
        raise ValueError('Diagnostic ownership rejected')
    return path


@contextlib.contextmanager
def transaction(root, probe):
    """Snapshot before any mutation; restore exact bytes/modes even on failure."""
    snapshot = {}
    target = fixture.confined(root, PROBE)
    if target.exists() or owned(root, ORIGINAL+'request.bin').exists():
        raise ValueError('Existing probe or request rejected')
    mods = fixture.confined(root, MODBASE)
    # Fresh fixture permits only original bootstrap and our new probe.
    if any(p.name != 'VoltraPasswordBootstrap' and (p/'enabled.txt').exists() for p in mods.iterdir() if p.is_dir()):
        raise ValueError('Unreviewed enabled mod')
    for relative in SNAPSHOTS:
        path = owned(root, relative)
        snapshot[relative] = (path.read_bytes(), stat.S_IMODE(path.stat().st_mode)) if path.exists() else None
    markers = snapshot[MODBASE+'mods.txt']
    if markers and markers[0].strip(): raise ValueError('Unreviewed mods registry')
    private = fixture.confined(root, '.voltra/star-bound')
    private.mkdir(mode=0o700, exist_ok=False)
    (private/'snapshot').mkdir(mode=0o700)
    for index, (relative, entry) in enumerate(snapshot.items()):
        if entry:
            path = private/'snapshot'/str(index); path.write_bytes(entry[0]); path.chmod(0o600)
    (private/'snapshot.json').write_text(json.dumps({name: None if entry is None else {'sha256':fixture.digest(entry[0]),'mode':entry[1]} for name,entry in snapshot.items()}))
    installed = False
    try:
        owned(root, ORIGINAL+'enabled.txt').unlink(missing_ok=True)
        target.mkdir(mode=0o700); installed = True
        (target/'Scripts').mkdir(mode=0o700)
        (target/'Scripts/main.lua').write_bytes(probe)
        (target/'enabled.txt').write_bytes(b'')
        yield private
    finally:
        try:
            if installed:
                for relative in ('Scripts/main.lua', 'enabled.txt'):
                    fixture.confined(target, relative).unlink(missing_ok=True)
                if (target/'Scripts').exists(): (target/'Scripts').rmdir()
                target.rmdir()
        finally:
            for relative, entry in snapshot.items():
                path = owned(root, relative)
                if entry is None: path.unlink(missing_ok=True)
                else: path.write_bytes(entry[0]); path.chmod(entry[1])
        restored = all((not owned(root,name).exists()) if entry is None else (owned(root,name).read_bytes()==entry[0] and stat.S_IMODE(owned(root,name).stat().st_mode)==entry[1]) for name,entry in snapshot.items())
        (private/'restoration.json').write_text(json.dumps({'restored':restored,'probe_absent':not target.exists()}))
        if not restored: raise ValueError('Restoration verification failed')


def audit(body, credentials):
    # Inspect bounded raw bytes privately; publish booleans/counts, never text.
    return any(value and value in body for value in credentials)


def main():
    if len(sys.argv)!=2 or not sys.argv[1].isdecimal(): raise ValueError('Only allocated port accepted')
    root=Path('/work')
    if os.name!='posix' or os.geteuid()!=988 or root.stat().st_uid!=988 or stat.S_IMODE(root.stat().st_mode)!=0o700:
        raise ValueError('Owned root boundary differs')
    acquisition=json.loads(owned(root,'.voltra/star-acceptance/acquisition.json').read_text())
    plan=fixture.launch_plan(root,int(sys.argv[1]),fixture.PINS['wine_image'])
    if acquisition['release']['buildid']!=25642172 or plan['binary_sha256']!=acquisition['binary_sha256'] or plan['binary_sha256']!=fixture.PINS['native_payload']['sha256']:
        raise ValueError('Payload drift')
    native.acquire.verify_manifest(*(owned(root,'steamapps/'+name).read_text() for name in ('appmanifest_3809400.acf','appmanifest_228980.acf')))
    for name, body in fixture.assets('/public').items():
        if name.startswith('ue4ss/Mods/'): continue
        path=fixture.confined(root,'StarRupture/Binaries/Win64/'+name)
        if not path.is_file() or path.stat().st_uid!=988 or path.read_bytes()!=body: raise ValueError('Installed loader drift')
    fixture.checked(owned(root,ORIGINAL+'Scripts/main.lua').read_bytes(),fixture.PINS['lua'])
    if any(owned(root,name).exists() for name in ('Password.json','PlayerPassword.json')):
        raise ValueError('Existing password files forbid new mutation')
    probe=(HERE/'bound-main.lua').read_bytes()
    allowed=set(re.findall(rb'status\("([a-z_]+)"\)',probe))
    # Dynamic status variables in diagnostic-main resolve exclusively to these.
    allowed.update([b'request_unavailable',b'request_unlink_failed',b'request_invalid'])
    allowed.update(re.findall(rb'"(binding_error_[a-z_]+)"',probe))
    packet=fixture.protected_input(0)
    audit_packet=bytearray(packet)
    credentials=native.values(packet)
    try:
        with transaction(root,probe) as private:
            native.shared_adapter().configure(root,'starrupture',{'SERVER_PORT':sys.argv[1],'SESSION_NAME':'VoltraOwnedStarBootstrap','SAVE_INTERVAL':'60','START_NEW':'false','LOAD_SAVE':'false','SAVEGAME_NAME':'AutoSave0.sav'})
            mod=fixture.confined(root,PROBE)
            # Reuse original one-use admission and packet semantics, but supervise
            # directly so ALL native output is audited before any redaction/export.
            marker=mod/'acceptance-attempted'
            descriptor=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(descriptor)
            request=mod/'request.bin'
            try:
                fixture.prepare.private_directory(mod)
                fixture.prepare.stage(mod,packet)
                result=fixture.supervise(plan['argv'],root,plan['environment'],timeout=90,stop_after=75)
                raw=result.pop('output')
                observed_request_absent=not request.exists()
            finally:
                request.unlink(missing_ok=True)
                marker.unlink(missing_ok=True)
                packet[:]=b'\0'*len(packet)
            outputs=[raw]
            log_audits=[]
            for relative in ('StarRupture/Saved/Logs/StarRupture.log','StarRupture/Binaries/Win64/ue4ss/UE4SS.log'):
                path=fixture.confined(root,relative)
                if path.exists():
                    if not path.is_file() or path.stat().st_size>32*1024**2: raise ValueError('Log boundary rejected')
                    body=path.read_bytes();outputs.append(body)
                    log_audits.append({'path':relative,'bytes':len(body),'plaintext_detected':audit(body,credentials)})
            stages=[]
            for body in outputs:
                stages.extend(code.decode('ascii') for code in re.findall(rb'\[VoltraPasswordBootstrap\] ([a-z_]+)',body) if code in allowed)
            password_audit_failed=False
            try: password_files=native.audit_files(root,credentials)
            except Exception:
                password_files=[];password_audit_failed=True
            report={'phase':'native_bound_trace_terminal','child':result,'fixed_stages':stages,'console_plaintext_detected':audit(raw,credentials),'log_audits':log_audits,'native_password_files':password_files,'password_file_audit_failed':password_audit_failed,'request_absent_before_cleanup':observed_request_absent,'request_absent_after_cleanup':not request.exists(),'raw_logs_exported':False,'actual_authentication_verified':False,'production_gates_changed':False}
            (private/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        print('VOLTRA_STAR_BOUND_RESULT '+json.dumps(report),flush=True)
    finally:
        packet[:]=b'\0'*len(packet);audit_packet[:]=b'\0'*len(audit_packet);credentials.clear()


if __name__=='__main__':
    try: main()
    except BaseException:
        print('VOLTRA_STAR_BOUND_FIXED_FAILURE',flush=True);sys.exit(1)


