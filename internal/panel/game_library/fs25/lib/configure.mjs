import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

const env = process.env;
const defaults = {SERVER_NAME:'FS25 Server',ADMIN_PASSWORD:'',GAME_PASSWORD:'',SAVEGAME_INDEX:'1',MAX_PLAYERS:'12',SERVER_PORT:'10823',SERVER_LANGUAGE:'en',AUTO_SAVE_INTERVAL:'180.000000',STATS_INTERVAL:'360.000000',CROSSPLAY:'true',PAUSE_IF_EMPTY:'2',MAP_ID:'MapUS'};
const values = {...defaults, ...env, LANGUAGE:env.SERVER_LANGUAGE || 'en'};
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
mkdirSync(env.DEDI_DIR, {recursive:true});
for (const [file, directory] of [['dedicatedServer.xml',env.GAME_DIR],['dedicatedServerConfig.xml',env.DEDI_DIR]]) {
  const template = readFileSync(join(env.FS25_CONFIG, file+'.tmpl'), 'utf8');
  let content = template.replace(/%%([A-Z_]+)%%/g, (_, name) => {
    if (values[name] === undefined) throw Error('Missing setting '+name);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(values[name])) throw Error('Invalid XML character in '+name);
    return escape(values[name]);
  });
  if(file==='dedicatedServerConfig.xml') {
    try {const existing=readFileSync(join(directory,file),'utf8');const mods=existing.match(/<mods(?:\s[^>]*)?>[\s\S]*?<\/mods>/)?.[0];if(mods)content=content.replace('</gameserver>',mods+'\n</gameserver>');} catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  writeFileSync(join(directory,file),content,{mode:0o600});
}
console.log('[fs25] Configuration saved.');
