import {ResourceMetric} from '../ui/ResourceSummary';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {api} from '../lib';
import {cpuThreads,cpuUsage,summarizeCPU} from './fleetCPUModel';

type FleetSources={nodes:{id:number|string}[];servers:{identifier?:string;uuid?:string}[]};
const CPUContext=createContext<Record<string,number|null>|null>(null);
const nodePath=(n:FleetSources['nodes'][number])=>`/api/admin/nodes/${encodeURIComponent(n.id)}/system-information`;
const serverPath=(s:FleetSources['servers'][number])=>`/api/client/servers/${encodeURIComponent(s.identifier||s.uuid||'')}/resources`;
export function FleetCPUProvider({nodes,servers,children}:FleetSources&{children:ReactNode}){
 const paths=JSON.stringify({nodes:nodes.map(nodePath),servers:servers.map(serverPath)});
 const [result,setResult]=useState<{key:string;values:Record<string,number|null>}|null>(null);
 useEffect(()=>{
  const sources=JSON.parse(paths) as {nodes:string[];servers:string[]};
  let active=true,pending=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  async function poll(){
   if(!active||pending||document.hidden)return;
   pending=true;controller=new AbortController();const signal=controller.signal;
   const jobs=[...sources.nodes,...sources.servers],values:(number|null)[]=Array(jobs.length).fill(null);
   let next=0;
   await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
    while(next<jobs.length&&!signal.aborted){
     const index=next++;
     try{
      const payload=await api(jobs[index],{signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});
      values[index]=index<sources.nodes.length?cpuThreads(payload):cpuUsage(payload);
     }catch{/* Missing telemetry remains unknown, never zero. */}
    }
   }));
   if(active&&!signal.aborted)setResult({key:paths,values:Object.fromEntries(jobs.map((path,index)=>[path,values[index]]))});
   pending=false;
   if(active&&!document.hidden)timer=setTimeout(poll,signal.aborted?0:10000);
  }
  function visibility(){clearTimeout(timer);if(document.hidden){controller?.abort();setResult(null)}else void poll()}
  document.addEventListener('visibilitychange',visibility);void poll();
  return()=>{active=false;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visibility)};
 },[paths]);
 return <CPUContext.Provider value={result?.key===paths?result.values:null}>{children}</CPUContext.Provider>;
}

export default function FleetCPU({nodes,servers,label='Server CPU usage across nodes'}:FleetSources&{label?:string}){
 const values=useContext(CPUContext);
 const sample=values?summarizeCPU(nodes.map(n=>values[nodePath(n)]??null),servers.map(s=>values[serverPath(s)]??null)):null;
 const text=!nodes.length?'No nodes':!sample?'Loading':sample.complete?`${sample.percent!.toFixed(1)}%`:'Unavailable';
 const note=!nodes.length?'Add a node to see CPU usage':!sample?'Reading server CPU usage':sample.complete?`${sample.used.toFixed(2)} / ${sample.total} vCPUs · server load`:`Telemetry incomplete · ${sample.available}/${servers.length} servers`;
 return <ResourceMetric className="fleet-cpu" label="CPU" value={text} note={note} percent={sample?.complete?sample.percent!:undefined}
 title="Combined CPU used by managed servers, divided by node CPU threads. Excludes the node operating system and other processes."/>;
}
