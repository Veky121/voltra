import {cpuThreads,cpuUsage} from './fleetCPUModel';
import type {LiveSnapshot} from '../hooks/liveEvents';

type Sources={nodes:string[];servers:string[]};
type Transport={request:(path:string,options:RequestInit)=>Promise<any>;observe:(path:string,receive:(sample:LiveSnapshot)=>void)=>(()=>void)|undefined;fresh:(path:string)=>boolean};
export function observeFleetTelemetry(sources:Sources,receive:(values:Record<string,number|null>)=>void,transport:Transport){
  let active=true,pending=false,timer:ReturnType<typeof setTimeout>,flushTimer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  const values:Record<string,number|null>={},versions=new Map<string,number>(),nodeExpires=new Map<string,number>();
  const publish=()=>{if(flushTimer===undefined)flushTimer=setTimeout(()=>{flushTimer=undefined;if(active&&!document.hidden)receive({...values})},50)};
  const stops=sources.servers.map(path=>transport.observe(path,sample=>{
    if(!active||document.hidden)return;
    versions.set(path,(versions.get(path)??0)+1);
    values[path]=sample.status===200?cpuUsage(sample.data):null;publish();
  }));
  async function poll(){
    if(!active||pending||document.hidden)return;
    pending=true;controller=new AbortController();const signal=controller.signal;
    const jobs=[...sources.nodes.filter(path=>(nodeExpires.get(path)??0)<=Date.now()),...sources.servers.filter(path=>!transport.fresh(path))];
    let next=0;
    await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
      while(next<jobs.length&&!signal.aborted){
        const path=jobs[next++],node=sources.nodes.includes(path),version=versions.get(path)??0;
        if(!node&&transport.fresh(path))continue;
        let reading:number|null=null;
        try{const payload=await transport.request(path,{signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});reading=node?cpuThreads(payload):cpuUsage(payload)}catch{/* Unknown stays unknown. */}
        if(!active||signal.aborted)continue;
        if(node)nodeExpires.set(path,Date.now()+(reading===null?15000:300000));
        if(node||version===(versions.get(path)??0)){values[path]=reading;publish()}
      }
    }));
    pending=false;
    if(active&&!document.hidden)timer=setTimeout(poll,signal.aborted?0:5000);
  }
  function visibility(){clearTimeout(timer);if(document.hidden){controller?.abort()}else timer=setTimeout(poll,1000)}
  document.addEventListener('visibilitychange',visibility);
  // Allow the shared socket's first snapshot to arrive before HTTP fallback.
  timer=setTimeout(poll,1000);
  return()=>{active=false;clearTimeout(timer);clearTimeout(flushTimer);controller?.abort();stops.forEach(stop=>stop?.());document.removeEventListener('visibilitychange',visibility)};
}
