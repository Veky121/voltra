#!/usr/bin/env python3
"""Emit an ARM-only installer proposal without editing shared Factorio sources.

The pinned legacy Box64 profile is deliberately retained. This is not a launcher
or a deployable replacement profile. Native image/library/launcher acceptance is
still required. No payload acquisition occurs while staging.
"""
from pathlib import Path
import hashlib
import json

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'artifacts/game-parity-20261029/factorio-arm-routing-followup'
RECIPE = 'factorio/factorio/egg-factorio-a-r-m64.json'


def emit(source):
    def replace(old, new, count=1):
        nonlocal source
        if source.count(old) != count:
            raise ValueError('Shared installer changed; review ARM adaptation: ' + old)
        source = source.replace(old, new)
    replace('if version == PIN:', 'if False:  # Never reuse the x64 pinned digest for ARM.')
    replace('factorio-headless_linux_%s.tar.xz', 'factorio-headless_linux-arm64_%s.tar.xz')
    replace('/headless/linux64', '/headless/linux-arm64')
    replace('with open(destination / "bin/x64/factorio", "rb") as binary:', '''candidates = list((destination / "bin").glob("*/factorio"))
        if len(candidates) != 1 or candidates[0].relative_to(destination).as_posix() not in files:
            raise InstallError("Archive requires exactly one native Factorio executable")
        with open(candidates[0], "rb") as binary:''')
    replace('!= 62:', '!= 183:')
    replace('ELF64 Linux x64', 'ELF64 Linux ARM64')
    replace('headless Linux x64 version', 'headless Linux ARM64 version')
    replace('"payload_architecture": "linux-x64"', '"payload_architecture": "linux-arm64"')
    replace('choices=("x64", "box64"), default="x64"', 'choices=("arm64",), default="arm64"')
    replace('architecture="x64", transport=fetch', 'architecture="arm64", transport=fetch')
    # Architecture preflight is replaced as one reviewed block below.
    old = source[source.index('    machine = ', source.index('def install(')):source.index('    root.mkdir', source.index('def install('))]
    if 'platform.machine' not in old or 'raise InstallError' not in old:
        raise ValueError('Missing shared architecture preflight')
    replace(old, '''    if not VERSION.fullmatch(requested) and requested not in ("latest", "stable", "experimental"):
        raise InstallError("Invalid version; no acquisition or writes attempted")
    if architecture != "arm64" or platform.system() != "Linux" or platform.machine().lower() not in ("aarch64", "arm64"):
        raise InstallError("Native ARM64 installation requires Linux ARM64; Box64/x64 are not native acceptance")
    if requested == PIN:
        raise InstallError("Legacy default 2.0.77 has no approved native ARM64 checksum; keep the existing Box64 profile or explicitly select a publisher-supported native version")
''')
    replace('    root.mkdir(parents=True, exist_ok=True)', '''    # Resolve publisher metadata outside the operator root. Missing native
    # versions/checksums must not create installation state or fetch a game.
    with tempfile.TemporaryDirectory(prefix="factorio-arm-metadata.") as metadata_dir:
        resolved = resolve(requested, Path(metadata_dir), transport)
    root.mkdir(parents=True, exist_ok=True)''')
    replace('version, expected = resolve(requested, work, transport)', 'version, expected = resolved')
    return source


def stage():
    import re
    shared = REPO / 'internal/panel/game_library/scripts/factorio-install.py'
    OUT.mkdir(parents=True, exist_ok=True)
    text = emit(shared.read_text(encoding='utf-8-sig'))
    (OUT / 'factorio-arm-install.py').write_text(text, encoding='utf-8', newline='\n')
    profiles = json.loads((REPO / 'internal/panel/game_library/overrides.json').read_text())
    current = profiles[RECIPE]
    proposed = json.loads(json.dumps(current))
    canonical_script = proposed['egg']['scripts']['installation']['script']
    script = canonical_script
    # Rebuild from canonical every time. Never patch previously emitted output.
    pattern = r"(cat > \"\$stage/factorio-install.py\" <<'FACTORIO_INSTALL_PY'\n).*?(\nFACTORIO_INSTALL_PY\n)"
    script, count = re.subn(pattern, lambda m: m[1]+text.rstrip()+m[2], script, flags=re.S)
    assert count == 1, 'Installer emission anchor drift'
    script = script.replace('--architecture box64', '--architecture arm64')
    seed = (REPO/'internal/panel/game_library/scripts/factorio-settings-seed.py').read_text(encoding='utf-8-sig')
    runtime = (REPO/'tools/runtime/factorio-arm-runtime.py').read_text(encoding='utf-8-sig')
    guard = '[ "${VOLTRA_FACTORIO_NATIVE_ARM64:-}" = 1 ] || { echo "Native ARM64 requires explicit opt-in; retain Box64 otherwise."; exit 2; }\n'
    script = script.replace('set -eu\n', 'set -eu\n'+guard, 1)
    script = script.replace('chmod +x .voltra/jq bin/x64/factorio', 'chmod +x .voltra/jq')
    script = script.replace('for kind in map-gen-settings map-settings server-settings; do', 'for kind in map-gen-settings map-settings; do')
    script, count = re.subn(r'if \[ ! -f .voltra/factorio-initialized \]; then\n.*?\nfi', '', script, count=1, flags=re.S)
    assert count == 1
    helpers = ''
    for name, body in [('factorio-settings-seed.py', seed), ('factorio-arm-runtime.py', runtime)]:
        helpers += "cat > .voltra/"+name+" <<'VOLTRA_ARM_HELPER'\n"+body.rstrip()+"\nVOLTRA_ARM_HELPER\n"
    script = script.replace("cat > .voltra/factorio-start.sh", helpers+'python3 .voltra/factorio-settings-seed.py --root /mnt/server --seed\ncat > .voltra/factorio-start.sh')
    script = script.replace("command -v box64 >/dev/null || { echo 'The selected runtime must provide Box64.'; exit 2; }", guard+'command -v python3 >/dev/null || { echo "Native runtime requires Python3."; exit 2; }')
    start = script.index('if [ "$PUBLIC_SERVER" = 1 ]')
    end = script.index('if [ ! -f "saves/$SAVE_NAME.zip" ]; then', start)
    script = script[:start]+'python3 .voltra/factorio-settings-seed.py --root /home/container\n'+script[end:]
    script = script.replace('box64 ./bin/x64/factorio --', 'python3 .voltra/factorio-arm-runtime.py --')
    # No approved native image/ABI evidence exists. Refuse before apt, curl,
    # root writes or helper publication. The native body is reviewable only.
    native_body = script
    refusal = 'echo "Native ARM64 candidate is nondeployable: approved image, ELF interpreter and library proof required." >&2\nexit 2\n'
    # The else branch is byte-for-byte canonical, including its emitted launcher.
    script = '#!/bin/bash\ncase "${VOLTRA_FACTORIO_NATIVE_ARM64:-}" in\n1)\n' + refusal + native_body + '\n;;\n*)\n' + canonical_script + '\n;;\nesac\n'
    proposed['egg']['scripts']['installation']['script'] = script
    # Existing image metadata is retained only as a review reference, not validated.
    packet = {'recipe': RECIPE, 'status':'deferred_nondeployable_proposal',
              'native_opt_in':'VOLTRA_FACTORIO_NATIVE_ARM64=1 plus explicit supported FACTORIO_VERSION',
              'proposed_profile':proposed, 'canonical_changes':False, 'native_deployable':False,
              'canonical_install_sha256':hashlib.sha256(canonical_script.encode()).hexdigest(),
              'requirements':['Review ARM64 runtime image providing bash, Python3, jq and publisher ELF interpreter/libraries',
                              'Acquire approved archive separately and inspect ABI/interpreter/NEEDED libraries',
                              'Native stop/save/readiness and existing supervisor integration acceptance'],
              'shared_installer_sha256':hashlib.sha256(shared.read_bytes()).hexdigest()}
    (OUT/'profile-proposal.json').write_text(json.dumps(packet,indent=2)+'\n',encoding='utf-8')
    return packet

if __name__ == '__main__':
    stage()
