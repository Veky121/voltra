#!/bin/bash
set -euo pipefail
# Voltra clean-directory publication for the original CurseForge Generic egg.
root="${SERVER_DIR:-/mnt/server}"
mkdir -p "$root/.voltra"
work=$(mktemp -d "$root/.voltra/curseforge-install.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
if ! command -v python3 >/dev/null; then
    apt-get update
    apt-get install -y --no-install-recommends python3 ca-certificates
fi
cat > "$work/minecraft_install.py" <<'VOLTRA_SHARED_PY'
# VOLTRA_SHARED_INSTALLER
VOLTRA_SHARED_PY
printf '%s' 'VOLTRA_ORIGINAL_BASE64' | base64 -d > "$work/original.sh"
mkdir "$work/server"
if [[ "${PROJECT_ID:-}" == zip ]]; then
    cp "$root/server.zip" "$work/server/server.zip"
    if [[ -f "$root/client.manifest.json" ]]; then
        cp "$root/client.manifest.json" "$work/server/client.manifest.json"
    fi
fi
echo 'Voltra: preparing CurseForge pack in a clean staging directory.'
SERVER_DIR="$work/server" bash "$work/original.sh"
PYTHONPATH="$work" python3 - "$work/server" "$root" <<'VOLTRA_PUBLISH_PY'
import hashlib,json,os,shutil,sys,tempfile
from pathlib import Path
from minecraft_install import pack_content_transaction, PACK_REPLACE, PACK_PRESERVE, safe_target, safe_name
stage,root=map(Path,sys.argv[1:])
# Refuse an incomplete pack before removing anything from the active install.
if not (stage/'mods').is_dir() or not any((stage/'mods').glob('*.jar')):
    raise ValueError('CurseForge installer did not produce a nonempty mods directory')
files={}
for source in stage.rglob('*'):
    relative=source.relative_to(stage).as_posix()
    if source.is_symlink():
        if not source.resolve().is_relative_to(stage.resolve()):
            raise ValueError('Installer link escapes staging')
    elif not (source.is_file() or source.is_dir()):
        raise ValueError('Installer produced a special file')
    if relative.startswith('mods/') and source.is_file():
        files[relative]=hashlib.sha256(source.read_bytes()).hexdigest()
print('Voltra: clearing active mods and pack scripts; installing only the selected pack files.')
with pack_content_transaction(stage,root):
    # Loader files are taken from this successful staged native installation.
    # Save data and administrator settings never come from publisher defaults.
    for source in sorted(stage.rglob('*')):
        relative=source.relative_to(stage).as_posix();first=relative.split('/')[0]
        if first in PACK_REPLACE or first in PACK_PRESERVE or first.startswith('world') or first in {'.voltra','logs','backups','crash-reports'}:
            continue
        if source.is_symlink():
            parts=safe_name(relative).parts
            parent=safe_target(root,"/".join(parts[:-1])) if len(parts)>1 else root
            destination=parent/parts[-1]
            destination.parent.mkdir(parents=True,exist_ok=True)
            temporary=destination.with_name(destination.name+'.voltra-new')
            if temporary.exists() or temporary.is_symlink():
                raise ValueError('Loader publication temporary path already exists')
            try:
                temporary.symlink_to(os.readlink(source))
                os.replace(temporary,destination)
            finally:
                temporary.unlink(missing_ok=True)
        elif source.is_dir():
            safe_target(root,relative).mkdir(parents=True,exist_ok=True)
        else:
            destination=safe_target(root,relative)
            destination.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source,destination)
    actual={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'mods').rglob('*') if p.is_file()}
    if actual!=files:raise ValueError('Installed mods do not match staged pack')
    receipt=root/'.voltra/curseforge-pack-install.json'
    receipt.write_text(json.dumps({'mods':files,'mode':'clean-directory','project':os.environ.get('PROJECT_ID'),'version':os.environ.get('VERSION_ID')},sort_keys=True)+'\n')
print('Voltra: verified '+str(len(files))+' pack mod files; obsolete mod files removed.')
VOLTRA_PUBLISH_PY
