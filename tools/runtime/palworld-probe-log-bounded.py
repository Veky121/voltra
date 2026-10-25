"""MIT. Bound only diagnostic logs, never Proton/Wine file or mapping limits."""
from pathlib import Path
import os
import resource
import signal
import stat
import subprocess
import sys
import time

# Detect the previous confounder rather than carrying it into another run.
if resource.getrlimit(resource.RLIMIT_FSIZE)[0]!=resource.RLIM_INFINITY:
    raise ValueError('Probe cannot inherit a file-size limit')
directory=Path('/home/container/private-logs')
child=subprocess.Popen(['/usr/bin/xvfb-run','-a','/usr/local/bin/proton','run','/home/container/public-probe/runtime-probe.exe'],start_new_session=True)
stopping=False
def stop(signum=None,frame=None):
    global stopping
    stopping=True
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
deadline=time.monotonic()+890
limited=False
while child.poll() is None:
    total=0
    for path in directory.iterdir():
        with os.fdopen(os.open(path,os.O_RDWR|os.O_NOFOLLOW),'r+b') as log:
            info=os.fstat(log.fileno())
            if not stat.S_ISREG(info.st_mode):raise ValueError('Regular private log required')
            remaining=max(0,16*1024*1024-total)
            if info.st_size>=remaining:
                log.truncate(remaining);limited=True;stop()
            total+=min(info.st_size,remaining)
    if time.monotonic()>=deadline:stop()
    if stopping:
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            # Request parent container's normal cleanup; do not silently
            # turn a stuck child into a successful import proof.
            print('PUBLIC_PROBE_CHILD_STOP_UNRESOLVED',flush=True)
            sys.exit(74)
    time.sleep(0.05)
if limited:
    print('PUBLIC_PROBE_LOG_LIMIT_REACHED',flush=True);sys.exit(73)
code=child.returncode
sys.exit(code if code>=0 else 128-code)
