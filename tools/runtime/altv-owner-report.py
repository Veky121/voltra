"""Generate source-only alt:V completion receipt without modifying the shared ledger."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

out = Path('artifacts/game-parity-20261029/altv-owner')
recipe = 'gta/altv/egg-alt--v.json'
fragment = json.loads((out / 'profiles.fragment.json').read_text())
script = fragment[recipe]['egg']['scripts']['installation']['script']
bash = Path('C:/Program Files/Git/bin/bash.exe')
refusal = {'status': 'pending', 'reason': 'Bash unavailable'}
if bash.exists():
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.run([str(bash), '-c', script], cwd=tmp, capture_output=True, text=True)
        assert proc.returncode == 78 and not list(Path(tmp).iterdir())
        refusal = {'status': 'pass', 'exit': proc.returncode, 'stderr': proc.stderr.strip(),
                   'scope': 'Git Bash refusal only, no Docker/native game execution', 'filesystem_entries_after': 0}
result = subprocess.run(['python', '-B', 'tools/runtime/test-altv-legacy.py', '-v'], capture_output=True, text=True)
(out / 'tests.txt').write_text(result.stdout + result.stderr)
assert result.returncode == 0
checklist = Path('artifacts/game-parity-20261029/GAME-AGENT-CHECKLIST.md').read_text()
checks = {key: {'status': 'blocked', 'evidence': 'No supported publisher distribution; no candidate activation authorized. Native/API/browser behavior unverified.'}
          for key in re.findall(r'^- \*\*([A-Z]+-\d+)', checklist, re.M)}
for key in ['FACT-1', 'FACT-2', 'FACT-3', 'FACT-4', 'FACT-5', 'FACT-6']:
    checks[key] = {'status': 'pass', 'evidence': 'Historical official documentation and current indexed shutdown notice, see manifest; no native claim.'}
checks['FACT-6']['evidence'] += ' Native readiness, quit handling and exit codes remain unknown.'
checks['SETUP-1'] = {'status': 'pass', 'evidence': 'tests.txt exact original ordered variables/defaults/permissions/startup/images/config equality'}
checks['DELIVERY-3'] = {'status': 'pass', 'evidence': 'tests.txt, four focused regression tests'}
checks['DELIVERY-4'] = {'status': 'pass', 'evidence': 'Only temporary Python/Git Bash fixtures, automatically removed. No server/container/lease/schedule/user/download created; no operations running.'}
for key in ['LIFE-2', 'CONSOLE-2']:
    checks[key] = {'status': 'pending', 'evidence': 'Resource persistence and logging depend on operator code/config. No native artifact available to establish applicability.'}
baseline = Path('artifacts/game-parity-20261029/SHARED-PLATFORM-BASELINE.json')
baseline_data = json.loads(baseline.read_text())
deps = []
for entry in baseline_data.get('source_inputs', []):
    path = Path(entry['path'])
    digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    deps.append({'path': str(path), 'sha256': digest, 'matches_receipt_current': digest == entry.get('current_sha256'),
                 'receipt_native_unchanged': entry.get('unchanged')})
manifest = {
 'identity': 'altMP alt:V, shutdown; no current supported distribution/update path. Linux server historically native, Windows server historically supported; no current build/hash validated.',
 'resources': 'Historical publisher guidance for >100 players: 4 cores, 3.2 GHz, 4 GB RAM; disk depends on scripts/database. Not a current support guarantee. Original catalog defaults retained, no fixture sizing asserted.',
 'ports': 'Historical default 7788 TCP+UDP without CDN; CDN reduces game transport to UDP. Optional voice/profiler/CDN endpoints depend on operator configuration; none allocated/exposed.',
 'files': 'server.toml documented default; --config overrides. srv.toml only an explicitly selectable candidate, never auto-converted. resources/<name>/resource.toml and JS/CSharp code, modules, data and databases remain operator-owned. No GTA assets supplied.',
 'logging': 'logStreams controls console/file; logsToKeep defaults 0. CLI --logfile takes precedence over --logfolder. No native log/readiness evidence.',
 'controls': 'Original LD_LIBRARY_PATH hidden noneditable default dot; BUILD release/rc/dev default release; PASSWORD default ChangeMe; SERVER_DESC default A Pterodactyl Hosted Server. Exact rules/order/perms retained in fragment. Inspector offers no writable controls.',
 'prerequisites': 'Historical JS module setup requires libatomic1 on Linux; CSharp requires matching .NET runtime. Exact archive ABI unknown. Players require legally owned compatible GTA V. No credentials/licence/EULA supplied or accepted. No unsupported mirror acquisition.',
 'stop_save_readiness': 'Official command page documents start/stop/restart RESOURCE, not global quit or durable game save. Prior helper quit forwarding is unaccepted. Native readiness/global shutdown/exit/save semantics unknown; resource implementations control persistence.'}
sources = ['https://altv.mp/', 'https://docs.altv.mp/articles/serverspecs.html',
 'https://docs.altv.mp/articles/configs/server.html', 'https://docs.altv.mp/articles/commandlineargs.html',
 'https://docs.altv.mp/js/articles/setup.html', 'https://docs.altv.mp/articles/troubleshooting/server.html']
paths = [Path('tools/runtime') / name for name in ['altv-legacy-inspect.py', 'stage-altv-legacy.mjs', 'test-altv-legacy.py', 'altv-owner-report.py']]
paths += [out / 'profiles.fragment.json', out / 'altv-legacy-inspect.py', out / 'tests.txt', baseline]
report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'recipe': recipe, 'outcome': 'blocked',
 'historical': 'Exact CURRENT-PROGRESS row not_verified, no historical/native receipts. Existing legacy helper fixes preserved, no baseline install repeated.',
 'manifest': manifest, 'official_sources': sources, 'source_caveat': '2026-10-30 retrieval: official homepage search index says shutdown; direct open redirect loop. Historical docs are available, not proof of live service. Exact shutdown deadlines not asserted.',
 'checks': checks, 'refusal_execution': refusal, 'tests': {'status': 'pass', 'count': 4, 'evidence': 'tests.txt'},
 'hashes': {str(p).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
 'shared_baseline': {'status': 'reused', 'scope': 'Reference evidence only; 6/7 unchanged dependency baseline and FS25 operations power delta do not prove altV mounted-files/schedule/native checks.', 'dependency_comparison': deps},
 'served_boundary': 'Staged fragment only. PID45220 is old runtime, not candidate. No panel activation/restart/retry/alternate launcher/approval change.',
 'blocker_packet': {'problem': 'Shutdown distribution plus prohibited candidate activation prevents native acceptance.',
   'proposed_fix': 'Integration owner reviews and merges only exact altV refusal fragment into canonical profile, with legacy/retired catalog messaging. Preserve existing installations and operator data; no new install or support claim. No native run proposed.'},
 'resources': 'No Docker/SSH/home-server/image/installer/admission/lease used. No installs or downloads. Temporary local fixtures cleaned, no background operation. Retained source and reports only. No commits/publication; canonical/Go/FS25/shared files untouched.'}
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'outcome': report['outcome'], 'refusal': refusal, 'report_sha256': hashlib.sha256((out / 'report.json').read_bytes()).hexdigest()}))
