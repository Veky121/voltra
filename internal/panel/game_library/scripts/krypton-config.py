"""Publisher --init only, confined to empty staging; never operator-uploaded code."""
from pathlib import Path
import os
from krypton_source_build import run_phase


def generate(jar,java,staging):
    staging=Path(staging).absolute()
    # Refuse redirected or occupied workspaces before invoking Java or writing.
    for path in (staging, *staging.parents):
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise ValueError('Krypton config staging must not traverse links')
    if staging.exists() or not staging.parent.is_dir():
        raise ValueError('Krypton config staging must be a new directory with an existing parent')
    jar=Path(jar).resolve(strict=True);java=Path(java).resolve(strict=True)
    if not jar.is_file() or not java.is_file() or not os.access(java,os.X_OK):
        raise ValueError('Krypton config initialization requires a regular JAR and executable Java')
    staging.mkdir(mode=0o700)
    env={'JAVA_HOME':str(java.parent.parent),'PATH':str(java.parent)+':/usr/bin:/bin','HOME':str(staging),'LANG':'C.UTF-8'}
    run_phase([str(java),'-Xms64m','-Xmx1024m','-jar',str(jar),'--init'],staging,env,timeout=180)
    result=staging/'config.conf'
    if result.is_symlink() or not result.is_file() or not 0<result.stat().st_size<=1024**2:
        raise ValueError('Pinned Krypton --init did not produce a bounded native configuration')
    if any((staging/name).exists() for name in ('world','playerdata','usercache.json')):
        raise ValueError('Krypton config-only initialization unexpectedly created game state')
    return result
