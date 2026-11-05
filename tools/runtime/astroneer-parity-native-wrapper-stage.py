from pathlib import Path
root=Path('.')
p=root/'internal/panel/game_library/scripts/astroneer-parity.py'
t=p.read_text()
t=t.replace("    previous = engine.read_text(encoding='utf-8-sig') if engine.exists() else ''", "    control = legacy.helper('astroneer-rcon')\n    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]\n    controls = control.plan(updated, allocated, allocated)\n    updated = legacy.native.patch_ini(updated, {SECTION: controls}, case_insensitive=True)\n    previous = engine.read_text(encoding='utf-8-sig') if engine.exists() else ''",1)
t=t.replace("    return passwords\n", "    return passwords + [controls['ConsolePassword']]\n",1)
t=t.replace("    passwords = configure(root, env)\n", "    passwords = configure(root, env)\n",1)
t=t.replace("    try:\n        code = legacy.helper('native-console').run", "    contents = (root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini').read_text(encoding='utf-8-sig')\n    control_helper = legacy.helper('astroneer-rcon')\n    transport = control_helper.Transport(int(control_helper.scalar(contents, 'ConsolePort')), control_helper.scalar(contents, 'ConsolePassword'), legacy.shared.roles(env, [])['primary'])\n    try:\n        code = legacy.helper('native-console').run",1)
t=t.replace("environment, '\\x03', passwords,\n                    terminal_input=True, stop_signal=signal.SIGINT, stop_signal_timeout=60)","environment, 'stop', passwords,\n                    terminal_input=True, stop_signal=signal.SIGINT, stop_signal_timeout=20, control_transport=transport)",1)
# Refuse invalid control/address/port inputs before any auto-update acquisition.
t=t.replace("    if auto == '1': install(root, env)","    settings = legacy.shared.confined(root, root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini')\n    preview = settings.read_text(encoding='utf-8-sig') if settings.exists() else ''\n    preview = seed(preview, SECTION, {'PublicIP': legacy.shared.text(env, 'PUBLIC_IP', '', 64)})\n    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]\n    legacy.helper('astroneer-rcon').plan(preview, allocated, allocated)\n    if auto == '1': install(root, env)",1)
# Initial install must preflight before Steam publication too.
t=t.replace("    legacy.identity('astroneer', env)\n    # Existing installer", "    legacy.identity('astroneer', env)\n    root = Path(root).resolve()\n    settings = legacy.shared.confined(root, root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini')\n    preview = settings.read_text(encoding='utf-8-sig') if settings.exists() else ''\n    preview = seed(preview, SECTION, {'PublicIP': legacy.shared.text(env, 'PUBLIC_IP', '', 64)})\n    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]\n    legacy.helper('astroneer-rcon').plan(preview, allocated, allocated)\n    # Existing installer",1)
t=t.replace("    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]", "    legacy.shared.roles(env, [])\n    allocated = [int(value) for value in env['VOLTRA_ALLOCATED_PORTS'].split(',')]")
t=t.replace('    if updated != content: shared.write_config(root, settings, updated)', '    shared.write_config(root, settings, updated)')
t=t.replace("control_helper.scalar(contents, 'ConsolePassword'), legacy.shared.roles(env, [])['primary'])", "control_helper.scalar(contents, 'ConsolePassword'), legacy.shared.roles(env, [])['primary'], native_binary=binary)")
assert 'control_transport=transport' in t
out=root/'artifacts/game-parity-20261029/astroneer-native-wrapper.py.pending'
out.write_text(t);compile(t,str(out),'exec');print('Staged Astroneer wrapper proposal; canonical unchanged')



