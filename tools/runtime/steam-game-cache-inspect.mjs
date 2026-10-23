import fs from 'node:fs';import {core} from './steam-game-cache-common.mjs';
const report=JSON.parse(fs.readFileSync('.local/steam-game-cache/app90-cstrike/verification.json'));
console.log(core(['compare','--id',report.object,'--destination','/cache/steam-games/work/'+report.cases[0].id+'/payload']));
