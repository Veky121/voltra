"""Bounded matching-client diagnostics on own Xvfb; never the Windows desktop."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import time
import zlib

ROOT = Path('/home/container')
SESSION = ROOT / '.voltra/tachyon-client-session.json'


def display():
    lib = ctypes.CDLL('libX11.so.6')
    lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
    lib.XOpenDisplay.restype = ctypes.c_void_p
    connection = lib.XOpenDisplay(b':97')
    if not connection:
        raise RuntimeError('Owned client display missing')
    return lib, connection


def snapshot():
    session = json.loads(SESSION.read_text())
    base = Path(session['base'])
    assert base.is_relative_to(ROOT / '.voltra/tachyon-client-proof')
    lib, connection = display()
    lib.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    lib.XDefaultRootWindow.restype = ctypes.c_ulong
    lib.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
    lib.XGetImage.restype = ctypes.c_void_p
    image = lib.XGetImage(connection, lib.XDefaultRootWindow(connection), 0, 0, 1280, 720, 0xffffffff, 2)
    assert image
    lib.XGetPixel.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    lib.XGetPixel.restype = ctypes.c_ulong
    pixels = bytearray()
    for y in range(720):
        pixels.append(0)
        for x in range(1280):
            v = lib.XGetPixel(image, x, y)
            pixels.extend(((v >> 16) & 255, (v >> 8) & 255, v & 255))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    target = base / ('client-' + str(time.time_ns()) + '.png')
    target.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1280, 720, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))
    lib.XDestroyImage.argtypes = [ctypes.c_void_p]
    lib.XDestroyImage(image)
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    lib.XCloseDisplay(connection)
    print(json.dumps({'screenshot': str(target)}), flush=True)


def click(x, y):
    assert 0 <= x < 1280 and 0 <= y < 720
    session = json.loads(SESSION.read_text())
    args = Path('/proc', str(session['client_pid']), 'cmdline').read_bytes().split(b'\0')
    assert b'TachyonsCE.jar' in args
    lib, connection = display()
    xtest = ctypes.CDLL('libXtst.so.6')
    xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    xtest.XTestFakeMotionEvent(connection, -1, x, y, 0)
    xtest.XTestFakeButtonEvent(connection, 1, 1, 0)
    xtest.XTestFakeButtonEvent(connection, 1, 0, 0)
    lib.XFlush.argtypes = [ctypes.c_void_p]
    lib.XFlush(connection)
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    lib.XCloseDisplay(connection)
    print(json.dumps({'clicked': [x, y]}), flush=True)


def run():
    archive = ROOT / '.voltra/tachyon-client-source.zip'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == '516cc90196e1bc4c27ae2bf8fed01ad25730d9fbc92b23fc49ead0935dfb85ac'
    base = ROOT / '.voltra/tachyon-client-proof' / str(time.time_ns())
    payload = base / 'payload'
    payload.mkdir(parents=True)
    sys.path.insert(0, str(ROOT / '.voltra'))
    from small_games_family_install import extract_zip
    extract_zip(archive, payload, 'client/')
    assert hashlib.sha256((payload / 'TachyonsCE.jar').read_bytes()).hexdigest() == 'a2c45c3c334b883ede37371553e7c3a4aa8b2c29c08e14dd06e8819a431e03d3'
    config = payload / 'Data/GameData.dat'
    data = config.read_bytes().replace(b'PORT=30303', b'PORT=29107').replace(b'LOGIN=Player', b'LOGIN=ParityTachyon').replace(b'SOUND=0.6', b'SOUND=0.0').replace(b'MUSIC=0.3', b'MUSIC=0.0')
    config.write_bytes(data)
    native_cfg = ROOT / 'tachyon/config.cfg'
    original = hashlib.sha256(native_cfg.read_bytes()).hexdigest()
    assert not Path('/tmp/.X97-lock').exists()
    env = dict(os.environ, DISPLAY=':97', HOME=str(base), LIBGL_ALWAYS_SOFTWARE='1', ALSOFT_DRIVERS='null')
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
        env.pop(key, None)
    xlog = (base / 'xvfb.log').open('wb')
    clog = (base / 'client.log').open('wb')
    x = client = None
    report = {}
    try:
        x = subprocess.Popen(['Xvfb', ':97', '-screen', '0', '1280x720x24', '-nolisten', 'tcp', '-ac'], env=env, stdout=xlog, stderr=subprocess.STDOUT, start_new_session=True)
        time.sleep(1)
        assert x.poll() is None
        client = subprocess.Popen([str(ROOT / '.voltra/java8/bin/java'), '-Xmx256M', '-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=true', '-jar', 'TachyonsCE.jar'], cwd=payload, env=env, stdout=clog, stderr=subprocess.STDOUT, start_new_session=True)
        session = {'base': str(base), 'client_pid': client.pid, 'xvfb_pid': x.pid, 'duration_seconds': 75}
        SESSION.write_text(json.dumps(session))
        print(json.dumps({'stage': 'client-started', **session}), flush=True)
        deadline = time.time() + 75
        while time.time() < deadline and client.poll() is None:
            time.sleep(.5)
        report = {**session, 'client_exit_before_cleanup': client.poll()}
    finally:
        for child in (client, x):
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=3)
        xlog.close()
        clog.close()
    report.update(client_cleaned=client is None or client.poll() is not None, display_cleaned=x is None or x.poll() is not None, native_config_unchanged=original == hashlib.sha256(native_cfg.read_bytes()).hexdigest(), client_log_tail=(base / 'client.log').read_text(errors='replace')[-6000:])
    (base / 'result.json').write_text(json.dumps(report))
    print(json.dumps({'stage': 'complete', **report}), flush=True)


if __name__ == '__main__':
    if sys.argv[1] == 'run':
        run()
    elif sys.argv[1] == 'snapshot':
        snapshot()
    elif sys.argv[1] == 'click':
        click(int(sys.argv[2]), int(sys.argv[3]))
