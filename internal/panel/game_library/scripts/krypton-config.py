"""Publisher --init only, confined to empty staging; never operator-uploaded code."""
from pathlib import Path
from krypton_source_build import run_phase


def generate(jar,java,staging):
    staging=Path(staging)
    staging.mkdir(mode=0o700)
    java=Path(java).resolve();jar=Path(jar).resolve()
    env={'JAVA_HOME':str(java.parent.parent),'PATH':str(java.parent)+':/usr/bin:/bin','HOME':str(staging),'LANG':'C.UTF-8'}
    run_phase([str(java),'-Xms64m','-Xmx1024m','-jar',str(jar),'--init'],staging,env,timeout=180)
    result=staging/'config.conf'
    if result.is_symlink() or not result.is_file() or not 0<result.stat().st_size<=1024**2:
        raise ValueError('Pinned Krypton --init did not produce a bounded native configuration')
    if any((staging/name).exists() for name in ('world','playerdata','usercache.json')):
        raise ValueError('Krypton config-only initialization unexpectedly created game state')
    return result
