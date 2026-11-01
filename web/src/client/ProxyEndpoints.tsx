import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import {ButtonFeedback} from '../ui/ButtonFeedback';
import {RefreshCw,Link2} from 'lucide-react';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {api,Button,Input,Select,useAPI} from '../lib';
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {CopyButton} from '../ui/CopyButton';
import {confirmAction} from '../ui/ConfirmAction';
import {useErrorState} from '../notifications/useErrorState';
import {items,PageError,useServer,value} from './common';
import './serverProxy.css';

const address=(host:string,port:number)=>`${host.includes(':')?`[${host}]`:host}:${port}`;
const status=(r:any)=>!r.desired_present?'Removal pending':r.status==='applied'?'Applied':r.status==='error'?'Needs attention':'Pending';
export function ProxyEndpoints({base,revision=0}:{base:string;revision?:number}) {
 const account=useAPI('/api/client/account'),admin=value(account.data)?.root_admin===true;
 const query=useAPI(!account.loading&&!admin?`${base}/proxy-routes`:null);
 if(account.loading)return <p role="status">Loading proxy settings...</p>;
 if(admin)return <ServerProxyManager key={`${base}:${revision}`} base={base}/>;
 return <SettingsSection title="Routing"><PageError error={account.error||query.error}/>
  {query.error?null:query.loading?<p className="server-proxy-note">Loading connections...</p>:items(query.data).length?<div className="settings-options-grid server-proxy-routes">{items(query.data).map(r=><SettingsRow key={r.id} label={address(r.public_host,r.public_port)} description={`${String(r.protocol).toUpperCase()} · ${r.status}`} control={<CopyButton value={address(r.public_host,r.public_port)}>Copy address</CopyButton>}/>)}</div>:<p className="server-proxy-note">No proxy routes. An administrator can connect this server to a gateway.</p>}
 </SettingsSection>;
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
 const primary=allocations.find(p=>p.is_default),primaryRoutes=routes.filter(r=>r.allocation_id===primary?.id&&r.desired_present);
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
  <SettingsSection title="Routing" action={<div className="server-proxy-actions"><Link className="button secondary" to="/admin/integrations/proxy-gateways">Manage gateways</Link><Button variant="secondary" className="connection-check" aria-label="Refresh routes" title="Refresh routes" disabled={busy||query.loading} onClick={query.reload}><ButtonFeedback state={query.loading?'pending':'idle'}><RefreshCw/></ButtonFeedback></Button></div>}>
   <PageError error={query.error}/><PageError error={error} onDismiss={()=>setError('')}/>
   {query.error&&!data?null:query.loading&&!data?<p className="server-proxy-note" role="status">Loading connections...</p>:<>
    <p className="server-proxy-note server-proxy-summary">{primaryRoutes.some(r=>r.status==='applied')?'Gateway connected':primaryRoutes.length?'Gateway needs attention':'Direct connection'}</p>
    <div className="settings-options-grid server-proxy-routes">
    {routes.map(route=><SettingsRow key={route.id} label={<CopyButton value={address(route.public_host,route.public_port)} onCopyError={setError}>{address(route.public_host,route.public_port)}</CopyButton>} description={`${route.gateway_name} · ${route.protocol.toUpperCase()} to ${address(route.local_ip,route.local_port)}${route.allocation_id===primary?.id?' · Primary':''}`} control={<div className="server-proxy-actions"><span className="badge" data-status={route.status}>{status(route)}</span>{route.status!=='applied'||!route.desired_present?<Button variant="secondary" disabled={busy} onClick={()=>void run(()=>apply(route))}>{route.desired_present?'Retry':'Retry removal'}</Button>:null}{route.desired_present&&<Button variant="danger" disabled={busy} onClick={async()=>{if(await confirmAction({title:'Remove public connection?',description:`Disconnect ${address(route.public_host,route.public_port)}? Players using this route will lose access. The server keeps its node port.`,confirmLabel:'Remove route',danger:true}))void run(async()=>{await api(`/api/admin/proxy-gateways/${route.gateway_id}/routes/${route.id}`,{method:'DELETE'});await apply(route)})}}>Remove</Button>}</div>}>{route.last_error&&<p role="alert" className="server-proxy-error">{route.last_error}</p>}</SettingsRow>)}
    </div>
    <Disclosure className="connection-details"><DisclosureTrigger>Details</DisclosureTrigger><p>Applied confirms gateway configuration, not game reachability.</p></Disclosure>
   </>}
  </SettingsSection>
  {data&&<Disclosure className="connection-routing" defaultOpen={!primaryRoutes.length}><DisclosureTrigger>{primaryRoutes.length?'Add connection':'Connect through a gateway'}</DisclosureTrigger>
  <SettingsSection title="Gateway connection">
   {!eligible.length?<p className="server-proxy-note">{clients.length?'No tested gateway covers this port.':'Connect this node to a gateway first.'} <Link to="/admin/integrations/proxy-gateways">Set up gateway</Link></p>:null}
   {!!clients.length&&<form onSubmit={e=>{e.preventDefault();void connect()}}><fieldset disabled={busy||query.loading||!!query.error}>
    <div className="settings-options-grid">
     <SettingsRow label="Server port"  control={<Select aria-label="Server port" value={String(allocation?.id||'')} onChange={e=>{setAllocation(e.target.value);setClient('');setProtocol('');setPublicPort('')}}><option value="">Choose port</option>{allocations.map(p=><option key={p.id} value={p.id}>{address(p.ip,p.port)}{p.is_default?' · Primary':''}{p.notes?` · ${p.notes}`:''}</option>)}</Select>}/>
     <SettingsRow label="Gateway"  control={<Select aria-label="Proxy gateway" value={String(client?.id||'')} onChange={e=>{setClient(e.target.value);setPublicPort('')}}><option value="">Choose gateway</option>{eligible.map(c=><option key={c.id} value={c.id}>{c.name} · {c.public_host}</option>)}</Select>}/>
     <SettingsRow label="Protocol" info={allocation?.is_default&&data?.primary_protocol==='tcp'?'Minecraft Java uses TCP.':'Use the game protocol. Add a separate route if both TCP and UDP are required.'} control={<Select aria-label="Proxy protocol" required value={selectedProtocol} onChange={e=>setProtocol(e.target.value)}><option value="">Choose protocol</option><option value="tcp">TCP</option><option value="udp">UDP</option></Select>}/>
     <SettingsRow label="Public port" info="Automatic uses the same port when available, otherwise a free port. The server port stays unchanged." control={<Select aria-label="Public port assignment" value={customPort?'custom':'auto'} onChange={e=>setCustomPort(e.target.value==='custom')}><option value="auto">Automatic</option><option value="custom">Choose a port</option></Select>}/>
     {customPort&&<SettingsRow label="Port number" description={client?`Allowed range: ${client.public_port_start}–${client.public_port_end}`:undefined} control={<Input aria-label="Public port number" type="number" required min={client?.public_port_start??1} max={client?.public_port_end??65535} value={publicPort} onChange={e=>setPublicPort(e.target.value)}/>}/>}
    </div>
    <div className="server-proxy-footer"><span>{existing?existing.desired_present?'This route already exists. Retry checks and applies the same mapping.':'This route is awaiting removal. Finish removing it above.':client&&allocation?`${client.public_host}:${customPort?publicPort||'…':'automatic'} to ${address(allocation.ip,allocation.port)}`:'Choose a port and gateway to continue.'}</span><Button type="submit" disabled={!allocation||!client||!selectedProtocol||(existing&&!existing.desired_present)||customPort&&!publicPort}><ButtonFeedback state={busy?'pending':'idle'}><Link2/></ButtonFeedback>{busy?'Connecting...':existing?'Retry':'Connect'}</Button></div>
   </fieldset></form>}
  </SettingsSection></Disclosure>}
 </div>;
}
