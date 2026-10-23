"""Real official FRP Store acceptance. Only a new --network none Docker container.
Run: python tools/runtime/test-frp-store.py
Downloads official releases into a temporary directory, verifies published checksums,
and removes only its own container and temporary directory. No host ports published.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import tomllib
import urllib.error
import urllib.request
import uuid


def request(url, method='GET', body=None, auth=True):
    headers = {'Content-Type': 'application/json'}
    if auth:
        headers['Authorization'] = 'Basic ' + base64.b64encode(b'test:isolated-only').decode()
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def inside():
    root = Path('/test')
    evidence = {'versions': {}, 'checks': [], 'scope': 'one new network-none Docker container; loopback real FRPS/FRPC processes; synthetic echo traffic, not gameplay'}
    processes = []
    def check(name, condition, **details):
        evidence['checks'].append(dict(name=name, passed=bool(condition), **details))
        assert condition, name
    def start(version, binary, config):
        log = open(root / (binary + '-' + version + '.log'), 'a')
        p = subprocess.Popen([str(root / ('frp_' + version + '_linux_amd64') / binary), '-c', str(config)], stdout=log, stderr=log)
        processes.append(p)
        return p
    def wait(fn):
        end = time.monotonic() + 15
        while time.monotonic() < end:
            try:
                result = fn()
                if result:
                    return result
            except (OSError, ValueError):
                pass
            time.sleep(.1)
        raise RuntimeError('readiness timeout')
    def tcp_echo(c):
        with c:
            while True:
                b = c.recv(4096)
                if not b:
                    break
                c.sendall(b)
    def serve_tcp():
        s = socket.socket(); s.bind(('127.0.0.1', 19001)); s.listen()
        while True:
            c, _ = s.accept(); threading.Thread(target=tcp_echo, args=(c,), daemon=True).start()
    def serve_udp():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('127.0.0.1', 19002))
        while True:
            b, addr = s.recvfrom(4096); s.sendto(b, addr)
    threading.Thread(target=serve_tcp, daemon=True).start()
    threading.Thread(target=serve_udp, daemon=True).start()
    api = 'http://127.0.0.1:17400'
    def call(method='GET', path='/api/store/proxies', body=None):
        return request(api + path, method, body)
    def definition(name, typ, remote):
        return dict(name=name, type=typ, **{typ: dict(localIP='127.0.0.1', localPort=19001 if typ == 'tcp' else 19002, remotePort=remote)})
    def running(name):
        code, body = call(path='/api/status')
        return code == 200 and any(x['name'] == name and x['status'] == 'running' for group in json.loads(body).values() for x in group)
    try:
        for v in ('0.68.0', '0.67.0'):
            evidence['versions'][v] = subprocess.check_output([str(root / ('frp_' + v + '_linux_amd64') / 'frpc'), '-v'], text=True).strip()
        server = root / 'frps.toml'; server.write_text('bindAddr = "127.0.0.1"\nbindPort = 17000\nauth.method = "token"\nauth.token = "isolated-frps-only"\n')
        config = root / 'frpc.toml'; config.write_text('serverAddr = "127.0.0.1"\nserverPort = 17000\nwebServer.addr = "127.0.0.1"\nwebServer.port = 17400\nwebServer.user = "test"\nwebServer.password = "isolated-only"\n[store]\npath = "/test/store.json"\n')
        config.write_text('auth.method = "token"\nauth.token = "isolated-frps-only"\n' + config.read_text())
        start('0.68.0', 'frps', server)
        def server_ready():
            with socket.create_connection(('127.0.0.1',17000),timeout=.2): return True
        wait(server_ready)
        client = start('0.68.0', 'frpc', config)
        wait(lambda: call()[0] == 200)
        code, raw = call(path='/api/config')
        parsed = tomllib.loads(raw)
        check('backend-only config comparison',code == 200 and parsed['serverAddr']=='127.0.0.1' and parsed['serverPort']==17000 and parsed['auth']['token']=='isolated-frps-only')
        probe = definition('wizard-probe','tcp',18009); probe['tcp']['localPort']=9
        code, _ = call('POST',body=probe); check('wizard probe accepted',code==200)
        wait(lambda: running('wizard-probe'))
        status = json.loads(call(path='/api/status')[1])
        record = next(x for x in status['tcp'] if x['name']=='wizard-probe')
        check('wizard running proves authenticated session and remote bind with closed local target',record['err']=='' and record['remote_addr']=='127.0.0.1:18009',status=record)
        code, _=call('DELETE','/api/store/proxies/wizard-probe'); check('wizard probe cleanup',code==200)
        check('authentication required', request(api + '/api/store/proxies', auth=False)[0] == 401)
        code, body = call('POST', body=definition('a', 'tcp', 18001)); check('create A', code == 200, http=code, response=json.loads(body))
        wait(lambda: running('a'))
        a = socket.create_connection(('127.0.0.1', 18001), timeout=2)
        stop = threading.Event(); failures = []; samples = []
        def sustain():
            try:
                while not stop.is_set():
                    payload = ('sequence-%08d' % len(samples)).encode()
                    a.sendall(payload); received = b''
                    while len(received) < len(payload):
                        chunk = a.recv(len(payload) - len(received))
                        if not chunk: raise RuntimeError('EOF')
                        received += chunk
                    if received != payload: raise RuntimeError('payload mismatch')
                    samples.append(time.monotonic()); time.sleep(.02)
            except Exception as e:
                failures.append(str(e))
        worker = threading.Thread(target=sustain); worker.start()
        time.sleep(10)
        original_pid = client.pid
        code, body = call('POST', body=definition('b', 'tcp', 18002)); check('create B', code == 200, http=code)
        wait(lambda: running('b'))
        with socket.create_connection(('127.0.0.1', 18002), timeout=2) as b:
            b.sendall(b'new-port-B'); check('B reachable', b.recv(10) == b'new-port-B')
        code, body = call(path='/api/store/proxies/b'); check('GET B definition', code == 200 and json.loads(body)['name'] == 'b')
        code, _ = call('PUT', '/api/store/proxies/b', definition('b','tcp',18002)); check('PUT B definition',code == 200)
        time.sleep(10)
        code, _ = call('DELETE', '/api/store/proxies/b'); check('delete B', code == 200, http=code)
        def closed():
            try:
                with socket.create_connection(('127.0.0.1', 18002), timeout=.2): return False
            except OSError: return True
        wait(closed)
        time.sleep(10)
        code, _ = call('POST', body=definition('u', 'udp', 18003)); check('create UDP', code == 200)
        wait(lambda: running('u'))
        u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(2)
        for i in range(100):
            payload = ('udp-%d' % i).encode(); u.sendto(payload, ('127.0.0.1', 18003)); assert u.recv(4096) == payload
        u.close(); check('UDP 100 round trips', True)
        code, _ = call('POST', body=definition('a', 'tcp', 18001)); check('duplicate conflict', code == 409, http=code)
        code, _ = call('POST', body={'name':'bad','type':'tcp','localPort':19001,'remotePort':18004}); check('flat request rejected', code == 400, http=code)
        time.sleep(2); stop.set(); worker.join(); a.close()
        check('same sustained A socket survives B add/remove and UDP add', not failures and len(samples) > 100 and client.poll() is None and client.pid == original_pid, round_trips=len(samples), duration_seconds=round(samples[-1]-samples[0], 3), max_gap_seconds=round(max(y-x for x,y in zip(samples,samples[1:])), 3), errors=failures)
        saved = json.loads((root/'store.json').read_text()); check('Store persisted on disk', bool(saved))
        client.terminate(); client.wait(timeout=5)
        client = start('0.68.0', 'frpc', config)
        wait(lambda: running('a') and running('u'))
        check('restart restores A and UDP; B remains deleted', {p['name'] for p in json.loads(call()[1])['proxies']} == {'a','u'})
        with socket.create_connection(('127.0.0.1',18001),timeout=2) as c:
            c.sendall(b'restored'); check('TCP after restart',c.recv(8)==b'restored')
        u=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); u.settimeout(2); u.sendto(b'restored-udp',('127.0.0.1',18003)); check('UDP after restart',u.recv(100)==b'restored-udp'); u.close()
        old = root/'old.toml'; old.write_text('serverAddr = "127.0.0.1"\nserverPort = 17000\nwebServer.addr = "127.0.0.1"\nwebServer.port = 17401\nwebServer.user = "test"\nwebServer.password = "isolated-only"\n')
        old.write_text('auth.method = "token"\nauth.token = "isolated-frps-only"\n'+old.read_text())
        start('0.67.0','frpc',old)
        wait(lambda: request('http://127.0.0.1:17401/api/status')[0]==200)
        code, _ = request('http://127.0.0.1:17401/api/store/proxies'); check('v0.67.0 Store unsupported',code==404,http=code)
        disabled = root/'disabled.toml'; disabled.write_text(old.read_text().replace('17401','17402'))
        start('0.68.0','frpc',disabled)
        wait(lambda: request('http://127.0.0.1:17402/api/status')[0]==200)
        code, body=request('http://127.0.0.1:17402/api/store/proxies'); check('v0.68.0 Store disabled',code==404,http=code,response=body.strip())
        evidence['passed'] = True
    finally:
        for p in processes:
            if p.poll() is None:
                p.terminate()
                try: p.wait(timeout=5)
                except subprocess.TimeoutExpired: p.kill(); p.wait()
        if not evidence.get('passed'):
            evidence['diagnostic_logs'] = {p.name:p.read_text() for p in root.glob('*.log')}
        (root/'evidence.json').write_text(json.dumps(evidence,indent=2))


def host():
    project = Path(__file__).resolve().parents[2]
    out = project/'.local'/'frp-runtime-evidence.json'
    name = 'frp-store-test-' + uuid.uuid4().hex[:12]
    checksums = {}
    with tempfile.TemporaryDirectory(prefix='frp-store-test-') as tmp:
        work = Path(tmp)
        for version in ('0.68.0','0.67.0'):
            base = 'https://github.com/fatedier/frp/releases/download/v' + version + '/'
            filename = 'frp_' + version + '_linux_amd64.tar.gz'
            sums = urllib.request.urlopen(base+'frp_sha256_checksums.txt').read().decode()
            expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip('*') == filename)
            archive = work/filename
            urllib.request.urlretrieve(base+filename,archive)
            actual = hashlib.sha256(archive.read_bytes()).hexdigest()
            assert actual == expected, 'official checksum mismatch'
            checksums[version] = dict(url=base+filename,sha256=actual,verified=True)
            with tarfile.open(archive) as tar: tar.extractall(work,filter='data')
        (work/'runner.py').write_bytes(Path(__file__).read_bytes())
        try:
            result = subprocess.run(['docker','run','--rm','--name',name,'--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','-v',str(work)+':/test','python:3.13-slim','python','/test/runner.py','--inside'])
            evidence = json.loads((work/'evidence.json').read_text())
            evidence['downloads'] = checksums
            evidence['container_name'] = name
            evidence['docker_exit_code'] = result.returncode
            evidence['timestamp_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
            out.parent.mkdir(exist_ok=True)
            out.write_text(json.dumps(evidence,indent=2))
            print(json.dumps(evidence,indent=2))
            if result.returncode: raise SystemExit(result.returncode)
        finally:
            # Exact unique name only; never enumerate or alter other containers.
            subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    inside() if '--inside' in sys.argv else host()
