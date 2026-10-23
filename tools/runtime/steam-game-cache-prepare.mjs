// A fresh anonymous utility only; no Panel API or game startup.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {core,native} from './steam-game-cache-common.mjs';
const directory='.local/steam-game-cache/app90-cstrike';fs.mkdirSync(directory,{recursive:true});
const file=directory+'/prepare.json';if(fs.existsSync(file))throw Error('Existing acquisition; inspect same request');
const id=randomUUID(),receipt={id,container:'voltra-game-cache-prepare-'+id.slice(0,8),appid:90,mod:'cstrike',platform:'linux',phase:'created'};
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');save();
core(['init','--id',id]);receipt.phase='acquiring';save();
receipt.proof=native(id,receipt.container,90,'cstrike','linux');receipt.phase='native_validated';save();
receipt.cache=core(['publish','--id',id]);receipt.phase='published';save();console.log({phase:receipt.phase,...receipt.cache});
