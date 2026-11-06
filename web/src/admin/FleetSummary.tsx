import {Feedback} from '../notifications';
import {ResourceSummary,ResourceMetric} from '../ui/ResourceSummary';
import {formatMiBGB} from '../resourceUnits';
import {useAPI,rows,ErrorBox} from '../lib';
import FleetCPU,{FleetCPUProvider} from './FleetCPU';

type RecordData=Record<string,any>;
export function Capacity({label,capacity,allocated,unlimited}:{label:string;capacity:number;allocated:number;unlimited:boolean}){
  return <ResourceMetric label={label} value={<>{formatMiBGB(Math.max(0,capacity-allocated))} <small>free</small></>} percent={allocated/Math.max(capacity,1)*100}
    title="Configured capacity minus allocations; not live usage. Excludes over-allocation."
    note={<>{formatMiBGB(allocated)} allocated / {formatMiBGB(capacity)}{allocated>capacity&&<Feedback title={label} tone="warning" message={`${formatMiBGB(allocated-capacity)} over capacity`}/>}</>}/>;
}
export function FleetSummary({nodes,servers}:{nodes:RecordData[];servers:RecordData[]}){
  return <ResourceSummary label="CPU usage and node capacity"><FleetCPU nodes={nodes as {id:number|string}[]} servers={servers}/>{(['memory','disk'] as const).map(key=><Capacity key={key} label={key==='memory'?'Memory':'Storage'}
    capacity={nodes.reduce((sum,n)=>sum+Number(n[key]??0),0)} allocated={nodes.reduce((sum,n)=>sum+Number(n.allocated_resources?.[key]??0),0)}
    unlimited={servers.some(s=>Number(s.limits?.[key]??s[key]??0)===0)}/>)}</ResourceSummary>;
}
/** Mount only after administrator permission has been established. */
export function AdminResourceSummary(){
  const servers=useAPI('/api/application/servers?per_page=100'),nodes=useAPI('/api/application/nodes?per_page=100');
  const list=servers.data?rows(servers.data):[],hosts=nodes.data?rows(nodes.data):[];
  const error=servers.error||nodes.error;
  if(error||!servers.data||!nodes.data)return <><ResourceSummary label="CPU usage and node capacity">{['CPU','Memory','Storage'].map(label=><ResourceMetric key={label} label={label} value={error?'Unavailable':'Loading'} note={error?'Could not read node capacity':'Reading node capacity'}/>)}</ResourceSummary><ErrorBox>{error}</ErrorBox></>;
  return <FleetCPUProvider nodes={hosts as {id:number|string}[]} servers={list}><FleetSummary nodes={hosts} servers={list}/></FleetCPUProvider>;
}
