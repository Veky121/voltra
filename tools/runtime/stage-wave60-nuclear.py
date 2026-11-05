import json,pathlib,re,hashlib
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'artifacts/game-parity-20261029/wave60-nuclear';out.mkdir(parents=True,exist_ok=True)
key='nuclear_option/egg-nuclear-option.json'
profile=json.loads((root/'internal/panel/game_library/overrides.json').read_text())[key]
script=profile['egg']['scripts']['installation']['script']
for name in ['light-games-next-runtime.py','light-games-next-install.py']:
 source=(root/'internal/panel/game_library/scripts'/name).read_text()
 emitted=name.replace('-','_')
 pattern=r"(cat > .voltra/"+re.escape(emitted)+r" <<'([^']+)'\n).*?\n\2"
 script,count=re.subn(pattern,lambda m:m[1]+source.rstrip()+'\n'+m[2],script,flags=re.S)
 if count!=1:raise RuntimeError('Expected exact installer heredoc '+emitted)
profile['egg']['scripts']['installation']['script']=script
(out/'recipe-fragment.unapplied.json').write_text(json.dumps({key:profile},indent=2)+'\n')
helpers=out/'emitted';helpers.mkdir(exist_ok=True)
for name,body in re.findall(r"cat > .voltra/([^ ]+) <<'[^']+'\n(.*?)\n[A-Z_]+(?:\n|$)",script,re.S):
 (helpers/name).write_text(body+'\n')
print(json.dumps({'emitted':sorted(p.name for p in helpers.iterdir())}))
