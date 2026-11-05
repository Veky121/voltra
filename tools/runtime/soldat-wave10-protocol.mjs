import assert from 'node:assert/strict';
export function decodeRefreshX(packet) {
 assert.equal(packet.length,1992,'Original Soldat2.7+ REFRESHX packet length required');
 const mapLength=packet[1944],nextLength=packet[1975];assert(mapLength<=16&&nextLength<=16,'Native map string bounds');
 const map=packet.subarray(1945,1945+mapLength).toString('utf8'),nextMap=packet.subarray(1976,1976+nextLength).toString('utf8');
 assert(map.length>0&&!/[\x00-\x1f\x7f]/.test(map),'Native map required');
 const mode=packet[1971],maxPlayers=packet[1972];assert(mode<=6&&maxPlayers<=32,'Native mode/player bounds');assert(packet[1974]<=1,'Native password bit required');
 return{packet_bytes:packet.length,map,next_map:nextMap,mode,max_players:maxPlayers,max_spectators:packet[1973],passworded:packet[1974]===1,players:[...packet.subarray(1504,1536)].filter(Boolean).length,time_limit_ticks:packet.readUInt32LE(1961),time_left_ticks:packet.readUInt32LE(1965),score_limit:packet.readUInt16LE(1969)};
}
