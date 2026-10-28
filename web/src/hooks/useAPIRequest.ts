import {useCallback,useEffect,useRef,useState} from 'react';

import {observeQuery} from './queryCache';

type Request = <T>(path:string,options?:RequestInit)=>Promise<T>;
type RequestState<T> = {path:string|null;data:T|null;error:string;loading:boolean};

export function useAPIRequest<T>(path:string|null,request:Request) {
  const [state,setState]=useState<RequestState<T>>({path,data:null,error:'',loading:!!path});
  const refresh=useRef<()=>void>(()=>{});
  const reload=useCallback(()=>refresh.current(),[]);

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
      setState(previous=>({path,data:previous.path===path?previous.data:null,error:'',loading:true}));
      try {
        const data=await request<T>(path!,{signal:abort.signal});
        if(active)setState({path,data,error:'',loading:false});
      } catch(error) {
        if(active)setState(previous=>({...previous,data:[401,403,404].includes(Number((error as any)?.status))?null:previous.data,error:error instanceof Error?error.message:String(error),loading:false}));
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
