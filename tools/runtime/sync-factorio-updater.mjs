// Keep the reviewed recipe's embedded installer in sync with the audited source.
import fs from 'node:fs';
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file));
const profile=profiles['factorio/factorio-modupdate/egg-factorio-modupdate.json'];
const source=fs.readFileSync('internal/panel/game_library/scripts/factorio-update-mods.sh','utf8');
const pattern=/(cat > \.voltra\/factorio-update-mods\.sh <<'MODUPDATE'\n)[\s\S]*?(\nMODUPDATE\n)/;
if(!pattern.test(profile.egg.scripts.installation.script))throw Error('Updater embedding marker missing');
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(pattern,(_,a,b)=>a+source+b);
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');
