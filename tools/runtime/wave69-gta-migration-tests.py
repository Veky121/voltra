"""Execute exact emitted Python under temporary fixtures and denied I/O boundaries."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
from unittest.mock import patch

ACTIVE = None

def audit(event, args):
    if ACTIVE is None:
        return
    if event.startswith(('socket.', 'subprocess.')) or event in ('os.system', 'os.fork', 'os.posix_spawn', 'os.exec'):
        raise AssertionError('Forbidden acquisition/process boundary: ' + event)
    if event == 'open':
        path, mode, flags = args
        if isinstance(path, (str, bytes, os.PathLike)) and (flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)):
            assert Path(os.fsdecode(path)).resolve().is_relative_to(ACTIVE), ('write outside fixture', path)
    if event in ('os.mkdir', 'os.remove', 'os.rmdir', 'os.chmod', 'os.chown'):
        assert Path(args[0]).resolve().is_relative_to(ACTIVE), ('mutation outside fixture', event, args)

sys.addaudithook(audit)

def denied(*args, **kwargs):
    raise AssertionError('Unexpected acquisition or process call')

def load(path):
    spec = importlib.util.spec_from_file_location(path.stem.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def fingerprint(path):
    stat = path.stat()
    return path.read_bytes(), stat.st_mode, stat.st_uid, stat.st_gid

def run(game, before, after):
    global ACTIVE
    outcomes = []
    config = {'altv': 'server.toml', 'ragemp': 'conf.json', 'samp': 'server.cfg'}[game]
    directory = {'altv': 'resources', 'ragemp': 'packages', 'samp': 'gamemodes'}[game]
    env = {'DEDICATED_ARCHIVE_URL': 'https://authorized.invalid/toolkit.tar.gz', 'DEDICATED_ARCHIVE_SHA256': 'a' * 64}
    def record(name):
        outcomes.append({'recipe_game': game, 'test': name, 'outcome': 'pass'})
    sys.dont_write_bytecode = True
    with tempfile.TemporaryDirectory(prefix='wave69-gta-') as temporary:
        base = Path(temporary).resolve()
        ACTIVE = base
        try:
            with patch('urllib.request.urlopen', denied), patch('subprocess.Popen', denied), patch('os.system', denied):
                for version, sources in [('before', before), ('after', after)]:
                    helpers = base / version
                    helpers.mkdir()
                    for name, source in sources.items():
                        (helpers / Path(name).name).write_text(source)
                    gta = load(helpers / 'gta-install.py')
                    legacy = load(helpers / 'gta-legacy-install.py')
                    counter = [0]
                    def root():
                        counter[0] += 1
                        r = helpers / ('fixture-' + str(counter[0]))
                        (r / '.voltra' / game).mkdir(parents=True)
                        (r / game).mkdir()
                        return r
                    def put(path, value=b'stale-root', mode=0o640):
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(value)
                        path.chmod(mode)
                    # Actual migrate, including the historical defect as a positive repro.
                    r = root()
                    put(r / config)
                    put(r / game / config, b'native-operator', 0o600)
                    native = fingerprint(r / game / config)
                    original = fingerprint(r / config)
                    gta.migrate(r, game, [config])
                    assert fingerprint(r / config) == original
                    if version == 'before':
                        assert (r / game / config).read_bytes() == b'stale-root'
                    else:
                        assert fingerprint(r / game / config) == native
                    record(version + ':actual-migrate-existing-native-bytes-mode-uid-gid')
                    # Real legacy identity/restore/migrate ordering; only publisher is synthetic.
                    for existing in [False, True]:
                        r = root()
                        put(r / config)
                        if existing:
                            put(r / game / config, b'operator-restored', 0o600)
                        saved_native = fingerprint(r / game / config) if existing else None
                        calls = []
                        def publish(volume, identity, selected, executable):
                            assert volume == r and selected == game
                            assert identity['url'] == env['DEDICATED_ARCHIVE_URL']
                            assert identity['sha256'] == env['DEDICATED_ARCHIVE_SHA256']
                            assert executable == {'altv': 'altv-server', 'ragemp': 'ragemp-server', 'samp': 'samp03svr'}[game]
                            calls.append(identity)
                            put(volume / game / config, b'publisher-default', 0o600)
                        publisher = types.SimpleNamespace(install_release=publish)
                        def dispatch(name):
                            assert name in ('gta-install', 'native-release')
                            return gta if name == 'gta-install' else publisher
                        with patch.object(legacy, 'module', dispatch):
                            legacy.install(game, r, env)
                            expected = b'stale-root' if version == 'before' else b'operator-restored' if existing else b'publisher-default'
                            assert (r / game / config).read_bytes() == expected
                            if existing and version == 'after':
                                assert fingerprint(r / game / config) == saved_native
                            assert len(calls) == 1
                        record(version + ':actual-legacy-publisher-restore-migrate-existing-' + str(existing))
                    if version == 'before':
                        continue
                    # Absent targets, nested data, receipt repeat and root retention.
                    r = root()
                    put(r / config)
                    put(r / directory / 'nested' / 'owned.txt', b'root-data')
                    put(r / game / directory / 'nested' / 'owned.txt', b'native-data', 0o600)
                    kept = fingerprint(r / game / directory / 'nested' / 'owned.txt')
                    gta.migrate(r, game, [config, directory])
                    assert (r / game / config).read_bytes() == b'stale-root'
                    assert fingerprint(r / game / directory / 'nested' / 'owned.txt') == kept
                    assert (r / directory / 'nested' / 'owned.txt').read_bytes() == b'root-data'
                    put(r / config, b'changed-root')
                    gta.migrate(r, game, [config, directory])
                    assert (r / game / config).read_bytes() == b'stale-root'
                    (r / '.voltra' / game / 'legacy-layout-imported.json').unlink()
                    gta.migrate(r, game, [config, directory])
                    assert (r / game / config).read_bytes() == b'stale-root'
                    assert fingerprint(r / game / directory / 'nested' / 'owned.txt') == kept
                    record('after:absent-target-nested-existing-repeat-and-originals-retained')
                    # Existing directory at file destination is preserved, no copy into it.
                    r = root(); put(r / config); (r / game / config).mkdir()
                    gta.migrate(r, game, [config])
                    assert not list((r / game / config).iterdir())
                    record('after:directory-target-conflict-preserved')
                    # Existing in-volume symlink destination preserves link and referent.
                    r = root(); put(r / config); put(r / 'owned', b'keep', 0o600)
                    (r / game / config).symlink_to(r / 'owned')
                    saved = fingerprint(r / 'owned')
                    gta.migrate(r, game, [config])
                    assert (r / game / config).is_symlink() and fingerprint(r / 'owned') == saved
                    record('after:existing-in-volume-target-symlink-preserved')
                    # Reject source symlinks and escaping target paths before copying.
                    for conflict in ['source-symlink', 'escaping-target', 'parent-file']:
                        r = root(); put(r / config)
                        names = [config]
                        if conflict == 'source-symlink':
                            (r / config).unlink(); put(r / 'owned'); (r / config).symlink_to(r / 'owned')
                        elif conflict == 'escaping-target':
                            (r / game / config).symlink_to(base / 'outside-volume')
                        else:
                            put(r / directory / 'child', b'data'); put(r / game / directory, b'blocking-file'); names = [directory]
                        try:
                            gta.migrate(r, game, names)
                        except (ValueError, FileExistsError, NotADirectoryError):
                            pass
                        else:
                            raise AssertionError('conflict accepted: ' + conflict)
                        assert not (r / '.voltra' / game / 'legacy-layout-imported.json').exists()
                        assert (r / config).exists()
                        record('after:reject-' + conflict)
                    # Explicitly characterize the limit of exists(), do not expand this patch.
                    r = root(); put(r / config)
                    (r / game / config).symlink_to(r / 'missing-referent')
                    gta.migrate(r, game, [config])
                    assert (r / 'missing-referent').read_bytes() == b'stale-root'
                    record('after:known-limit-dangling-in-volume-symlink-follows-copy2')
                    # Missing or invalid archive authorization must fail before publisher call.
                    for bad in [{}, {**env, 'DEDICATED_ARCHIVE_URL': 'http://unauthorized.invalid/archive'}, {**env, 'DEDICATED_ARCHIVE_SHA256': ''}]:
                        r = root()
                        with patch.object(legacy, 'module', lambda name: types.SimpleNamespace(install_release=denied)):
                            try:
                                legacy.install(game, r, bad)
                            except ValueError:
                                pass
                            else:
                                raise AssertionError('missing consent accepted')
                        assert not (r / '.voltra' / game / 'legacy-layout-imported.json').exists()
                        record('after:authorization-refused-' + str(len(bad)) + '-' + bad.get('DEDICATED_ARCHIVE_URL', 'missing'))
        finally:
            ACTIVE = None
    assert not base.exists()
    return outcomes
