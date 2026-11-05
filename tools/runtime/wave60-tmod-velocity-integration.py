"""Source-only surgical integration. Explicit fresh output; no runtime operations."""
import copy, difflib, hashlib, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CANON = ROOT/'internal/panel/game_library/overrides.json'
T = 'terraria/tmodloader/egg-t-modloader.json'
V = 'minecraft/proxy/java/velocity/egg-velocity.json'
def sha(data): return hashlib.sha256(data).hexdigest()
def stage(current):
    result = {key: copy.deepcopy(current[key]) for key in (T,V)}
    for key, helpers in [(T,[('tmodloader-runtime.py','tmodloader_runtime.py','VOLTRA_TMODLOADER_RUNTIME'),('terraria-release-install.py','terraria_release_install.py','VOLTRA_TERRARIA_RELEASE')]),(V,[('proxy-family-install.py','proxy_family_install.py','VOLTRA_PROXY_SOURCE')])]:
        script=result[key]['egg']['scripts']['installation']['script']
        for source, emitted, marker in helpers:
            start="cat > .voltra/"+emitted+" <<'"+marker+"'\n"
            assert script.count(start)==1
            a=script.index(start)+len(start); b=script.index('\n'+marker,a)
            script=script[:a]+(ROOT/'internal/panel/game_library/scripts'/source).read_text().rstrip()+script[b:]
        if key==T:
            script=script.replace('\nfrom terraria_release_install import install\n','\nfrom tmodloader_runtime import install\n')
            assert '\nfrom tmodloader_runtime import install\n' in script
            result[key]['egg']['config']['files']=json.dumps({'serverconfig.txt':{'parser':'properties','find':{'port':'{{server.build.default.port}}'}}},separators=(',',':'))
        result[key]['egg']['scripts']['installation']['script']=script
    return result

def main():
    out=Path(sys.argv[1]); out.mkdir(parents=True,exist_ok=False)
    raw=CANON.read_bytes(); current=json.loads(raw); pending=stage(current)
    assert pending==stage(current), 'nondeterministic stage'
    (out/'canonical.before.json').write_bytes(raw)
    (out/'profiles.pending.json').write_text(json.dumps(pending,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    text=raw.decode(); spans=[]
    for key in (T,V):
        match=re.search(r'^  '+re.escape(json.dumps(key))+r': ',text,re.M); assert match
        a=match.end(); old,end=json.JSONDecoder().raw_decode(text[a:]); assert old==current[key]
        value=json.dumps(pending[key],indent=2,ensure_ascii=False).replace('\n','\n  ')
        spans.append((a,a+end,value))
    for a,b,value in sorted(spans,reverse=True):text=text[:a]+value+text[b:]
    after=json.loads(text)
    assert {k:v for k,v in current.items() if k not in pending}=={k:v for k,v in after.items() if k not in pending}
    for key in (T,V):
        a=copy.deepcopy(current[key]);b=copy.deepcopy(after[key])
        del a['egg']['scripts']['installation']['script'];del b['egg']['scripts']['installation']['script']
        if key==T:del a['egg']['config']['files'];del b['egg']['config']['files']
        assert a==b
    assert CANON.read_bytes()==raw, 'concurrent canonical modification'
    CANON.write_bytes(text.encode())
    (out/'canonical.diff').write_text(''.join(difflib.unified_diff(raw.decode().splitlines(True),text.splitlines(True),fromfile='before',tofile='after')),encoding='utf-8')
    for key,folder in [(T,'tmodloader'),(V,'velocity')]:
        dest=out/folder;dest.mkdir()
        script=after[key]['egg']['scripts']['installation']['script']
        for name,marker,body in re.findall(r"cat > \.voltra/([^ ]+) <<'(\w+)'\n(.*?)\n\2",script,re.S):
            (dest/name).write_text(body+'\n',encoding='utf-8')
    facts={key:{'metadata':{k:v for k,v in current[key].items() if k!='egg'},'controls':{k:v for k,v in current[key]['egg'].items() if k!='scripts'}} for key in (T,V)}
    (out/'original-controls.json').write_text(json.dumps(facts,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    (out/'integration.json').write_text(json.dumps({'before_sha256':sha(raw),'after_sha256':sha(text.encode()),'unrelated_profiles':len(current)-2,'unrelated_profiles_equal':True,'unrelated_raw_bytes_preserved':True,'repeatable':True},indent=2)+'\n')
if __name__=='__main__':main()
