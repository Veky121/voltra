"""Guarded helper-only wave69 integration. No standalone helper refresh."""
import copy, difflib, hashlib, json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT/'artifacts/game-parity-20261029'
OUT = BASE/'wave70-reviewed-consolidation'
CAT = ROOT/'internal/panel/game_library/overrides.json'
EXPECTED = '4d0ad1817780c08bce2d4b26ca4dbf2469fb799137a8db04df2a13b749f2648b'
PAT = re.compile(r'''cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)''')
def sha(b): return hashlib.sha256(b).hexdigest()
def script(p): return p['egg']['scripts']['installation']['script']
def modules(s): return {(m[1] or m[2] or m[3]):m[5]+'\n' for m in PAT.finditer(s)}
def main():
    raw=CAT.read_bytes(); assert sha(raw)==EXPECTED, 'canonical preimage drift'
    original=json.loads(raw); merged=copy.deepcopy(original)
    reports={p.parent.name:json.loads(p.read_bytes()) for p in BASE.glob('wave69-*/report.json')}
    checked=[]
    def verify_paths(obj):
        if isinstance(obj,dict):
            for k,v in obj.items():
                p=ROOT/k
                if '/' in k and p.is_file():
                    vals=[v] if isinstance(v,str) else list(v.values()) if isinstance(v,dict) else []
                    hashes=[x for x in vals if isinstance(x,str) and re.fullmatch('[0-9a-f]{64}',x)]
                    for h in hashes:
                        assert sha(p.read_bytes())==h, ('comparison drift',k)
                        checked.append(k)
                verify_paths(v)
        elif isinstance(obj,list):
            for v in obj: verify_paths(v)
    for r in reports.values(): verify_paths(r)
    protected={str(p.relative_to(ROOT)):sha(p.read_bytes()) for d in BASE.iterdir() if d.is_dir() and d!=OUT for p in d.rglob('*') if p.is_file()}
    changes={}; packets=[]; diffs=[]; proposal_pins={}
    for folder in sorted(reports):
        report=reports[folder]; report_text=json.dumps(report)
        for p in sorted((BASE/folder).glob('*.json')):
            if p.name=='report.json': continue
            candidate=json.loads(p.read_bytes())
            if not candidate or not all(k in original for k in candidate): continue
            digest=sha(p.read_bytes())
            if digest not in report_text:
                assert all(sha(json.dumps(v,sort_keys=True).encode()) in report_text or sha(script(v).encode()) in report_text for v in candidate.values()), ('proposal profile comparison mismatch',p)
            proposal_pins[str(p.relative_to(ROOT))]=digest
            for recipe,profile in candidate.items():
                before=modules(script(original[recipe])); after=modules(script(profile))
                clean=copy.deepcopy(profile);clean['egg']['scripts']['installation']['script']=script(original[recipe])
                assert clean==original[recipe], ('metadata drift',recipe)
                assert before.keys()==after.keys()
                stripped_old=script(original[recipe]);stripped_new=script(profile)
                for name in before:
                    if before[name]==after[name]: continue
                    key=(recipe,name); assert key not in changes or changes[key]==after[name], ('conflicting helper',key)
                    assert sha(before[name].encode()) in report_text and sha(after[name].encode()) in report_text, ('helper report mismatch',key)
                    changes[key]=after[name]
                    stripped_old=stripped_old.replace(before[name],'<SELECTED:'+name+'>',1)
                    stripped_new=stripped_new.replace(after[name],'<SELECTED:'+name+'>',1)
                assert stripped_old==stripped_new, ('outside helper drift',recipe)
    assert len({r for r,n in changes})==21 and len(changes)==24, (len(changes),len({r for r,n in changes}))
    for (recipe,name),body in sorted(changes.items()):
        old=modules(script(original[recipe]))[name]
        s=script(merged[recipe]);assert s.count(old)==1
        merged[recipe]['egg']['scripts']['installation']['script']=s.replace(old,body,1)
        packets.append(dict(recipe=recipe,helper=name,before=sha(old.encode()),after=sha(body.encode()),includes_final_heredoc_newline=True))
        diffs.extend(difflib.unified_diff(old.splitlines(True),body.splitlines(True),fromfile=recipe+':'+name+':before',tofile=recipe+':'+name+':after'))
    bed=modules(script(merged['minecraft/bedrock/bedrock/egg-vanilla-bedrock-ARM64.json']))
    release=next(v for k,v in bed.items() if k.endswith('/native-release.py'))
    assert 'def preserve_identity(' in release and 'os.chown' in release and '.chmod(stat.S_IMODE(identity.st_mode))' in release
    for recipe,profile in merged.items():
        for name,body in modules(script(profile)).items(): compile(body.encode(),name,'exec')
        clean=copy.deepcopy(profile);clean['egg']['scripts']['installation']['script']=script(original[recipe]);assert clean==original[recipe]
    # Replace exact JSON string tokens only. Preserve all surrounding serialization.
    encoded=raw.decode()
    for recipe in sorted({r for r,n in changes}):
        old=json.dumps(script(original[recipe]),ensure_ascii=False);new=json.dumps(script(merged[recipe]),ensure_ascii=False)
        assert encoded.count(old)>=1, ('serialization mismatch',recipe)
        encoded=encoded.replace(old,new,1)
    result=encoded.encode();assert json.loads(result)==merged
    OUT.mkdir(exist_ok=True)
    (OUT/'canonical.before.json').write_bytes(raw)
    (OUT/'canonical.pending.json').write_bytes(result)
    (OUT/'selected-helpers.diff').write_text(''.join(diffs),encoding='utf-8')
    report=dict(canonical_before=EXPECTED,canonical_after=sha(result),recipes=21,helpers=24,other_profiles_unchanged=215,nonscript_metadata_unchanged=236,comparison_paths_checked=len(set(checked)),proposal_pins=proposal_pins,authority_pins=packets,protected_inputs=protected,limitations=['Dangling migration destination symlink remains unresolved','GTAC/RageCOOP caller size/nonregular reads remain unresolved','No crash-atomic publication claim'],statuses='All inherited statuses, frozen checkpoints and latest pointers unchanged; no native acceptance',failed_checks=[])
    (OUT/'integration-packet.json').write_text(json.dumps(report,indent=2)+'\n')
    if '--apply' in sys.argv:
        assert sha(CAT.read_bytes())==EXPECTED
        CAT.write_bytes(result)
    print(json.dumps({k:v for k,v in report.items() if k not in ['protected_inputs','authority_pins','proposal_pins']}))
if __name__=='__main__': main()
