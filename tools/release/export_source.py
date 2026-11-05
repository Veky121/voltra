"""Export the module to a clean publication checkout, keeping agent notes local."""
import argparse
from pathlib import Path
import shutil
import subprocess

PRODUCT_DOCS = {
    'README.md', 'LICENSE.md', 'CLOUDFLARE.md', 'FILE_MANAGER.md',
    'FRP_PROXY.md', 'FS25.md', 'GAME_SETUP.md', 'MINECRAFT_SETUP.md',
    'RELEASES.md', 'REMOTE_DOWNLOAD_HEADERS.md', 'SERVER_ARTWORK.md',
    'STEAM.md', 'WINGS.md', 'docs/README.md', 'docs/LOCAL_DEVELOPMENT.md',
    'docs/FRP_SUBDOMAINS.md', 'docs/FS25_DLC_UPDATES.md',
    'docs/GAME_OPERATION_REPORTING.md', 'docs/LIVE_EVENTS.md',
    'docs/PANEL_NOTIFICATIONS.md', 'internal/steamapi/PROTOCOL.md',
}


def publishable(path):
    name = path.name.lower()
    if any(part in {'.git', '.local', 'artifacts', 'node_modules', 'obj', '__pycache__'} for part in path.parts):
        return False
    if path.as_posix().startswith(('web/dist/', 'desktop/bin/', 'desktop/build/', 'desktop/frontend/')):
        return path.as_posix() == 'desktop/frontend/.gitkeep'
    if name.startswith('.env') and name not in {'.env.example', '.env.ci'}:
        return False
    if path.suffix.lower() in {'.log', '.pending', '.pem', '.key', '.pfx', '.p12', '.db', '.sqlite', '.sqlite3', '.pyc', '.test'}:
        return False
    if path.suffix.lower() == '.exe':
        return path.as_posix() == 'internal/palworldloader/assets/runtime-probe.exe'
    if path.suffix.lower() == '.md':
        return (path.as_posix() in PRODUCT_DOCS or name == 'readme.md'
                or name in {'sources.md', 'patches.md'} or 'license' in name or 'licence' in name)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[2]
    destination = args.destination.resolve()
    if destination == source or not (destination / '.git').exists():
        raise SystemExit('Destination must be a separate clean Git checkout')
    if subprocess.check_output(['git', '-C', str(destination), 'status', '--porcelain']):
        raise SystemExit('Destination must be clean')
    root = Path(subprocess.check_output(['git', '-C', str(source), 'rev-parse', '--show-toplevel'], text=True).strip())
    prefix = source.relative_to(root)
    files = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', str(prefix)], text=True).split('\0')
    selected = set()
    for item in filter(None, files):
        local = root / item
        relative = local.relative_to(source)
        if not local.is_file() or not publishable(relative):
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local, target)
        selected.add(relative.as_posix())
    removed = []
    tracked = subprocess.check_output(['git', '-C', str(destination), 'ls-files', '-z'], text=True).split('\0')
    for item in filter(None, tracked):
        if item not in selected:
            target = destination / item
            if target.is_file():
                target.unlink()
            removed.append(item)
    print(f'Exported {len(selected)} files; removed {len(removed)} obsolete or private files from publication checkout.')
    for item in removed:
        if item.endswith('.md'):
            print('Removed public document:', item)


if __name__ == '__main__':
    main()
