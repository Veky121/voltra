import {ButtonFeedback} from '../ui/ButtonFeedback';
import {RefreshCw,Link2} from 'lucide-react';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {api,Button,Input,useAPI} from '../lib';
import {SettingsSection} from '../ui/Settings';
import {CopyButton} from '../ui/CopyButton';
import {confirmAction} from '../ui/ConfirmAction';
import {useErrorState} from '../notifications/useErrorState';
import {items,PageError,useServer,value} from './common';
import './serverProxy.css';

const address=(host:string,port:number)=>`${host.includes(':')?`[${host}]`:host}:${port}`;
const status=(r:any)=>r.desired_present===false?'Removal pending':r.status==='applied'?'Configured':r.status==='error'?'Needs attention':'Pending';
export function ProxyEndpoints({base,revision=0}:{base:string;revision?:number}) {
 const account=useAPI('/api/client/account'),admin=value(account.data)?.root_admin===true;
 const query=useAPI(!account.loading&&!admin?`${base}/proxy-routes`:null);
 if(account.loading)return <p role="status">Loading proxy settings...</p>;
 if(admin)return <ServerProxyManager key={`${base}:${revision}`} base={base}/>;
 return <SettingsSection title="Public connections"><PageError error={account.error||query.error}/>
  {query.error?null:query.loading?<p className="server-proxy-note" role="status">Loading connections...</p>:<RouteTable routes={items(query.data)}/>}
 </SettingsSection>;
}
export function RouteTable({routes,actions}:{routes:any[];actions?:(route:any)=>React.ReactNode}) {
 if(!routes.length)return <p className="server-proxy-note">No public connections configured.</p>;
 return <><div className="network-table-scroll"><table className="network-route-table"><thead><tr><th>Public address</th><th>Protocol</th><th>Server address</th><th>Gateway status</th>{actions&&<th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{routes.map(route=><tr key={route.id}><td><CopyButton value={address(route.public_host,route.public_port)}/><small>{route.gateway_name}</small></td><td><span className="network-protocol">{String(route.protocol).toUpperCase()}</span></td><td>{address(route.local_ip,route.local_port)}</td><td><span className="badge" data-status={route.status}>{status(route)}</span>{route.last_error&&<small className="server-proxy-error" role="alert">{route.last_error}</small>}</td>{actions&&<td>{actions(route)}</td>}</tr>)}</tbody></table></div><p className="network-status-note">Configured = accepted by gateway. Game reachability is unverified.</p></>;
}

function ServerProxyManager({base}:{base:string}) {
 const {server,reload}=useServer(),path=`/api/admin/servers/${encodeURIComponent(server.uuid||server.identifier)}/proxy`;
 const query=useAPI(path),data=value(query.data);
 const [allocationID,setAllocation]=useState(''),[clientID,setClient]=useState(''),[protocol,setProtocol]=useState(''),[publicPort,setPublicPort]=useState('');
 const [customPort,setCustomPort]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useErrorState('client/ProxyEndpoints.tsx',{transient:true});
 const allocations:any[]=data?.allocations||[],clients:any[]=data?.clients||[],routes:any[]=data?.routes||[];
 const allocation=allocations.find(p=>String(p.id)===allocationID)||(!allocationID?allocations[0]:undefined);
 const eligible=clients.filter(c=>c.setup_complete&&c.test_status==='complete'&&allocation&&allocation.port>=c.local_port_start&&allocation.port<=c.local_port_end);
 const client=eligible.find(c=>String(c.id)===clientID)||(!clientID&&eligible.length===1?eligible[0]:undefined);
 const selectedProtocol=protocol||(allocation?.is_default?data?.primary_protocol:'')||'';
 const existing=routes.find(r=>r.allocation_id===allocation?.id&&r.client_id===client?.id&&r.protocol===selectedProtocol);
 
 const refresh=()=>{query.reload();reload();window.dispatchEvent(new CustomEvent('server-proxy-changed',{detail:base}))};
 async function apply(route:any){
  const response=await api(`/api/admin/proxy-gateways/${route.gateway_id}/routes/${route.id}/apply`,{method:'POST'});
  const failed=items(response).find(r=>r.status!=='applied');
  if(failed)throw new Error(failed.last_error||'Route saved, but the gateway has not applied it. Retry this route.');
 }
 async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false);refresh()}}
 async function connect(){
  if(!client||!allocation||!selectedProtocol)return;
  if(!await confirmAction({title:existing?'Retry proxy route?':'Enable public connection?',description:`Expose ${address(allocation.ip,allocation.port)} over ${selectedProtocol.toUpperCase()} through ${client.name}${customPort?` on public port ${publicPort}`:' using an available public port'}? The game port stays unchanged.`,confirmLabel:existing?'Retry route':'Enable proxy'}))return;
  await run(async()=>{const route=value(await api(path,{method:'POST',body:JSON.stringify({client_id:client.id,allocation_id:allocation.id,protocol:selectedProtocol,public_port:customPort?Number(publicPort):0})}));await apply(route)});
 }
 return <div className="server-proxy-manager">
  <SettingsSection title="Public connections" action={<div className="server-proxy-actions"><Link className="button secondary" to="/admin/integrations/proxy-gateways">Manage gateways</Link><Button variant="secondary" className="connection-check" aria-label="Refresh routes" title="Refresh routes" disabled={busy||query.loading} onClick={query.reload}><ButtonFeedback state={query.loading?'pending':'idle'}><RefreshCw/></ButtonFeedback></Button></div>}>
   <PageError error={query.error}/><PageError error={error} onDismiss={()=>setError('')}/>
   {query.error&&!data?null:query.loading&&!data?<p className="server-proxy-note" role="status">Loading connections...</p>:<>
    {!routes.length&&!clients.length?<div className="network-empty"><div><strong>No gateway connected</strong><p>No public forwarding configured.</p></div><Link className="button secondary" to="/admin/integrations/proxy-gateways">Set up gateway</Link></div>:<RouteTable routes={routes} actions={route=><div className="server-proxy-actions">{(route.status!=='applied'||!route.desired_present)&&<Button variant="secondary" disabled={busy} onClick={()=>void run(()=>apply(route))}>{route.desired_present?'Retry':'Retry removal'}</Button>}{route.desired_present&&<Button variant="danger" disabled={busy} onClick={async()=>{if(await confirmAction({title:'Remove public connection?',description:`Disconnect ${address(route.public_host,route.public_port)}? Players using this route will lose access.`,confirmLabel:'Remove route',danger:true}))void run(async()=>{await api(`/api/admin/proxy-gateways/${route.gateway_id}/routes/${route.id}`,{method:'DELETE'});await apply(route)})}}>Remove</Button>}</div>}/>}

   </>}
  </SettingsSection>
  {data&&clients.length>0&&<SettingsSection title="Add connection">
   {!eligible.length&&<p className="server-proxy-note">{clients.length?'No tested gateway covers this port.':'No gateway connected.'} <Link to="/admin/integrations/proxy-gateways">Set up gateway</Link></p>}
   {!!clients.length&&<form onSubmit={e=>{e.preventDefault();void connect()}}><fieldset disabled={busy||query.loading||!!query.error}>
    <div className="network-connect-form">
     <div className="network-choice"><span>Server port</span><div>{allocations.map(p=><Button key={p.id} variant="secondary" aria-pressed={allocation?.id===p.id} onClick={()=>{setAllocation(String(p.id));setClient('');setProtocol('');setPublicPort('')}}>{address(p.ip,p.port)}</Button>)}</div></div>
     <div className="network-choice"><span>Gateway</span><div>{eligible.length?eligible.map(c=><Button key={c.id} variant="secondary" aria-pressed={client?.id===c.id} onClick={()=>{setClient(String(c.id));setPublicPort('')}}>{c.name}</Button>):<span className="muted">None available</span>}</div></div>
     <div className="network-choice"><span>Protocol</span><div>{['tcp','udp'].map(p=><Button key={p} variant="secondary" aria-pressed={selectedProtocol===p} onClick={()=>setProtocol(p)}>{p.toUpperCase()}</Button>)}</div></div>
     <label className="network-choice"><span>Public port</span><Input aria-label="Public port" type="number" min={client?.public_port_start??1} max={client?.public_port_end??65535} placeholder="Automatic" value={publicPort} onChange={e=>{setPublicPort(e.target.value);setCustomPort(!!e.target.value)}}/></label>
     <Button type="submit" disabled={!allocation||!client||!selectedProtocol||(existing&&!existing.desired_present)||customPort&&!publicPort}><ButtonFeedback state={busy?'pending':'idle'}><Link2/></ButtonFeedback>{busy?'Connecting...':existing?'Retry':'Connect'}</Button>
    </div>
    {existing&&<p className="network-status-note">{existing.desired_present?'This route already exists. Retry reapplies it.':'Removal pending. Retry removal above.'}</p>}
   </fieldset></form>}
  </SettingsSection>}
 </div>;
}
