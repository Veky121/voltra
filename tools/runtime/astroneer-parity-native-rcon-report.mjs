import fs from 'node:fs';
const p='artifacts/game-parity-20261029/astroneer-native-readiness.json';const r=JSON.parse(fs.readFileSync(p));
r.status='Partial parity; bounded native RCON readiness evidence proven, shared integration pending';
r.rcon_diagnostic.verified_native_response={build:'1.45.1.0',playerInfo_array_responses:7,statistics_responses:7,secondsInGame:[2,12,21,31,40,50,60],native_pid:146,udp_port:29101,udp_inode:'2947357',tcp_port:29101,tcp_listen_inode:'2947295',tcp_fd_native_attribution:false,scope:'Repeated successful password-authenticated read-only native protocol replies and independently owned UDP. No external reachability/gameplay claim.'};
r.readiness.native_rcon_query_verified=true;r.readiness.candidate='Authenticated DSListPlayers playerInfo array plus DSServerStatistics typed payload from the owned native process';r.readiness.marker_selected=false;r.readiness.online_verified=false;
r.five_gates.console='partial: real native JSON RCON and owned UDP demonstrated; no Astro.log or integrated readiness signal';r.five_gates.lifecycle='partial: native process observed through60s in-game and scheduled stop130/noOOM; restart/crash/player and shared readiness integration incomplete';
r.next_action='Root review actual protocol evidence before approving scoped readiness adapter. Exact restored offline fixture and4GiB lease retained; no further starts authorized.';
r.updated_at=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({report:p,native_protocol_verified:true,gameplay:false}));
