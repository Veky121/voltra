import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('installer symlink paths execute CLI guards instead of silently succeeding',t=>{
 const root=mkdtempSync(join(tmpdir(),'fs25-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const real=join(root,'server'),alias=join(root,'container');mkdirSync(join(real,'.voltra'),{recursive:true});
 cpSync(new URL('../../internal/panel/game_library/fs25',import.meta.url),join(real,'.voltra/fs25'),{recursive:true});
 mkdirSync(join(real,'.voltra/scripts'));cpSync(new URL('../../internal/panel/game_library/scripts/operation-report.mjs',import.meta.url),join(real,'.voltra/scripts/operation-report.mjs'));
 symlinkSync(real,alias,'junction');
 for(const [file,args,expected] of [['game-update.mjs',['invalid-operation'],2],['dlc-update.mjs',['invalid-operation'],1],['download-game.mjs',[],1]]) {
  const result=spawnSync(process.execPath,[join(alias,'.voltra/fs25/lib',file),...args],{encoding:'utf8',env:{...process.env,AUTO_DOWNLOAD:'true',GAME_SERIAL:'',INSTALLER_DIR:join(root,'installer'),DLC_DIR:join(root,'dlc')}});
  assert.equal(result.status,expected,`${file}: ${result.stderr}`);
 }
});
