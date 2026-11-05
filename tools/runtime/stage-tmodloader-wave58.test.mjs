import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stage,key} from './stage-tmodloader-wave58.mjs';
test('only embedded runtime and exact installer import change',()=>{
 const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
 const helper=fs.readFileSync('internal/panel/game_library/scripts/tmodloader-runtime.py','utf8');
 const before=JSON.stringify(current), staged=stage(current,helper);
 assert.deepEqual(Object.keys(staged),[key]);assert.equal(JSON.stringify(current),before);
 const old=structuredClone(current[key]),next=structuredClone(staged[key]);
 const script=next.egg.scripts.installation.script;
 assert(script.includes('from tmodloader_runtime import install'));
 assert(script.includes('cat > .voltra/tmodloader_runtime.py'));
 delete old.egg.scripts.installation.script;delete next.egg.scripts.installation.script;
 assert.deepEqual(next,old);
 assert.throws(()=>stage({},helper));
});
