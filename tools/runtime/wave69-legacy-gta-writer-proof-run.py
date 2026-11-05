"""Source-only emitted legacy GTA writer proof. Run with WSL python3 -B."""
import hashlib, json, re, socket, subprocess, sys, tempfile, types
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'artifacts/game-parity-20261029/wave69-legacy-gta-writer-proof'
sha = lambda b: hashlib.sha256(b).hexdigest()
catalog_path = 'internal/panel/game_library/overrides.json'
snapshot = {x['path']: x['sha256'] for x in json.loads((ROOT/'artifacts/game-parity-20261029/root-source-regression-wave68/source-before.json').read_text())}
paths = [catalog_path, 'tools/runtime/embedded-python.mjs', 'internal/panel/game_library/scripts/gta-runtime.py', 'internal/panel/game_library/scripts/gta-legacy-runtime.py', 'internal/panel/game_library/scripts/native-config.py']
before = {p: sha((ROOT/p).read_bytes()) for p in paths}
assert all(before[p] == snapshot[p] for p in paths), 'comparison input drift'
profiles = json.loads((ROOT/catalog_path).read_bytes())
review=json.loads((ROOT/'artifacts/game-parity-20261029/helper-copy-review-wave68/review-3/report.json').read_bytes())
recipes = ['gta/altv/egg-alt--v.json', 'gta/ragemp/egg-rage--m-p.json']
pattern = re.compile(r"cat\s+>\s*(?:\"([^\"\r\n]+\.py)\"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)")
results, fragments, fingerprints = [], {}, {}
def blocked(*a, **k): raise AssertionError('forbidden network/process boundary')
def load(source, name):
    m = types.ModuleType(name); m.__file__ = name+'.py'
    exec(compile(source, m.__file__, 'exec'), m.__dict__)
    return m
for recipe in recipes:
    profile = profiles[recipe]; script = profile['egg']['scripts']['installation']['script']
    matches = list(pattern.finditer(script))
    bodies = {(m[1] or m[2] or m[3]).split('/')[-1]: m[5]+'\n' for m in matches}
    old = bodies['gta-runtime.py']
    reviewed=next(e for e in review['entries'] if e['recipe']==recipe and e['module']=='gta_runtime')
    assert sha(old.encode())==reviewed['bodySHA256']
    # Only preserve backup/equality bytes. Do not adopt sibling guards or MTA logic.
    begin=old.index('def write_config('); end=old.index('\ndef allocated(',begin)
    writer=old[begin:end]
    assert writer.count('path.read_text()') == 2
    new = old[:begin]+writer.replace('path.read_text()', "path.read_bytes().decode('utf-8')")+old[end:]
    game = 'altv' if '/altv/' in recipe else 'ragemp'
    fingerprints[recipe] = {'profile_sha256':sha(json.dumps(profile,sort_keys=True).encode()), 'startup':profile['egg']['startup'], 'startup_sha256':sha(profile['egg']['startup'].encode()), 'installation_sha256':sha(script.encode()), 'modules':{n:sha(s.encode()) for n,s in bodies.items()}, 'candidate_gta_runtime_sha256':sha(new.encode()), 'final_newlines':{n:len(s)-len(s.rstrip('\n')) for n,s in bodies.items()}}
    for variant, helper in [('before',old),('candidate',new)]:
      for case in ['crlf','lf','no-final-newline','invalid-utf8','directory','inside-symlink','outside-symlink','missing-http-port','invalid-managed-text']:
        with tempfile.TemporaryDirectory(prefix='wave69-legacy-') as tmp:
          root=Path(tmp)/'volume'; root.mkdir(); (root/game).mkdir()
          path=root/game/('server.toml' if game=='altv' else 'conf.json')
          raw = ('# café\r\nmodules = ["custom"]\r\nport = 1\r\n' if game=='altv' else '{\r\n "port": 1, "custom": "café"\r\n}\r\n').encode()
          if case=='lf': raw=raw.replace(b'\r\n',b'\n')
          if case=='no-final-newline': raw=raw.rstrip(b'\r\n')
          if case=='invalid-utf8': raw=b'\xff'
          target=None
          if case=='directory': path.mkdir()
          elif 'symlink' in case:
            target=(root/'operator.conf') if case=='inside-symlink' else Path(tmp)/'outside.conf'
            target.write_bytes(raw); path.symlink_to(target)
          else: path.write_bytes(raw)
          writes=[]
          def publish(p, content):
            p=Path(p); assert p.resolve().is_relative_to(root)
            writes.append((p.relative_to(root).as_posix(),content.encode('utf-8')))
          with patch.object(socket,'socket',blocked), patch.object(socket,'create_connection',blocked), patch.object(subprocess,'Popen',blocked), patch.object(subprocess,'run',blocked):
            common=load(helper,'gta-runtime'); legacy=load(bodies['gta-legacy-runtime.py'],'gta-legacy-runtime')
            common.module=lambda name: types.SimpleNamespace(private_write=publish) if name=='native-config' else blocked()
            legacy.module=lambda name: common if name=='gta-runtime' else blocked()
            env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011'}
            if case=='missing-http-port':env['VOLTRA_ALLOCATED_PORTS']='28010'
            if case=='invalid-managed-text':env.update(PASSWORD='bad\n',SERVER_NAME='bad\n')
            error=None
            try: value=legacy.configure(game,root,env)
            except Exception as e:error=type(e).__name__
          expected_error=case in ['invalid-utf8','directory','outside-symlink','invalid-managed-text'] or (case=='missing-http-port' and game=='ragemp')
          assert bool(error)==expected_error,(game,variant,case,error)
          if error: assert not writes
          else:
            assert len(writes)==2
            assert writes[-1][0]==path.relative_to(root).as_posix()
            parsed=__import__('tomllib').loads(writes[-1][1].decode()) if game=='altv' else json.loads(writes[-1][1])
            assert parsed['port']==28010
            assert parsed.get('modules')==['custom'] if game=='altv' else parsed['custom']=='café'
            exact=writes[0][1]==raw
            assert exact == (variant=='candidate' or case=='lf')
          results.append({'recipe':recipe,'variant':variant,'case':case,'error':error,'passed':True,'backup_exact':None if error else exact,'original_sha256':sha(raw),'backup_sha256':None if error else sha(writes[0][1]),'publisher_calls':len(writes)})
    # Replace exact heredoc body slice only, retaining its delimiter-adjacent LF.
    match=next(m for m in matches if (m[1] or m[2] or m[3]).endswith('/gta-runtime.py'))
    staged_script=script[:match.start(5)]+new[:-1]+script[match.end(5):]
    candidate=json.loads(json.dumps(profile)); candidate['egg']['scripts']['installation']['script']=staged_script
    check=json.loads(json.dumps(candidate)); check['egg']['scripts']['installation']['script']=script
    assert check==profile
    staged_bodies={(m[1] or m[2] or m[3]).split('/')[-1]:m[5]+'\n' for m in pattern.finditer(staged_script)}
    assert all(staged_bodies[n]==s for n,s in bodies.items() if n!='gta-runtime.py')
    fragments[recipe]=candidate
after={p:sha((ROOT/p).read_bytes()) for p in paths}; assert before==after
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'candidate-fragments.json').write_text(json.dumps(fragments,indent=2,ensure_ascii=False)+'\n')
report={'outcome':'backup_byte_loss_demonstrated_minimal_candidate_staged','input_hashes_before':before,'input_hashes_after':after,'green_matches':True,'fingerprints':fingerprints,'tests':results,'counts':{'passed':len(results),'failed':0,'skipped':0},'source_trigger':'Actual legacy configure reads valid UTF-8 CRLF native config and changes managed port. Old common writer reads backup with universal newline translation; mocked publisher receives LF bytes, losing original CRLF. Candidate changes only two read_text calls in shared writer to read_bytes().decode(utf-8).','path_evidence':'Directory and invalid UTF-8 fail before publication; outside symlink rejected by resolved containment; inside-volume symlink accepted in both versions. No new path policy staged. FIFO/device behavior untested to avoid blocking; size and concurrent mutation remain unresolved.','original37statuses':'unknown; no status records written, all candidate profile metadata equals original except installation helper body','cleanup':'TemporaryDirectory fixtures removed; no bytecode, processes, network, downloads, real container writes, or native execution. Publisher mocked; disk publication integration not claimed.','adoption_contract':'Proposal only for these two gta_runtime heredocs. Recheck exact profile/script/helper hashes before adoption, merge with separately owned gta_install change by helper slice, preserve all metadata and other emitted modules. Do not import full stale profile over another proposal.','remaining_native_gaps':['Authorized archive unavailable/unrequested','No ABI, native startup, lifecycle, protocol, gameplay or current publisher claim','No acceptance status promotion'],'candidate_sha256':sha((OUT/'candidate-fragments.json').read_bytes())}
(OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
report['harness_development_failures']=[{'attempt':1,'result':'assertion before fixture execution','reason':'Initial replacement counted read_text across entire helper; corrected to writer function slice only.'},{'attempt':2,'result':'fixture expectation assertion','reason':'No-final-newline case still contains internal CRLF; corrected expected old backup byte loss.'}]
report['verification_boundary']='36 final controlled assertions passed in WSL Ubuntu Python; no application/native builds. Actual emitted caller/editor/helper compiled in memory; network/process blocked and publisher records bytes only.'
(OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'passed':len(results),'failed':0,'output':str(OUT)}))
