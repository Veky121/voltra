import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {stage,key} from './stage-notd-owner.mjs';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const before=JSON.stringify(current);
const {profiles,hashes}=stage(current),p=profiles[key];
assert.deepEqual(Object.keys(profiles),[key]);
assert.equal(JSON.stringify(current),before);
assert.deepEqual(p.egg.variables,current[key].egg.variables);
assert.deepEqual(p.defaults,current[key].defaults);
assert.equal(p.egg.startup,'exec python3 .voltra/notd-server.py run');
const script=p.egg.scripts.installation.script;
assert.ok(script.endsWith('python3 .voltra/notd-server.py install\n'));
let count=0;
for(const match of script.matchAll(/cat > \.voltra\/([^\s]+) <<'([^']+)'\n([\s\S]*?)\n\2\n/g)){
 assert.equal(crypto.createHash('sha256').update(match[3]).digest('hex'),hashes[match[1]]);
 count++;
}
assert.equal(count,Object.keys(hashes).length);
assert.ok(count>5);
console.log(`PASS exact NOTD scope, ordered controls/defaults retained, ${count} current embeds verified, canonical unchanged`);
