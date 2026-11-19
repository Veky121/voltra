import {useEffect} from 'react';
import {api, unwrap} from '../lib';
import {useAPIRequest} from '../hooks/useAPIRequest';
import {isLivePathFresh} from '../hooks/liveEvents';

type Request=<R>(path:string,options?:RequestInit)=>Promise<R>;
// Pass a module-level `request`: the shared cache only reuses a read for the same function.
export function useGameRequest<T>(path:string|null,poll=0,request:Request=api){
  const result=useAPIRequest<any>(path,request);
  // Schedule after completion, so a slow response never overlaps the next poll.
  useEffect(()=>{
    if(!path||!poll||result.loading)return;
    let timer:ReturnType<typeof setTimeout>;
    function tick(){if(!document.hidden&&!isLivePathFresh(path!)){result.reload();return}timer=setTimeout(tick,poll)}
    timer=setTimeout(tick,poll);
    return()=>clearTimeout(timer);
  },[path,poll,result.loading,result.data,result.error,result.reload]);
  return {...result,data:result.data===null?null:unwrap(result.data) as T};
}
