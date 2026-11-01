// One request at a time. Hidden views do no work; failures back off to 10 s.
// The caller owns error presentation. Stop aborts the current request.
export function visiblePoll(task:(signal:AbortSignal)=>Promise<void>):()=>void {
  let active=true,failures=0,request:AbortController|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  async function poll(){
    if(!active||document.hidden||request)return;
    const current=new AbortController();request=current;
    try{await task(current.signal);failures=0}
    catch{if(!current.signal.aborted)failures++}
    finally{
      if(request===current)request=undefined;
      if(active&&!document.hidden)timer=setTimeout(poll,Math.min(10000,1000*2**Math.min(failures,4)));
    }
  }
  const visibility=()=>{clearTimeout(timer);if(document.hidden)request?.abort();else void poll()};
  document.addEventListener('visibilitychange',visibility);
  void poll();
  return()=>{active=false;clearTimeout(timer);request?.abort();document.removeEventListener('visibilitychange',visibility)};
}
