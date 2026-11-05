import {CollectionSkeleton} from '../ui/CollectionSkeleton';
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api,Button,Input,Modal,useAPI} from '../lib';
import {SettingsSection} from '../ui/Settings';
import {CopyButton} from '../ui/CopyButton';
import {confirmAction} from '../ui/ConfirmAction';
import {can,items,PageError,useServer,value} from './common';
import {connectionAddress as address} from './connectionAddress';
import {portConnectionActions,groupPortRoutes} from './portConnectionActions';
import {emptyNetworkSandbox,networkSandboxAllowed,networkSandboxView,updateNetworkSandbox} from '../dev/networkSandbox';
import './serverProxy.css';

type Row=Record<string,any>;
const routeStatus=(r:Row)=>r.desired_present===false?'Removing':r.status==='simulated'?'Test only':r.status==='applied'?'Configured':r.status==='error'?'Needs attention':'Pending';
export default function PortConnections(){
 const {base,server,permissions,reload}=useServer();
 const allocations=useAPI(`${base}/network/allocations`),account=useAPI('/api/client/account');
 const admin=value(account.data)?.root_admin===true,writable=can(permissions,'allocation.update');
 const path=`/api/admin/servers/${encodeURIComponent(server.uuid||server.identifier)}/proxy`;
 const setup=useAPI(admin?path:null),publicRoutes=useAPI(!account.loading&&!admin?`${base}/proxy-routes`:null),domain=useAPI(`${base}/subdomain`);
 const realSetup=value(setup.data),realDomain=value(domain.data)||{};
 const ports=items(allocations.data);
 const [testRequested,setTestRequested]=useState(true),[testState,setTestState]=useState(emptyNetworkSandbox);
 const testAvailable=networkSandboxAllowed(import.meta.env.DEV,window.location.hostname,admin,ports,setup.error?undefined:realSetup);
 const testing=testAvailable&&testRequested;
 const testView=networkSandboxView(testState,ports);
 const setupData=testing?testView.setup:realSetup,domainData=testing?testView.domain:realDomain;
 const routes:Row[]=(admin?setupData?.routes||[]:items(publicRoutes.data)).filter((r:Row)=>!(r.desired_present===false&&r.status==='applied'));
 const [editor,setEditor]=useState<{kind:'forward'|'domain';port:Row}|null>(null);
 const [clientID,setClientID]=useState(''),[protocols,setProtocols]=useState<string[]>([]),[publicPort,setPublicPort]=useState('');
 const [label,setLabel]=useState(''),[domainRouteID,setDomainRouteID]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const portRoutes=(port:Row)=>routes.filter(r=>String(r.allocation_id)===String(port.id)||!r.allocation_id&&Number(r.local_port)===Number(port.port)&&r.local_ip===port.ip);
 function simulate(action:Parameters<typeof updateNetworkSandbox>[1]){setTestState(updateNetworkSandbox(testState,action,ports))}
 function refresh(){allocations.reload();setup.reload();publicRoutes.reload();domain.reload();reload()}
 useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail===base){allocations.reload();setup.reload();publicRoutes.reload();domain.reload()}};window.addEventListener('server-proxy-changed',changed);return()=>window.removeEventListener('server-proxy-changed',changed)},[base,allocations.reload,setup.reload,publicRoutes.reload,domain.reload]);
 async function run(action:()=>Promise<void>,close=false){setBusy(true);setError('');try{await action();if(close)setEditor(null)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false);if(!testing){refresh();window.dispatchEvent(new CustomEvent('server-proxy-changed',{detail:base}))}}}
 async function apply(route:Row){
  if(testing)return;
  const result=items(await api(`/api/admin/proxy-gateways/${route.gateway_id}/routes/${route.id}/apply`,{method:'POST'}));
  if(!result.length)throw new Error('The gateway did not confirm the change. Refresh and retry.');
  const failed=result.find(r=>r.status!=='applied');
  if(failed)throw new Error(failed.last_error||'The gateway could not apply the change. Retry forwarding.');
 }
 function openForward(port:Row){const {clients}=portConnectionActions(port,setupData,domainData,admin,writable);setClientID(clients.length===1?String(clients[0].id):'');setProtocols((port.protocols||[]).filter((p:string)=>p==='tcp'||p==='udp'));setPublicPort('');setError('');setEditor({kind:'forward',port})}
 function openDomain(port:Row){setLabel(domainData.label||'');setDomainRouteID(String(domainData.route?.id||domainData.choices?.[0]?.id||''));setError('');setEditor({kind:'domain',port})}
 const capabilities=editor?portConnectionActions(editor.port,setupData,domainData,admin,writable):null;
 const selectedClient=capabilities?.clients.find((c:Row)=>String(c.id)===clientID);
 const selectedDomainRoute=capabilities?.domainChoices.find((c:Row)=>String(c.id)===domainRouteID);
 const validLabel=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label);
 async function connect(){
  if(busy||setup.error||setup.loading||!editor||!selectedClient||!protocols.length)return;
  if(!await confirmAction({title:'Forward port?',description:testing?`Test ${protocols.map(p=>p.toUpperCase()).join(' & ')} forwarding for ${address(editor.port.ip,editor.port.port)} locally? No public route will be created.`:`Forward ${address(editor.port.ip,editor.port.port)} through ${selectedClient.name} using ${protocols.map(p=>p.toUpperCase()).join(' & ')}?`,confirmLabel:'Forward port'}))return;
  if(testing){await run(async()=>simulate({type:'forward',allocationID:editor.port.id,protocols,publicPort:publicPort?Number(publicPort):0}),true);return}
  await run(async()=>{for(const protocol of protocols){const route=value(await api(path,{method:'POST',body:JSON.stringify({allocation_id:editor.port.id,client_id:selectedClient.id,protocol,public_port:publicPort?Number(publicPort):0})}));await apply(route)}},true);
 }
 async function removeRoute(route:Row){
  if(!await confirmAction({title:'Stop forwarding?',description:`Disconnect ${address(route.public_host,route.public_port)} using ${route.protocol.toUpperCase()}?`,confirmLabel:'Stop forwarding',danger:true}))return;
  const members=(route.members||[route]).filter((r:Row)=>r.desired_present!==false);
  await run(async()=>{if(testing){setTestState(members.reduce((state:typeof testState,r:Row)=>updateNetworkSandbox(state,{type:'remove-route',id:r.id},ports),testState));return}for(const member of members){await api(`/api/admin/proxy-gateways/${member.gateway_id}/routes/${member.id}`,{method:'DELETE'});await apply(member)}})
 }

 async function saveDomain(){if(busy||domain.error||domain.loading||!selectedDomainRoute||!validLabel)return;await run(async()=>{if(testing){simulate({type:'subdomain',label,routeID:selectedDomainRoute.id});return}await api(`${base}/subdomain`,{method:'PUT',body:JSON.stringify({label,route_id:selectedDomainRoute.id})})},true)}
 async function removeDomain(){if(!await confirmAction({title:'Remove subdomain?',description:`Remove ${domainData.hostname}?`,confirmLabel:'Remove subdomain',danger:true}))return;await run(async()=>{if(testing){simulate({type:'remove-domain'});return}await api(`${base}/subdomain`,{method:'DELETE'})},true)}
 const loadError=allocations.error||account.error||setup.error||publicRoutes.error||domain.error;
 return <section className="operations-page network-page settings-responsive" aria-label="Network">{testAvailable&&<div className="network-local-test"><span>{testing?'Local test mode. No public DNS or forwarding changes.':'Local network actions'}</span>{testing&&<Button variant="secondary" disabled={busy} onClick={()=>{setTestState(emptyNetworkSandbox());setEditor(null);setError('')}}>Reset test</Button>}<Button variant="secondary" disabled={busy} onClick={()=>{setTestRequested(!testing);setEditor(null);setError('')}}>{testing?'Exit test mode':'Try actions locally'}</Button></div>}<SettingsSection title="Server ports" action={<div className="server-proxy-actions">{!testing&&can(permissions,'allocation.create')&&<Button disabled={busy} onClick={()=>void run(async()=>{await api(`${base}/network/allocations`,{method:'POST'})})}>Assign port</Button>}<Button variant="secondary" aria-label="Refresh ports" title="Refresh ports" disabled={busy||allocations.loading} onClick={refresh}><RefreshCw size={14}/></Button></div>}>
  <PageError error={loadError}/>{!editor&&<PageError error={error} onDismiss={()=>setError('')}/>}
  {allocations.loading&&!allocations.data&&<CollectionSkeleton label="Loading ports" count={3}/>}
  <div className="port-connections">{items(allocations.data).map(port=>{const capability=portConnectionActions(port,setup.error?undefined:setupData,domain.error?undefined:domainData,admin,writable),ownRoutes=portRoutes(port);return <div key={port.id} className="port-connection">
   <div className="port-connection-main"><CopyButton className="button secondary port-address-copy" value={address(port.ip,port.port)}/><span className="badge" title={port.protocol_source==='forwarding'?'Configured forwarding protocol':'Game protocol'}>{port.protocols?.length?[...port.protocols].sort().map((p:string)=>p.toUpperCase()).join(' & '):'Not specified'}</span><div className="port-connection-actions">
    {admin&&(capability.forward||ownRoutes.length>0)&&<Button variant="secondary" disabled={busy} onClick={()=>openForward(port)}>{ownRoutes.length?'Edit forwarding':'Forward port'}</Button>}
    {capability.subdomain&&<Button variant="secondary" disabled={busy} onClick={()=>openDomain(port)}>{domainData.hostname?'Edit subdomain':'Add subdomain'}</Button>}
    {!testing&&!port.is_default&&can(permissions,'allocation.delete')&&<Button variant="danger" disabled={busy} onClick={async()=>{if(await confirmAction({title:'Unassign port?',description:`Unassign ${address(port.ip,port.port)}?`,confirmLabel:'Unassign',danger:true}))void run(async()=>{await api(`${base}/network/allocations/${port.id}`,{method:'DELETE'})})}}>Unassign</Button>}
   </div></div>
   {groupPortRoutes(ownRoutes).map(route=><div key={route.id} className="port-public-address"><span className="port-address-label">Public</span><CopyButton value={address(route.public_host,route.public_port)}/><span>{String(route.protocol).toUpperCase()}</span><span className="badge" title={testing?'Local simulation. No public forwarding exists.':'Gateway configuration status. Game reachability is unverified.'}>{routeStatus(route)}</span>{route.last_error&&<span className="server-proxy-error" role="alert">{route.last_error}</span>}</div>)}
   {port.is_default&&domainData.hostname&&<div className="port-public-address"><span className="port-address-label">Subdomain</span><CopyButton value={domainData.route?.public_port?address(domainData.hostname,domainData.route.public_port):domainData.hostname}/><span>{domainData.dns_status==='simulated'?'Test only':domainData.dns_status==='error'?'DNS needs attention':domainData.dns_matches?'DNS matches':'DNS pending'}</span>{writable&&domainData.dns_status==='error'&&<Button variant="secondary" disabled={busy} onClick={()=>void run(async()=>{await api(`${base}/subdomain/retry`,{method:'POST'})})}>Retry DNS</Button>}{writable&&!capability.subdomain&&<Button variant="danger" disabled={busy} onClick={()=>void removeDomain()}>Remove subdomain</Button>}</div>}
   {port.is_default&&domainData.cleanup_pending&&<p className="network-status-note" role="status">Subdomain removal pending.</p>}
  </div>})}</div>
  {!allocations.loading&&!allocations.error&&!items(allocations.data).length&&<p className="server-proxy-note">No ports assigned.</p>}
 </SettingsSection>
 {editor&&<Modal title={editor.kind==='forward'?'Forward port':'Subdomain'} onClose={()=>{if(!busy)setEditor(null)}}><div className="port-action-editor"><p className="port-action-target">{address(editor.port.ip,editor.port.port)}</p><PageError error={error} onDismiss={()=>setError('')}/>
 {editor.kind==='forward'?<>
  {groupPortRoutes(portRoutes(editor.port)).map(route=><div key={route.id} className="port-forward-record"><div><strong>{address(route.public_host,route.public_port)}</strong><span>{String(route.protocol).toUpperCase()} / {routeStatus(route)}</span>{route.last_error&&<p className="server-proxy-error" role="alert">{route.last_error}</p>}</div><div className="server-proxy-actions">{route.status!=='applied'&&route.status!=='simulated'&&<Button variant="secondary" disabled={busy} onClick={()=>void run(async()=>{for(const member of route.members||[route])await apply(member)})}>Retry</Button>}{route.desired_present!==false&&<Button variant="danger" disabled={busy} onClick={()=>void removeRoute(route)}>Stop forwarding</Button>}</div></div>)}
  {!!capabilities?.clients.length&&<form onSubmit={e=>{e.preventDefault();void connect()}}><fieldset disabled={busy}><div className="port-action-field"><span>Gateway</span><div className="port-action-options">{capabilities.clients.map((c:Row)=><Button key={c.id} variant="secondary" aria-pressed={clientID===String(c.id)} onClick={()=>{setClientID(String(c.id));setPublicPort('')}}>{c.name}</Button>)}</div></div>
   <div className="port-action-field"><span>Protocol</span><div className="port-action-options">{['udp','tcp'].map(p=><Button key={p} variant="secondary" aria-pressed={protocols.includes(p)} onClick={()=>setProtocols(current=>current.includes(p)?current.filter(v=>v!==p):[...current,p])}>{p.toUpperCase()}</Button>)}</div></div>
   <label className="port-action-field"><span>Public port</span><Input type="number" aria-label="Public port" min={selectedClient?.public_port_start??1} max={selectedClient?.public_port_end??65535} value={publicPort} placeholder="Automatic" onChange={e=>setPublicPort(e.target.value)}/></label>
   <div className="actions"><Button type="submit" disabled={busy||!!setup.error||setup.loading||!selectedClient||!protocols.length}>{busy?'Applying...':'Forward port'}</Button></div>
  </fieldset></form>}
 </>:<form onSubmit={e=>{e.preventDefault();void saveDomain()}}><fieldset disabled={busy}>
  <label className="port-action-field"><span>Name</span><Input aria-label="Subdomain name" value={label} maxLength={63} required pattern="[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?" placeholder="my-server" onChange={e=>setLabel(e.target.value)}/></label>
  {(capabilities?.domainChoices.length||0)>1&&<div className="port-action-options">{capabilities?.domainChoices.map((c:Row)=><Button key={c.id} variant="secondary" aria-pressed={domainRouteID===String(c.id)} onClick={()=>setDomainRouteID(String(c.id))}>{c.domain} / {String(c.protocol).toUpperCase()} :{c.public_port}</Button>)}</div>}
  {label&&selectedDomainRoute&&<p className="port-domain-preview">{address(`play.${label}.${selectedDomainRoute.domain}`,selectedDomainRoute.public_port)}</p>}
  <div className="actions"><Button type="submit" disabled={busy||!!domain.error||domain.loading||!validLabel||!selectedDomainRoute}>{busy?'Saving...':'Save subdomain'}</Button>{domainData.hostname&&<Button variant="danger" disabled={busy} onClick={()=>void removeDomain()}>Remove subdomain</Button>}</div>
 </fieldset></form>}
 </div></Modal>}
 </section>;
}
