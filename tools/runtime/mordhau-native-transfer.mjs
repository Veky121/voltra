import fs from 'node:fs';import assert from 'node:assert/strict';import {transact} from './batch-queue.mjs';import {api,rows} from './openttd-compat-node.mjs';
const game='mordhau/egg-mordhau.json';
assert.equal(rows(await api('/api/application/servers')).filter(s=>/mordhau/i.test(s.name+' '+s.external_id)).length,0,'Existing Mordhau resource; coordinate');
const result=transact('.local/game-batch/queue.json',q=>{
 assert(!q.claims.some(c=>c.game===game&&c.status==='active'));
 assert(!q.claims.some(c=>c.game===game),'Prior lease requires explicit terminal requeue review');
 const r=q.reservations.find(x=>x.game===game);assert.equal(r.owner,'racing_games');
 const wine=JSON.stringify(q.reservations.find(x=>x.game==='mordhau/egg-mordhau-wine.json'));
 r.owner='unreal_survival';assert.equal(JSON.stringify(q.reservations.find(x=>x.game==='mordhau/egg-mordhau-wine.json')),wine);
 return{game,from:'racing_games',to:r.owner,no_prior_claim:true,no_existing_named_server:true,wine_reservation_unchanged:true,at:new Date().toISOString()};
});
fs.writeFileSync('artifacts/mordhau-native-reservation-transfer.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(result);
