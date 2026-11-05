"""Source-only emitted-module proof and minimal two-profile candidate. Run in WSL."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
from unittest.mock import patch
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/wave69-cfx-writer-proof'
KEYS = ['gta/fivem/egg-five-m.json', 'rdr/redm/egg-red-m.json']
CAT = ROOT / 'internal/panel/game_library/overrides.json'
digest = lambda b: hashlib.sha256(b).hexdigest()
pattern = re.compile(r"cat\s+>\s*(?:\"([^\"\r\n]+\.py)\"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)")

def extract(profile):
    return {Path(m[1] or m[2] or m[3]).name: m[5]+'\n' for m in pattern.finditer(profile['egg']['scripts']['installation']['script'])}

def load(folder, name):
    spec = importlib.util.spec_from_file_location(name, folder/(name+'.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def denied(*a, **k):
    raise AssertionError('Network/process boundary reached')

def main():
    sys.dont_write_bytecode = True
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CAT.read_bytes())
    review = json.loads((ROOT/'artifacts/game-parity-20261029/helper-copy-review-wave68/review-3/report.json').read_bytes())
    frozen = {r['path']: r['sha256'] for r in json.loads((ROOT/'artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json').read_bytes())}
    paths = list(review['input_hashes'])
    before = {p: digest((ROOT/p).read_bytes()) for p in paths}
    assert all(before[p] == frozen[p] for p in paths), 'Comparison input drift from green checkpoint'
    results, evidence, proposals = [], {}, {}
    def check(name, fn):
        try:
            detail = fn()
            results.append(dict(name=name, outcome='pass', detail=detail))
        except Exception as exc:
            results.append(dict(name=name, outcome='fail', detail=repr(exc)))
    for key in KEYS:
        original = catalog[key]
        modules = extract(original)
        old = modules['gta-runtime.py']
        start, end = old.index('def write_config('), old.index('\ndef allocated(')
        body = old[start:end]
        assert body.count('path.read_text()') == 2
        newbody = body.replace('path.read_text()', "path.read_bytes().decode('utf-8')")
        updated = old[:start]+newbody+old[end:]
        proposal = copy.deepcopy(original)
        script = proposal['egg']['scripts']['installation']['script']
        # Replace only the captured helper body, retaining its original final newlines.
        match = next(m for m in pattern.finditer(script) if (m[1] or m[2] or m[3]).endswith('/gta-runtime.py'))
        proposal['egg']['scripts']['installation']['script'] = script[:match.start(5)]+updated[:-1]+script[match.end(5):]
        candidate_modules = extract(proposal)
        assert {n:s for n,s in modules.items() if n != 'gta-runtime.py'} == {n:s for n,s in candidate_modules.items() if n != 'gta-runtime.py'}
        a,b = copy.deepcopy(original),copy.deepcopy(proposal)
        del a['egg']['scripts']['installation']['script']; del b['egg']['scripts']['installation']['script']
        assert a == b
        proposals[key] = proposal
        evidence[key] = dict(revision=original['revision'], startup=original['egg']['startup'], original_status=original.get('verification'), profile_before=digest(json.dumps(original,sort_keys=True).encode()), profile_after=digest(json.dumps(proposal,sort_keys=True).encode()), script_before=digest(script.encode()), script_after=digest(proposal['egg']['scripts']['installation']['script'].encode()), modules_before={n:digest(s.encode()) for n,s in modules.items()}, modules_after={n:digest(s.encode()) for n,s in candidate_modules.items()}, final_newline_preserved=old.endswith('\n') and updated.endswith('\n'))
        for variant, sources in [('original',modules),('candidate',candidate_modules)]:
            def exercise(raw, refusal=False, symlink=False, environment=None):
                with tempfile.TemporaryDirectory(prefix='wave69-cfx-') as tmp:
                    root=Path(tmp); folder=root/'.voltra'; folder.mkdir()
                    for name,source in sources.items():
                        compile(source,name,'exec'); (folder/name).write_bytes(source.encode())
                    cfg=root/'server.cfg'
                    if symlink:
                        target=root/'owned.cfg'; target.write_bytes(raw); cfg.symlink_to(target)
                    else: cfg.write_bytes(raw)
                    env={'SERVER_PORT':'30120','VOLTRA_ALLOCATED_PORTS':'30120','FIVEM_LICENSE':'fixture-only-not-a-key','CFX_LICENSE':'fixture-only-not-a-key','SERVER_HOSTNAME':'managed-edit'}
                    env.update(environment or {})
                    fivem=load(folder,'fivem-runtime')
                    if key.startswith('rdr/'):
                        redm=load(folder,'redm-owner-next')
                        # Preserve actual prepare and writer calls; stop at the native launcher boundary.
                        real_module=redm.module
                        def controlled_module(name):
                            mod=real_module(name)
                            if name=='fivem-runtime': mod.run=lambda *args: 0
                            return mod
                        redm.module=controlled_module
                        action=lambda:redm.run(root,env)
                    else: action=lambda:fivem.configure(root,env)
                    if refusal:
                        try: action()
                        except (ValueError,UnicodeDecodeError): pass
                        else: raise AssertionError('expected refusal')
                        assert cfg.read_bytes()==raw
                        assert not (folder/'gta-backups').exists()
                        return 'refused before write/backup'
                    action()
                    backups=list((folder/'gta-backups').glob('*'))
                    assert backups
                    actual=backups[0].read_bytes()
                    if variant=='original' and b'\r\n' in raw:
                        assert actual == raw.replace(b'\r\n',b'\n') and actual != raw
                    else: assert actual==raw
                    assert b'set opaque alpha\r\nset opaque beta\r\n' in cfg.read_bytes() if b'\r\n' in raw else True
                    if symlink:
                        assert not cfg.is_symlink() and target.read_bytes()==raw
                    return dict(input_sha256=digest(raw),backup_sha256=digest(actual),written_sha256=digest(cfg.read_bytes()),backup_exact=actual==raw)
            raw=b'# retained\r\nsv_hostname "Native" # keep\r\nset opaque alpha\r\nset opaque beta\r\n'
            for label,data in [('crlf',raw),('bom-comment',b'\xef\xbb\xbf'+raw),('lf',raw.replace(b'\r\n',b'\n'))]:
                check(key+'/'+variant+'/'+label,lambda data=data:exercise(data))
            for label,data in [('exec',b'exec private.cfg\n'),('duplicate',b'sv_hostname a\nsv_hostname b\n'),('opaque-invalid-utf8',b'#\xff\n')]:
                check(key+'/'+variant+'/'+label,lambda data=data:exercise(data,True))
            check(key+'/'+variant+'/in-volume-symlink',lambda:exercise(raw,refusal=key.startswith('rdr/'),symlink=True))
            check(key+'/'+variant+'/missing-license',lambda:exercise(raw,True,environment={'FIVEM_LICENSE':'','CFX_LICENSE':''}))
            check(key+'/'+variant+'/unallocated-port',lambda:exercise(raw,True,environment={'SERVER_PORT':'30121'}))
            check(key+'/'+variant+'/txdata-escape',lambda:exercise(raw,True,environment={'TXHOST_DATA_PATH':'../outside'}))
    after={p:digest((ROOT/p).read_bytes()) for p in paths}
    assert before==after
    (OUT/'proposals.json').write_text(json.dumps(proposals,indent=2)+'\n')
    report=dict(outcome='source_counterexample_minimal_candidate' if not any(r['outcome']=='fail' for r in results) else 'fixture_failure', input_hashes={p:dict(before=before[p],after=after[p],green=frozen[p]) for p in paths}, evidence=evidence, tests=results, counts={s:sum(r['outcome']==s for r in results) for s in ['pass','fail','skip']}, trigger='Supported CRLF server.cfg with managed edits reaches old write_config. read_text universal newline conversion corrupts backup while rendered live config retains CRLF. RedM prepare scratch and subsequent real-volume writer both reach it.', patch='Only two read_text calls within older write_config become read_bytes().decode(utf-8). No stricter current helper or sibling functions adopted.', compensating_coverage='fivem-cfg render preserves opaque lines and CRLF; parser refuses exec and duplicate managed keys. RedM rejects symlink server.cfg before prepare; FiveM accepts in-volume file symlink and private_write atomically replaces link without changing original target. This behavior is recorded, not declared a defect.', status='Canonical source and historical records untouched; original37statuses unknown as an aggregate, no native acceptance promotion.', adoption='Candidate only. Root must verify exact canonical/helper hashes, adopt only these two helper bodies into these exact two recipes, retain all metadata and other emitted bodies; rerun source integration. Do not run old full-profile stagers or overwrite concurrent metadata.', boundaries='WSL Python compile/import and pure configuration calls only. Synthetic credential string passes existing validation, never authenticates. socket, urllib, subprocess and os process APIs denied. RedM launcher stubbed at fivem-runtime.run after real prepare/writer. No install/acquisition/native execution.', cleanup='All imported emitted modules, scratch configs and backups in TemporaryDirectory contexts, removed before report. No real /home/container writes, bytecode, persistent processes or services.', remaining_native_gaps=['Cfx real credential/licensing acceptance','FXServer native ABI/startup','txAdmin account deployment','protocol/gameplay','native stop and console token masking not executed'], skips=['Native acceptance intentionally excluded','Installer acquisition intentionally excluded; source traces only'])
    report['caller_trace'] = {
        'FiveM': 'Canonical startup invokes emitted fivem-runtime.py. configure reads server.cfg bytes as UTF-8, renders via emitted fivem-cfg.render, then directly invokes embedded gta-runtime.write_config. run invokes configure before native-console.run. The proof calls configure only.',
        'RedM': 'Canonical startup invokes emitted redm-owner-next.py. run calls prepare, which rejects symlink/nonregular server.cfg, parses native values into effective env and invokes fivem-runtime.configure in disposable scratch. run then invokes gta-runtime.write_config on original volume before invoking fivem-runtime.run. The proof executes real prepare and real-volume write, stubbing only that subsequent run boundary.',
        'install': 'RedM install calls prepare before fivem-install.install. FiveM install parses existing bytes with fivem-cfg before acquisition. No installer executed here; neither installer is necessary to reach this startup counterexample.',
        'previous_scoped_wrappers': 'Read tools/runtime/stage-fivem-profile.mjs and test-redm-owner-next.py. Earlier RedM prepare-only preservation fixture checks unchanged operator config, not the later run backup. Current proof inputs are canonical emitted modules, not those historical staged profiles.'}
    report['source_locations'] = {key: {name: {str(i): line for i,line in enumerate(source.splitlines(),1) if any(token in line for token in ['def write_config(', 'path.read_text()', 'def configure(', 'def prepare(', 'def run(', 'def install(', 'common.write_config(', "module('gta-runtime').write_config", "module('fivem-runtime').configure", "module('fivem-runtime').run", "module('fivem-install').install"])} for name,source in extract(catalog[key]).items() if name in ['gta-runtime.py','fivem-runtime.py','redm-owner-next.py','fivem-install.py']} for key in KEYS}
    report['proposal_file_sha256'] = digest((OUT/'proposals.json').read_bytes())
    report['reproduction'] = 'python3 tools/runtime/wave69-cfx-writer-proof-run.py under WSL; no third-party dependencies. Original cases assert the demonstrated corruption; candidate cases assert exact bytes. Test success does not mean original behavior is correct.'
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report['counts']))
    return int(any(r['outcome']=='fail' for r in results))

if __name__=='__main__':
    with patch.object(socket,'socket',denied), patch.object(urllib.request,'urlopen',denied), patch.object(subprocess,'Popen',denied), patch.object(os,'system',denied), patch.object(os,'execve',denied), patch.object(os,'execv',denied):
        sys.exit(main())
