"""Freeroam AI prerequisite gate. Never acquires car, track or spline content."""
import configparser
import os
from pathlib import Path
import re
import sys


def content_preflight(authority, shared, root, environment, running=False):
    plan = authority.preflight(shared, root, 'assettoserver', environment,
                               require_files=running, allocated=True)
    def document(relative):
        path = authority.safe(root, relative)
        if not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Import the real AI preset and content before acquisition')
        return path.read_text(encoding='utf-8-sig')
    config = configparser.ConfigParser(interpolation=None, strict=True)
    config.read_string(document('cfg/server_cfg.ini'))
    entries = configparser.ConfigParser(interpolation=None, strict=True)
    entries.read_string(document('cfg/entry_list.ini'))
    def component(value, optional=False):
        if optional and not value:
            return value
        if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
            raise ValueError('Unsupported content path; operator review required')
        return value
    server = config['SERVER']
    track = component(server.get('TRACK', ''))
    layout = component(server.get('CONFIG_TRACK', ''), True)
    cars = [component(x.strip()) for x in server.get('CARS', '').split(';')]
    track_path = 'content/tracks/' + track + ('/' + layout if layout else '')
    document(track_path + '/data/surfaces.ini')
    if not config.has_section('PRACTICE') or any(config.has_section(s) for s in ('RACE', 'QUALIFY', 'BOOK')):
        raise ValueError('Reviewed AI release requires practice-only sessions')
    slots = [entries[s] for s in entries.sections() if re.fullmatch(r'CAR_[0-9]+', s)]
    if not slots:
        raise ValueError('Import real entry-list slots')
    for slot in slots:
        model = component(slot.get('MODEL', ''))
        if model not in cars or slot.get('AI', 'auto') not in ('auto', 'fixed', 'none'):
            raise ValueError('Entry model or AI mode disagrees with preset')
        folder = root / 'content/cars' / model
        if not any(authority.safe(root, str((folder / name).relative_to(root))).is_file()
                   for name in ('data.acd', 'data/car.ini')):
            raise ValueError('Import legitimate car physics data')
    extra = document('cfg/extra_cfg.yml')
    if re.search(r'^EnableAi:\s*true\s*(?:#.*)?$', extra, re.M):
        if not any(authority.safe(root, track_path + '/ai/' + name).is_file()
                   for name in ('fast_lane.ai', 'fast_lane.aip')):
            raise ValueError('Import a compatible operator-provided AI spline')
    return plan


def main():
    import importlib.util
    path = Path(__file__).with_name('assetto-native-authority.py')
    spec = importlib.util.spec_from_file_location('ai_authority', path)
    authority = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(authority)
    shared = authority.load_shared()
    if sys.argv[1:] not in (['install', 'assettoserver'], ['run', 'assettoserver']):
        raise ValueError('Exact AI recipe required')
    action = sys.argv[1]
    root = Path.cwd().resolve()
    content_preflight(authority, shared, root, dict(os.environ), action == 'run')
    if action == 'install':
        shared.helper('assetto-ai-release').install_release(root, shared.assettoserver_release(), '.', 'AssettoServer')
        return 0
    return authority.main(shared)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, configparser.Error):
        print('AI setup refused. Review operator preset, licensed content, sessions, spline, allocations and publisher receipt.', file=sys.stderr)
        sys.exit(1)
