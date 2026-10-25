"""MIT. Staged one-shot app228980 shared-depot metadata; execution not approved."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import resource
import re
import selectors
import signal
import struct
import subprocess
import time

EXPECTED_WORKER = 'cea92b57d34a3bdeba7c7135f48532c9427762d04c1bf361edaec46279ea15b2'
APP_ID = 228980
TARGET_DEPOT = 228989
MAX_FRAME = 65536
HARD_SECONDS = 35


def fixed_request():
    return {'operation': 'anonymous_metadata', 'username': None, 'password': None,
            'guard': None, 'branch': 'public', 'beta_password': None,
            'app_id': APP_ID, 'parent_fields_validated': True}


def decimal(value, *, nullable=False, positive=False):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not re.fullmatch(r'0|[1-9][0-9]{0,19}', value, flags=re.ASCII):
        raise ValueError('noncanonical_uint64')
    number = int(value)
    if number > 18446744073709551615 or (positive and number == 0):
        raise ValueError('invalid_uint64')
    return value


def validate_metadata(metadata):
    if not isinstance(metadata, dict) or type(metadata.get('app_id')) is not int or metadata['app_id'] != APP_ID:
        raise ValueError('wrong_app')
    if metadata.get('entitlement_verified') is not False or metadata.get('content_downloaded') is not False:
        raise ValueError('unexpected_content_claim')
    branches, depots = metadata.get('branches'), metadata.get('depots')
    if not isinstance(branches, list) or len(branches) > 64 or not isinstance(depots, list) or len(depots) > 128:
        raise ValueError('invalid_collection')
    for branch in branches:
        decimal(branch.get('build_id'), nullable=True)
    seen = set()
    for depot in depots:
        identity = depot.get('depot_id')
        if type(identity) is not int or not 0 < identity <= 2147483647 or identity in seen:
            raise ValueError('invalid_depot_identity')
        seen.add(identity)
        manifests = depot.get('manifests')
        if not isinstance(manifests, list) or len(manifests) > 128:
            raise ValueError('invalid_manifest_collection')
        names = set()
        for manifest in manifests:
            name = manifest.get('branch')
            if not isinstance(name, str) or name in names:
                raise ValueError('ambiguous_manifest')
            names.add(name)
            decimal(manifest.get('manifest_id'), positive=True)
            decimal(manifest.get('disk_bytes'), nullable=True)
            decimal(manifest.get('download_bytes'), nullable=True)
    return metadata


def shared_selection(metadata):
    validate_metadata(metadata)
    matches = [d for d in metadata['depots'] if d['depot_id'] == TARGET_DEPOT]
    if not matches:
        return {'state': 'target_not_returned', 'depot_id': TARGET_DEPOT, 'entitlement_verified': False}
    depot = matches[0]
    manifests = [m for m in depot['manifests'] if m['branch'] == 'public']
    return {'state': 'public_identity_observed' if manifests else 'public_manifest_not_returned',
            'depot_id': TARGET_DEPOT, 'source_app_id': APP_ID, 'from_app_id': depot.get('from_app_id'),
            'platforms': depot.get('platforms'), 'architecture': depot.get('architecture'),
            'public_manifest': manifests[0] if manifests else None,
            'entitlement_verified': False, 'content_downloaded': False}


def run():
    worker = Path('/work/build/Worker.dll')
    if hashlib.sha256(worker.read_bytes()).hexdigest() != EXPECTED_WORKER:
        raise RuntimeError('frozen_worker_mismatch')
    # Anonymous/public only. No configurable account, app, URL or operation input.
    request = fixed_request()
    raw = json.dumps(request, separators=(',', ':')).encode()
    incoming = os.memfd_create('anonymous-metadata', os.MFD_ALLOW_SEALING)
    os.write(incoming, struct.pack('<I', len(raw)) + raw)
    os.lseek(incoming, 0, os.SEEK_SET)
    fcntl.fcntl(incoming, fcntl.F_ADD_SEALS, fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW |
                fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
    events, event_write = os.pipe()
    replies, reply_write = os.pipe()
    environment = {'HOME': '/work/empty-home', 'DOTNET_ROOT': '/work/sdk',
                   'LD_LIBRARY_PATH': '/work/fixture-libs',
                   'DOTNET_CLI_HOME': '/work/empty-home', 'DOTNET_SYSTEM_GLOBALIZATION_INVARIANT': '1',
                   'DOTNET_EnableDiagnostics': '0', 'DOTNET_CLI_TELEMETRY_OPTOUT': '1',
                   'DOTNET_NOLOGO': '1'}

    def setup():
        os.umask(0o077)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    started = time.monotonic()
    child = subprocess.Popen(['/work/sdk/dotnet', str(worker), '--request-fd', str(incoming),
                              '--event-fd', str(event_write), '--reply-fd', str(replies)],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=environment, cwd='/work/empty-home', pass_fds=(incoming, event_write, replies),
                             start_new_session=True, preexec_fn=setup)
    os.close(incoming)
    os.close(event_write)
    os.close(replies)
    selector = selectors.DefaultSelector()
    buffers = {'events': bytearray(), 'stdout': bytearray(), 'stderr': bytearray()}
    for stream, name in ((events, 'events'), (child.stdout, 'stdout'), (child.stderr, 'stderr')):
        selector.register(stream, selectors.EVENT_READ, name)
    failure = None
    killed = False
    try:
        while selector.get_map() or child.poll() is None:
            if time.monotonic() - started > HARD_SECONDS:
                failure = 'parent_deadline'
                break
            for key, _ in selector.select(timeout=.05):
                data = os.read(key.fd, 4096)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                buffer = buffers[key.data]
                buffer.extend(data)
                if key.data != 'events' or len(buffer) > MAX_FRAME + 4:
                    failure = 'unexpected_worker_output' if key.data != 'events' else 'invalid_frame'
                    break
            if failure:
                break
        if failure and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            killed = True
        child.wait(timeout=3)
        result = None
        if not failure:
            frame = buffers['events']
            if len(frame) < 4 or struct.unpack('<I', frame[:4])[0] != len(frame) - 4:
                failure = 'invalid_frame'
            else:
                try:
                    result = json.loads(frame[4:])
                    if result.get('type') != 'terminal':
                        failure = 'unexpected_response'
                    elif result.get('status') == 'metadata':
                        metadata = result.get('metadata', {})
                        if child.returncode != 0 or metadata.get('app_id') != APP_ID or metadata.get('entitlement_verified') is not False or metadata.get('content_downloaded') is not False:
                            failure = 'invalid_metadata_result'
                        else:
                            validate_metadata(metadata)
                    elif result.get('status') != 'error' or result.get('code') not in {
                        'cancelled', 'metadata_failed', 'connection_closed', 'logon_rejected',
                        'session_failed', 'session_teardown_timeout', 'session_teardown_failed',
                        'metadata_too_large', 'invalid_metadata', 'provider_error'}:
                        failure = 'unexpected_response'
                except (ValueError, TypeError, AttributeError):
                    failure = 'invalid_response'
        return {'operation': 'anonymous_metadata', 'app_id': APP_ID, 'branch': 'public',
                'worker_sha256': EXPECTED_WORKER, 'attempts': 1, 'elapsed_seconds': round(time.monotonic() - started, 3),
                'worker_exit_code': child.returncode, 'parent_killed_owned_process_group': killed,
                'failure': failure, 'response': result if not failure else None,
                'shared_depot_selection': shared_selection(result['metadata']) if not failure and result.get('status') == 'metadata' else None,
                'stdout_bytes': len(buffers['stdout']), 'stderr_bytes': len(buffers['stderr']),
                'entitlement_verified': False, 'auth_credentials_supplied': False,
                'license_or_content_requests': False, 'http_metadata_uri_followed': False}
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=3)
        selector.close()
        os.close(events)
        os.close(reply_write)
        child.stdout.close()
        child.stderr.close()


if __name__ == '__main__':
    try:
        receipt = run()
    except Exception:
        receipt = {'failure': 'controller_failed', 'operation': 'anonymous_metadata',
                   'app_id': APP_ID, 'entitlement_verified': False}
    print(json.dumps(receipt, separators=(',', ':')))
