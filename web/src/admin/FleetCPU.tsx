import {ResourceMetric} from '../ui/ResourceSummary';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {api} from '../lib';
import {summarizeCPU} from './fleetCPUModel';
import {observeFleetTelemetry} from './fleetTelemetry';
import {observeLivePath,isLivePathFresh} from '../hooks/liveEvents';

type FleetSources={nodes:{id:number|string}[];servers:{identifier?:string;uuid?:string}[]};
const CPUContext=createContext<Record<string,number|null>|null>(null);
const nodePath=(n:FleetSources['nodes'][number])=>`/api/admin/nodes/${encodeURIComponent(n.id)}/system-information`;
const serverPath=(s:FleetSources['servers'][number])=>`/api/client/servers/${encodeURIComponent(s.identifier||s.uuid||'')}/resources`;
export function FleetCPUProvider({nodes,servers,children}:FleetSources&{children:ReactNode}){
 const paths=JSON.stringify({nodes:nodes.map(nodePath),servers:servers.map(serverPath)});
 const [result,setResult]=useState<{key:string;values:Record<string,number|null>}|null>(null);
 useEffect(()=>observeFleetTelemetry(JSON.parse(paths),values=>setResult({key:paths,values}),{
  request:api,observe:observeLivePath,fresh:isLivePathFresh,
 }),[paths]);
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
