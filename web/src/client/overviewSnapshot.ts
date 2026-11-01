import {queryCacheEpoch} from '../hooks/queryCache';

// Keep a recent view while returning from a server. Always revalidate on mount.
// Never persist account/server information across authentication boundaries.
let snapshot:{epoch:number;at:number;servers:any[]}|undefined;
export function readOverviewSnapshot(){
  return snapshot?.epoch===queryCacheEpoch()&&Date.now()-snapshot.at<300_000?snapshot.servers:undefined;
}
export function writeOverviewSnapshot(servers:any[],epoch:number){
  if(epoch===queryCacheEpoch())snapshot={epoch,at:Date.now(),servers};
}
