type Row=Record<string,any>;
export type NetworkSandbox={routes:Row[];nextID:number;label:string;domainRouteID:number|null};
export const emptyNetworkSandbox=():NetworkSandbox=>({routes:[],nextID:-1,label:'',domainRouteID:null});
export function networkSandboxAllowed(development:boolean,hostname:string,admin:boolean,ports:Row[],setup:Row|undefined){
 return development&&['localhost','127.0.0.1','[::1]','::1'].includes(hostname)&&admin&&!!setup&&!setup.clients?.length&&!setup.routes?.length&&ports.length>0&&ports.every(p=>p.ip==='127.0.0.1'||p.ip==='::1');
}
export function networkSandboxView(state:NetworkSandbox,ports:Row[]){
 const client={id:-1,gateway_id:-1,name:'Local test gateway',public_host:'gateway.voltra.test',public_port_start:1024,public_port_end:65535};
 const choices:Row[]=state.routes.filter(r=>ports.some(p=>p.is_default&&p.id===r.allocation_id)).map(r=>({...r,domain:'voltra.test'}));
 const route=choices.find(r=>r.id===state.domainRouteID);
 return {setup:{clients:[client],allocations:ports.map(p=>({...p,forward_client_ids:[-1]})),routes:state.routes},domain:{choices,label:state.label,hostname:state.label&&route?`play.${state.label}.voltra.test`:'',route,dns_status:'simulated',dns_matches:false}};
}
export type SandboxAction={type:'forward';allocationID:number;protocols:string[];publicPort:number}|{type:'remove-route';id:number}|{type:'subdomain';label:string;routeID:number}|{type:'remove-domain'};
export function updateNetworkSandbox(state:NetworkSandbox,action:SandboxAction,ports:Row[]):NetworkSandbox{
 if(action.type==='remove-domain')return {...state,label:'',domainRouteID:null};
 if(action.type==='remove-route')return {...state,routes:state.routes.filter(r=>r.id!==action.id),...(state.domainRouteID===action.id?{label:'',domainRouteID:null}:{})};
 if(action.type==='subdomain'){
  const label=action.label.trim().toLowerCase();
  const choices=networkSandboxView(state,ports).domain.choices;
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)||!choices.some(r=>r.id===action.routeID))throw new Error('Choose a forwarded port and a valid subdomain name.');
  return {...state,label,domainRouteID:action.routeID};
 }
 const port=ports.find(p=>p.id===action.allocationID);
 if(!port||!action.protocols.length||action.protocols.some(p=>!['tcp','udp'].includes(p)))throw new Error('Choose a server port and protocol.');
 const publicPort=action.publicPort||Number(port.port);
 if(!Number.isInteger(publicPort)||publicPort<1024||publicPort>65535)throw new Error('Choose a public port from 1024 to 65535.');
 const routes=[...state.routes];let nextID=state.nextID;
 for(const protocol of new Set(action.protocols)){
  if(routes.some(r=>r.protocol===protocol&&r.public_port===publicPort&&r.allocation_id!==port.id))throw new Error('That public port is already used by another test route.');
  const index=routes.findIndex(r=>r.allocation_id===port.id&&r.protocol===protocol);
  const route={id:index>=0?routes[index].id:nextID--,allocation_id:port.id,gateway_id:-1,client_id:-1,protocol,local_ip:port.ip,local_port:port.port,public_host:'gateway.voltra.test',public_port:publicPort,gateway_name:'Local test gateway',desired_present:true,status:'simulated'};
  if(index>=0)routes[index]=route;else routes.push(route);
 }
 return {...state,routes,nextID};
}
