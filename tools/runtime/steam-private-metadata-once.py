"""MIT. Reviewed one-shot anonymous app3809400 metadata controller; no retries."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import struct
import subprocess
import time

EXPECTED_WORKER = 'bd9aafd30778732305920488ac115bf3974c3132bb4aef2f60fb32915937b125'
APP_ID = 3809400
MAX_FRAME = 65536
HARD_SECONDS = 35


def run():
    worker = Path('/work/build/Worker.dll')
    if hashlib.sha256(worker.read_bytes()).hexdigest() != EXPECTED_WORKER:
        raise RuntimeError('frozen_worker_mismatch')
    # Anonymous/public only. No configurable account, app, URL or operation input.
    request = {'operation': 'anonymous_metadata', 'username': None, 'password': None,
               'guard': None, 'branch': 'public', 'beta_password': None,
               'app_id': APP_ID, 'parent_fields_validated': True}
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
