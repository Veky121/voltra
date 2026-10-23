#!/usr/bin/env python3
"""MIT. Licensed Foundry Node distribution installer; no bundled publisher code."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

LIMIT = 4 * 1024**3

def confined(root, path):
    root = root.resolve()
    path = Path(path)
    if not path.absolute().is_relative_to(root) or path.is_symlink():
        raise ValueError('Foundry path escapes server storage')
    for part in path.parents:
        if part == root: break
        if part.is_symlink(): raise ValueError('Foundry path contains a symbolic link')
    return path

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.foundry-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.chmod(name, stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def options(root, env, update=False):
    path = confined(root, root/'data'/'Config'/'options.json')
    if path.exists():
        value = json.loads(path.read_text())
        if not isinstance(value, dict): raise ValueError('Foundry options must be a JSON object')
        if not update: return value
    else: value = {'upnp':False, 'fullscreen':False, 'proxySSL':False, 'minifyStaticFiles':True}
    port = env.get('SERVER_PORT', '30000')
    if not re.fullmatch('[0-9]+', port) or not 1 <= int(port) <= 65535: raise ValueError('Invalid server port')
    for key, target, default, limit in [('FOUNDRY_LANGUAGE','language','en.core',20),('UPDATE_CHANNEL','updateChannel','release',256)]:
        text = env.get(key, default)
        if len(text)>limit or any(ord(c)<32 or ord(c)==127 for c in text): raise ValueError('Invalid '+key)
        value[target] = text
    value['port'] = int(port)
    atomic(path, value)
    return value

def https(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or any(ord(c)<=32 or ord(c)==127 for c in url):
        raise ValueError('A valid HTTPS timed download URL is required')
    return url

class SecureRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return super().redirect_request(request, fp, code, msg, headers, https(newurl))

def download(url, destination):
    https(url)
    try:
        opener = urllib.request.build_opener(SecureRedirect())
        with opener.open(url, timeout=60) as source, destination.open('wb') as output:
            size = 0
            while chunk := source.read(1024*1024):
                size += len(chunk)
                if size > LIMIT: raise ValueError('Archive exceeds supported size')
                output.write(chunk)
    except Exception:
        raise ValueError('Licensed download failed; obtain a fresh Node distribution timed URL') from None

def extract(archive, destination):
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries)>200000 or sum(x.file_size for x in entries)>LIMIT: raise ValueError('Foundry archive exceeds extraction limits')
        seen = set()
        for entry in entries:
            name = entry.filename
            path = PurePosixPath(name)
            mode = entry.external_attr >> 16
            if not name or '\\' in name or ':' in name or '\0' in name or name.startswith('/') or '..' in path.parts or name.rstrip('/') in seen:
                raise ValueError('Unsafe Foundry archive path')
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR): raise ValueError('Foundry archive links and special files are forbidden')
            seen.add(name.rstrip('/'))
        for entry in entries:
            target = destination.joinpath(*PurePosixPath(entry.filename).parts)
            if entry.is_dir(): target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(entry) as src, target.open('xb') as dst: shutil.copyfileobj(src, dst)

def entrypoint(app):
    for name in ('main.mjs','main.js','resources/app/main.mjs','resources/app/main.js'):
        path = app/name
        if path.is_file(): return path
    raise ValueError('Archive lacks a supported Foundry Node entry point; select the Node distribution')

def install(root, env, downloader=download):
    app = confined(root, root/'app'); backup = confined(root, root/'.voltra'/'foundry-app-backup')
    if backup.exists(): raise ValueError('Previous Foundry application backup needs operator recovery')
    # Validate existing configuration before any download or application replacement.
    options(root, env)
    pin = env.get('FOUNDRY_SHA256', '')
    if pin and not re.fullmatch('[a-fA-F0-9]{64}', pin): raise ValueError('Invalid optional archive SHA256')
    with tempfile.TemporaryDirectory(prefix='.foundry-install-', dir=root) as temporary:
        temporary = Path(temporary); archive = temporary/'package.zip'; candidate = temporary/'app'; candidate.mkdir()
        downloader(env.get('TIMED_URL',''), archive)
        with archive.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if pin and digest != pin.lower(): raise ValueError('Licensed archive checksum mismatch')
        extract(archive, candidate); entrypoint(candidate)
        backup.parent.mkdir(parents=True, exist_ok=True)
        existed = app.exists()
        if existed: os.replace(app, backup)
        try: os.replace(candidate, app)
        except BaseException:
            if existed: os.replace(backup, app)
            raise
        if existed: shutil.rmtree(backup)
        atomic(confined(root, root/'.voltra'/'foundry-install.json'), {'archive_sha256':digest,'bytes':archive.stat().st_size,'entrypoint':str(entrypoint(app).relative_to(app)),'licensed_runtime_verified':False})
    print('Licensed Foundry Node archive installed; operator license activation remains required.', flush=True)

def run(root, env):
    options(root, env, update=True)
    entry = entrypoint(confined(root, root/'app'))
    # Shared console imports the shared redactor by its historical module name.
    sys.path.insert(0, str(Path(__file__).parent))
    spec = importlib.util.spec_from_file_location('native_console', Path(__file__).with_name('native-console.py'))
    console = importlib.util.module_from_spec(spec); spec.loader.exec_module(console)
    child_env = dict(env); secret = child_env.pop('TIMED_URL',''); child_env.pop('FOUNDRY_SHA256',None)
    return console.run(root, ['node',str(entry),'--dataPath='+str(root/'data')], child_env, '\x03', credentials=(secret,), terminal_input=True)

if __name__ == '__main__':
    try:
        root = Path.cwd().resolve()
        if sys.argv[1:] == ['install']: install(root, os.environ)
        elif sys.argv[1:] == ['run']: sys.exit(run(root, os.environ))
        else: raise ValueError('Expected install or run')
    except Exception:
        # Exception messages may contain signed URLs, archive paths or operator settings.
        print('Foundry operation failed. Check the Node archive, checksum, configuration and fresh licensed download URL.', file=sys.stderr)
        sys.exit(1)
