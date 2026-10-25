"""MIT. Future approved one-shot bootstrap in exact owned isolated Wine fixture.

No installer/runtime-license acceptance or acquisition occurs here. Secrets enter
FD0 only; there is deliberately no password argv/environment/config option.
"""
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('star_fixture', HERE/'fixture.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
inspection = fixture.module('star_static_payload', HERE/'inspect-payload.py')
acquire = fixture.module('star_installed_validator', HERE/'acquire.py')


def shared_adapter():
    shared = HERE.parents[3]/'internal/panel/game_library/scripts'
    for name in ('steam-template', 'additional-survival-install'):
        sys.modules[name.replace('-', '_')] = fixture.module(name, shared/(name+'.py'))
    return fixture.module('star_existing_ocean_adapter', shared/'ocean-space-servers.py')


def values(packet):
    offset, result = 6, []
    for _ in range(2):
        length = struct.unpack_from('<I', packet, offset)[0]; offset += 4
        if length == 0xffffffff: result.append(None)
        else:
            result.append(bytes(packet[offset:offset+length])); offset += length
    return result


def audit_files(root, secrets):
    rows = []
    for name in ('Password.json', 'PlayerPassword.json'):
        path = fixture.confined(root, name)
        if not path.exists(): rows.append({'file':name,'present':False}); continue
        if not path.is_file() or path.stat().st_size > 1024**2:
            raise ValueError('Unexpected native password file')
        body = path.read_bytes()
        value = json.loads(body)
        if not isinstance(value, dict) or not isinstance(value.get('password'), str) or not value['password']:
            raise ValueError('Native encrypted password structure unavailable')
        encoded = value['password'].encode('utf-8')
        leaked = any(secret and (secret in body or secret in encoded) for secret in secrets)
        info = path.stat()
        rows.append({'file':name,'present':True,'bytes':len(body),'sha256':fixture.digest(body),
                     'uid':info.st_uid,'gid':info.st_gid,'mode':oct(info.st_mode&0o777),
                     'nonempty_password_string':True,'plaintext_detected':leaked})
    return rows


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdecimal():
        raise ValueError('Only allocated native port is accepted')
    root = Path('/work')
    if os.name != 'posix' or os.geteuid() != 988 or root.stat().st_uid != 988 or root.stat().st_mode&0o777 != 0o700:
        raise ValueError('Owned private game fixture boundary differs')
    acquisition = json.loads((root/'.voltra/star-acceptance/acquisition.json').read_text())
    if acquisition['release']['buildid'] != 25642172:
        raise ValueError('Actual payload engine/build unverified or drifted')
    plan = fixture.launch_plan(root, int(sys.argv[1]), fixture.PINS['wine_image'])
    if plan['binary_sha256'] != acquisition['binary_sha256'] or plan['binary_sha256'] != fixture.PINS['native_payload']['sha256']:
        raise ValueError('Actual payload bytes changed')
    acfs = []
    for name in ('appmanifest_3809400.acf','appmanifest_228980.acf'):
        path = fixture.confined(root,'steamapps/'+name)
        if not path.is_file() or path.stat().st_size>1024**2 or path.stat().st_uid!=os.geteuid():
            raise ValueError('Actual installed receipt boundary differs')
        acfs.append(path.read_text())
    acquire.verify_manifest(*acfs)
    steam = fixture.module('star_boot_actual_steam',HERE.parents[3]/'internal/panel/game_library/scripts/steam-template.py')
    if steam.manifest(root,3809400)['buildid'] != 25642172:
        raise ValueError('Actual installed build changed')
    versions = inspection.fixed_versions((root/fixture.PINS['binary']).read_bytes())
    if versions != [{'file_version':[5,6,1,0],'product_version':[5,6,1,0]}]:
        raise ValueError('Actual PE engine target differs')
    if any((root/name).exists() for name in ('Password.json', 'PlayerPassword.json')):
        raise ValueError('Fresh generation requires absent native password files')
    # Reuse exact original typed settings. Password controls are intentionally
    # absent here and transported only by the separately approved private packet.
    shared_adapter().configure(root, 'starrupture', {'SERVER_PORT':sys.argv[1],
        'SESSION_NAME':'VoltraOwnedStarBootstrap','SAVE_INTERVAL':'60',
        'START_NEW':'true','LOAD_SAVE':'false','SAVEGAME_NAME':'AutoSave0.sav'})
    content = fixture.assets('/public')
    mod = fixture.install_assets(root, content)
    fixture.prepare.private_directory(mod)  # Owner/mode checked before secret read.
    packet = fixture.protected_input(0)
    credentials = values(packet)
    try:
        # run_once clears its mutable packet. Keep a private bounded copy solely
        # for post-stop plaintext audits/redaction; never persist/print it.
        audit_packet = bytearray(packet)
        result = fixture.run_once(mod, packet, plan['argv'], root, plan['environment'], timeout=180, stop_after=150)
        raw = result.pop('output')
        private = root/'.voltra/star-acceptance'
        (private/'native-console.redacted.log').write_bytes(raw)
        (private/'native-child-result.json').write_text(json.dumps(result,indent=2)+'\n')
        logs = []
        for relative in ('StarRupture/Saved/Logs/StarRupture.log', 'StarRupture/Binaries/Win64/ue4ss/UE4SS.log'):
            path = fixture.confined(root, relative)
            if path.exists():
                if not path.is_file() or path.stat().st_size > 32*1024**2:
                    raise ValueError('Native log exceeds private capture bound')
                body = path.read_bytes(); redacted = fixture.redact(body, audit_packet)
                (private/(path.name+'.redacted.log')).write_bytes(redacted)
                logs.append({'path':relative,'raw_bytes':len(body),'redacted_sha256':fixture.digest(redacted),
                    'method_returned_marker':b'methods_returned_pending_native_file_verification' in body,
                    'plaintext_detected':any(value and value in body for value in credentials)})
        report = {'phase':'one_native_boot_terminal','result':result,'logs':logs,
                  'native_password_files':audit_files(root, credentials),
                  'request_absent':not (mod/'request.bin').exists(),
                  'actual_authentication_verified':False,'client_join_verified':False,
                  'production_gates_changed':False,'microsoft_installer_executed':False}
        (private/'native-result.json').write_text(json.dumps(report,indent=2)+'\n')
        print('VOLTRA_STAR_NATIVE_RESULT '+json.dumps(report),flush=True)
    finally:
        packet[:] = b'\0'*len(packet)
        if 'audit_packet' in locals(): audit_packet[:] = b'\0'*len(audit_packet)
        credentials.clear()  # Python immutable copies cannot promise zeroization.


if __name__ == '__main__':
    try: main()
    except BaseException:
        print('VOLTRA_STAR_NATIVE_FIXED_FAILURE',flush=True)
        sys.exit(1)
