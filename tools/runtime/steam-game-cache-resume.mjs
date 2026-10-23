// Resume only the unbooted utility acquisition rejected by metadata review.
import fs from 'node:fs';import {core,native} from './steam-game-cache-common.mjs';
const file='.local/steam-game-cache/app90-cstrike/prepare.json',receipt=JSON.parse(fs.readFileSync(file));
if(receipt.phase!=='acquiring'||receipt.appid!==90||receipt.mod!=='cstrike')throw Error('Only the retained pristine acquisition may resume');
receipt.proof=native(receipt.id,receipt.container+'-metadata',90,'cstrike','linux',false,true);receipt.phase='native_validated';fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');
receipt.cache=core(['publish','--id',receipt.id]);receipt.phase='published';fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');console.log({phase:receipt.phase,...receipt.cache});
