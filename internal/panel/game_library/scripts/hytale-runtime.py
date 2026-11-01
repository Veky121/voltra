"""Hytale-only admission before publisher acquisition. No credential acquisition."""
import os
from pathlib import Path
import publisher_runtime as publisher
import uuid
import json
import stat
import shutil
import tempfile
from contextlib import contextmanager


# These paths are relative to the publisher's process working directory.
STATE = ('config.json', 'permissions.json', 'bans.json', 'whitelist.json',
         'auth.enc', 'auth.key', 'universe', 'mods', 'logs', 'backups', '.cache')


def migrate_state(root):
    moves = []
    for name in STATE:
        old = publisher.confined(root, name)
        new = publisher.confined(root, 'Server/' + name)
        if old.exists():
            if new.exists():
                raise ValueError('Ambiguous Hytale state: reconcile root and Server/' + name + ' privately before launch')
            moves.append((old, new))
    # Check every conflict before moving any state; never merge worlds/configs.
    for old, new in moves:
        old.rename(new)


def configure(root, env):
    # Shared launcher validates Java/payload and produces allocation-owned flags.
    # Query lives beside the active config, not beside Assets.zip.
    server = publisher.confined(root, 'Server')
    migrate_state(root)
    base = dict(env, INSTALL_SOURCEQUERY_PLUGIN='0')
    argv, child, secrets, ready, stop, signal_option = publisher.configure(root, base)
    data = publisher.read_json(server, 'config.json')
    update = data.setdefault('Update', {})
    if not isinstance(update, dict):
        raise ValueError('Hytale Update configuration must be an object')
    update['Patchline'] = env.get('HYTALE_PATCHLINE', 'release')
    publisher.write_config(server, 'config.json', data)
    enabled = publisher.boolean(env, 'INSTALL_SOURCEQUERY_PLUGIN', '1')
    publisher.install_query(server, publisher.preflight(env)[1], enabled=enabled)
    if enabled:
        child['QUERY_PORT'] = env.get('QUERY_PORT') or str(int(env.get('SERVER_PORT', '5520')) + 1)
    for key in ('HYTALE_SERVER_SESSION_TOKEN', 'HYTALE_SERVER_IDENTITY_TOKEN'):
        if env.get(key):
            child[key] = env[key]
    return argv, child, secrets, ready, stop, signal_option


@contextmanager
def rollback_publication(root, names):
    """Disk-backed, bounded undo for handled errors, not process-crash atomicity."""
    names = list(dict.fromkeys(names))
    if len(names) > 100000:
        raise ValueError('Hytale rollback file count exceeds limit')
    state = publisher.confined(root, '.voltra/publisher')
    state.mkdir(parents=True, exist_ok=True)
    # Preflight all targets and retain originals before the first mutation.
    with tempfile.TemporaryDirectory(prefix='hytale-undo-', dir=state) as folder:
        saved = []
        parents = set()
        total = 0
        for index, name in enumerate(names):
            target = publisher.confined(root, name)
            parent = target.parent
            while parent != root and not parent.exists():
                parents.add(parent)
                parent = parent.parent
            if target.exists():
                if not target.is_file() or target.is_symlink():
                    raise ValueError('Hytale publication target must be a regular file')
                metadata = target.stat()
                total += metadata.st_size
                if total > 10 * 1024**3:
                    raise ValueError('Hytale rollback bytes exceed limit')
                backup = Path(folder) / str(index)
                shutil.copyfile(target, backup)
                saved.append((name, backup, metadata))
            else:
                saved.append((name, None, None))
        try:
            yield
        except Exception as failure:
            errors = []
            for name, backup, metadata in reversed(saved):
                try:
                    target = publisher.confined(root, name)
                    if backup is None:
                        target.unlink(missing_ok=True)
                    else:
                        def restore(output, source=backup):
                            with source.open('rb') as incoming:
                                shutil.copyfileobj(incoming, output)
                        publisher._publish(root, name, restore, stat.S_IMODE(metadata.st_mode))
                        if hasattr(os, 'chown'):
                            os.chown(target, metadata.st_uid, metadata.st_gid)
                        os.chmod(target, stat.S_IMODE(metadata.st_mode))
                except Exception as error:
                    errors.append(name + ': ' + str(error))
            for parent in sorted(parents, key=lambda p: len(p.parts), reverse=True):
                try:
                    parent.rmdir()
                except OSError:
                    pass
            if errors:
                retained = state / ('hytale-rollback-failed-' + uuid.uuid4().hex)
                Path(folder).rename(retained)
                (retained / 'targets.json').write_text(json.dumps([{'name': name, 'backup': backup.name if backup else None, 'mode': stat.S_IMODE(metadata.st_mode) if metadata else None, 'uid': metadata.st_uid if metadata else None, 'gid': metadata.st_gid if metadata else None} for name, backup, metadata in saved]))
                raise RuntimeError('Hytale publication failed; rollback incomplete; retained undo at ' + str(retained) + ': ' + '; '.join(errors)) from failure
            raise


def acquire(root, env):
    # Hytale-specific copy of the emitted acquisition branch. Shared publisher
    # helpers and other publishers retain their existing behavior.
    _, mode = publisher.preflight(env)
    if mode == 'operator':
        return
    cli = publisher.confined(root, 'hytale-downloader/hytale-downloader-linux')
    if not cli.is_file():
        raise ValueError('Install the original Hytale downloader first or supply lawful launcher files')
    state = publisher.confined(root, '.voltra/publisher')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='hytale-game-', dir=state) as temporary:
        stage = Path(temporary)
        archive = stage / 'game.zip'
        argv = [str(cli), '-patchline', env.get('HYTALE_PATCHLINE', 'release'), '-download-path', str(archive)]
        status = publisher.run(root, argv, publisher.child_environment(root, env), '\x03', terminal_input=True, stop_signal=publisher.signal.SIGINT)
        if status or not archive.is_file():
            raise RuntimeError('Hytale licensed acquisition did not produce the server archive')
        if archive.stat().st_size > 10 * 1024**3:
            raise ValueError('Hytale archive exceeds download size limit')
        ready = stage / 'ready'
        ready.mkdir()
        publisher.extract(archive, ready)
        publisher.payload_namespace(ready)
        if not (ready/'Server/HytaleServer.jar').is_file() or not (ready/'Assets.zip').is_file():
            raise ValueError('Original Hytale publisher archive lacks Server and Assets.zip')
        receipt_name = '.voltra/publisher/hytale-files.json'
        receipt = publisher.confined(root, receipt_name)
        previous = json.loads(receipt.read_text()) if receipt.exists() else {}
        names = [p.relative_to(ready).as_posix() for p in ready.rglob('*') if p.is_file()]
        with rollback_publication(root, names + [receipt_name]):
            with publisher.retain_operators(root, list(STATE) + ['Server/' + name for name in STATE]):
                files, preserved = publisher.apply_payload(root, '', ready, previous)
            publisher._publish(root, receipt_name, lambda output: output.write(json.dumps({'files': files, 'preserved_operator_files': preserved, 'patchline': env.get('HYTALE_PATCHLINE', 'release')}).encode()), 0o600)


def apply_update(root):
    stage = publisher.confined(root, 'updater/staging')
    jar = publisher.confined(stage, 'Server/HytaleServer.jar')
    if not jar.is_file():
        return False
    names = ['Server/HytaleServer.jar', 'Server/HytaleServer.aot', 'Assets.zip', 'start.sh', 'start.bat']
    licenses = publisher.confined(stage, 'Server/Licenses')
    if licenses.exists():
        names += [p.relative_to(stage).as_posix() for p in licenses.rglob('*') if p.is_file()]
    files = []
    for name in names:
        source = publisher.confined(stage, name)
        target = publisher.confined(root, name)
        if source.is_file():
            files.append((name, source, target))
    # Validate the complete selective payload before publication. Config, auth,
    # worlds, mods and arbitrary staged paths are never update destinations.
    backup = '.voltra/publisher/update-backups/' + uuid.uuid4().hex + '/'
    with rollback_publication(root, [name for name, _, _ in files]):
        for name, source, target in files:
            if target.is_file():
                publisher._publish(root, backup + name, lambda out, p=target: out.write(p.read_bytes()), 0o600)
            publisher._publish(root, name, lambda out, p=source: out.write(p.read_bytes()), 0o700 if name == 'start.sh' else 0o600)
        # Retain the full stage for diagnosis, but do not apply it a second time.
        stage.rename(stage.with_name('applied-' + uuid.uuid4().hex))
    return True


def preflight(env):
    kind, mode = publisher.preflight(env)
    if kind != 'hytale':
        raise ValueError('This adapter requires the exact Hytale publisher profile')
    main = publisher.integer(env, 'SERVER_PORT', 5520, 1025, 65535)
    try:
        allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    except ValueError:
        raise ValueError('Invalid Hytale allocation list') from None
    if main not in allocated:
        raise ValueError('Game port must be allocated')
    publisher.integer(env, 'SERVER_MEMORY', 0, 0, 2147483647)
    if publisher.boolean(env, 'INSTALL_SOURCEQUERY_PLUGIN', '1'):
        query = publisher.integer(env, 'QUERY_PORT', main + 1, 1025, 65535) if env.get('QUERY_PORT', '') else main + 1
        if query == main or query not in allocated or query > 65535:
            raise ValueError('SourceQuery requires its own additional allocated UDP port')
    return kind, mode


def main(root, env):
    # Shared main acquires before configure. Refuse invalid allocation/memory
    # before invoking the licensed downloader or changing publisher state.
    preflight(env)
    root = Path(root).resolve()
    # Native self-update already acquired a payload; do not overwrite it with
    # a second downloader invocation when Wings restarts the wrapper.
    if not apply_update(root):
        retained = list(STATE) + ['Server/' + name for name in STATE]
        with publisher.retain_operators(root, retained):
            acquire(root, env)
    while True:
        argv, child, secrets, ready, stop, signal_option = configure(root, env)
        options = dict(credentials=secrets, ready_marker=ready, terminal_input=True)
        if signal_option is not None:
            options['stop_signal'] = signal_option
        status = publisher.run(root / 'Server', argv, child, stop, **options)
        if status != 8:
            return status
        if not apply_update(root):
            raise ValueError('Hytale exited 8 without a staged publisher payload; refusing restart loop')


if __name__ == '__main__':
    raise SystemExit(main(Path.cwd(), dict(os.environ)))
