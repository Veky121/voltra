import {readPolicy} from './readPolicy';
import {useCallback,useEffect,useRef,useState} from 'react';

import {observeQuery,applyLiveQuery,readQuerySnapshot,invalidateExactQuery,fenceQueryResponse} from './queryCache';
import {observeLivePath,isLivePathFresh,observeReadInvalidation} from './liveEvents';

type Request = <T>(path:string,options?:RequestInit)=>Promise<T>;
type RequestState<T> = {path:string|null;data:T|null;error:string;loading:boolean};

export function useAPIRequest<T>(path:string|null,request:Request) {
  const [state,setState]=useState<RequestState<T>>(()=>({path,...(readQuerySnapshot(path,request)??{data:null,error:'',loading:!!path})}));
  const refresh=useRef<()=>void>(()=>{});
  const reload=useCallback(()=>refresh.current(),[]);
  const liveVersion=useRef(0);
  useEffect(()=>{
    if(!path)return;
    const stop=observeLivePath(path,sample=>{
      liveVersion.current++;
      if(sample.invalidate){if(!invalidateExactQuery(path))refresh.current();return}
      const error=sample.status>=400?(sample.data?.errors?.[0]?.detail||'Live update unavailable.'):'';
      if(sample.status>=400&&![401,403,404].includes(sample.status)){
        applyLiveQuery(path,readQuerySnapshot(path,request)?.data??null,error);
        setState(previous=>({path,data:previous.path===path?previous.data:null,error,loading:false}));return;
      }
      const data=sample.status>=400?null:sample.data;
      applyLiveQuery(path,data,error);setState({path,data,error,loading:false});
    },()=>{liveVersion.current++;fenceQueryResponse(path)});
    const policy=readPolicy(path);
    if(!stop&&!policy)return;
    const invalidate=()=>{liveVersion.current++;if(!invalidateExactQuery(path))refresh.current()};
    // Snapshot topics already receive authorized payloads; other reads receive
    // only a hint and are fetched through their ordinary HTTP endpoint.
    const stopHints=!stop&&policy?observeReadInvalidation(path,invalidate):undefined;
    const visible=()=>{if(!document.hidden)invalidate()};
    document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
    // Timer retries coalesce with a slow request. Only an actual change hint
    // fences its result; repeated timer ticks must not starve slow connections.
    const fallback=setInterval(()=>{if(!document.hidden&&(!stop||!isLivePathFresh(path)))refresh.current()},stop?5000:policy!.reconcileMs);
    return()=>{clearInterval(fallback);stop?.();stopHints?.();document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible)};
  },[path]);

  useEffect(()=>{
    if(!path){
      setState({path,data:null,error:'',loading:false});
      return;
    }
    const shared=observeQuery(path,request,snapshot=>setState({path,...snapshot}));
    if(shared){
      refresh.current=shared.reload;
      return()=>{shared.unsubscribe();refresh.current=()=>{};};
    }
    let active=true,inFlight=false,queued=false;
    const abort=new AbortController();
    async function load() {
      if(!active)return;
      // Polling and repeated refresh clicks must not discard a slow response
      // or start more than one request at a time for this resource.
      if(inFlight){queued=true;return;}
      inFlight=true;
      const version=liveVersion.current;
      setState(previous=>({path,data:previous.path===path?previous.data:null,error:'',loading:true}));
      try {
        const data=await request<T>(path!,{signal:abort.signal});
        if(active&&version===liveVersion.current)setState({path,data,error:'',loading:false});
      } catch(error) {
        if(active&&version===liveVersion.current)setState(previous=>({...previous,data:[401,403,404].includes(Number((error as any)?.status))?null:previous.data,error:error instanceof Error?error.message:String(error),loading:false}));
      } finally {
        inFlight=false;
        if(active&&queued){queued=false;void load();}
      }
    }
    refresh.current=()=>{void load();};
    void load();
    return()=>{active=false;abort.abort();refresh.current=()=>{};};
  },[path,request]);

  // Effects run after rendering. Hide the previous resource immediately so
  // old values and permissions cannot be used with the new server's URL.
  const current=state.path===path?state:{data:null,error:'',loading:!!path};
  return {data:current.data,error:current.error,loading:current.loading,reload};
}
