import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentCachedDLCs} from '../../internal/panel/game_library/fs25/lib/download-game.mjs';
function setup(t,version='1.2.1'){
 const dir=mkdtempSync(join(tmpdir(),'fs25-cache-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'FarmingSimulator25_pumpsAndHosesPack_1_2_1_0_ESD.exe'),Buffer.alloc(2048));
 const fetchImpl=async()=>new Response(`<h2 class="title-base">Farming Simulator 25</h2><h3>Pumps n' Hoses Pack</h3><h5>Update ${version} (today)</h5><h2>Farming Simulator 22</h2><h3>Pumps n' Hoses Pack</h3><h5>Update 1.3.0</h5>`);
 return {env:{DLC_DIR:dir},fetchImpl,dir};
}
test('cached current installer uses FS25 section only',async t=>{const {env,fetchImpl}=setup(t);assert.equal(await currentCachedDLCs(env,fetchImpl),true);});
test('stale cached installer requires publisher download',async t=>{const {env,fetchImpl}=setup(t,'1.2.2');assert.equal(await currentCachedDLCs(env,fetchImpl),false);});
test('tampered downloaded installer cannot satisfy cached check',async t=>{const {env,fetchImpl,dir}=setup(t);writeFileSync(join(dir,'FarmingSimulator25_pumpsAndHosesPack_1_2_1_0_ESD.exe.verified.json'),JSON.stringify({bytes:2048,sha256:'wrong'}));assert.equal(await currentCachedDLCs(env,fetchImpl),false);});
