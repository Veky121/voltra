"""Stage exact OpenTTD-only private-file repair from the current root profile."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2]
out=root/'artifacts/game-parity-20261029'
canonical=(root/'internal/panel/game_library/scripts/openttd-start.sh').read_text()
anchor='# Atomic managed-key update; retain all other settings, saves and comments.\ntest -f openttd.cfg && test ! -L openttd.cfg\n'
preflight='''# Native config saves must not broaden credential-file permissions.
# Validate every known target before changing any config bytes or modes.
for native_config in openttd.cfg openttd.cfg.new private.cfg private.cfg.new secrets.cfg secrets.cfg.new; do
  test ! -L "$native_config" || { echo 'Native config symlink refused' >&2; exit 1; }
  test ! -e "$native_config" || test -f "$native_config" || { echo 'Native config must be a regular file' >&2; exit 1; }
done
test -f openttd.cfg
umask 077
for native_config in openttd.cfg openttd.cfg.new private.cfg private.cfg.new secrets.cfg secrets.cfg.new; do
  if test -f "$native_config"; then chmod 600 "$native_config"; fi
done
# Atomic managed-key update; retain all other settings, saves and comments.
'''
if canonical.count(anchor)==1:
    candidate=canonical.replace(anchor,preflight)
else:
    old_loop='for native_config in openttd.cfg private.cfg secrets.cfg; do'
    new_loop='for native_config in openttd.cfg openttd.cfg.new private.cfg private.cfg.new secrets.cfg secrets.cfg.new; do'
    assert '# Native config saves must not broaden credential-file permissions.' in canonical
    assert canonical.count(old_loop)==2
    candidate=canonical.replace(old_loop,new_loop)
(out/'banana-wave4-openttd-start.sh.pending').write_text(candidate,encoding='utf-8',newline='\n')
recipe='openttd/egg-open-t-t-d-server.json'
profile=json.loads((root/'internal/panel/game_library/overrides.json').read_text())[recipe]
original_variables=json.dumps(profile['egg']['variables'],sort_keys=True)
script=profile['egg']['scripts']['installation']['script']
marker="cat > .voltra/openttd-start.sh <<'VOLTRA_OPENTTD_START'\n"
assert script.count(marker)==1
begin=script.index(marker)+len(marker)
end=script.index('VOLTRA_OPENTTD_START\n',begin)
assert script[begin:end].rstrip()==canonical.rstrip()
profile['egg']['scripts']['installation']['script']=script[:begin]+candidate+'\n'+script[end:]
profile['settings_documents']=list(dict.fromkeys(list(profile.get('settings_documents',[]))+['openttd.cfg','private.cfg','secrets.cfg']))
profile['revision']='openttd-15.3-compat-v4-native-private-v1'
assert json.dumps(profile['egg']['variables'],sort_keys=True)==original_variables
(out/'banana-wave4-openttd-private-profile.json').write_text(json.dumps({recipe:profile},indent=2)+'\n')
print('Staged candidate launcher and disjoint current-baseline profile; canonical sources untouched.')
