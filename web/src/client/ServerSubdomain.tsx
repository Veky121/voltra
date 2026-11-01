import {useErrorState} from '../notifications/useErrorState';
import {CopyButton} from '../ui/CopyButton';
import {useState} from 'react';
import {ActionButton as MiraAction} from '../ui/ActionButton';
import {api,Button,Field,Input,Select,useAPI} from '../lib';
import {can,useServer,value} from './common';

export function ServerSubdomain({onCopyError}:{onCopyError:(message:string)=>void}){
 const {base,permissions}=useServer();
 const query=useAPI(`${base}/subdomain`);
 const data=value(query.data)||{},choices=data.choices||[];
 const [open,setOpen]=useState(false),[draft,setDraft]=useState<string|null>(null),[route,setRoute]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useErrorState('client/ServerSubdomain.tsx');
 const label=draft??data.label??'';
 const selected=choices.find((c:any)=>String(c.id)===route)||choices.find((c:any)=>c.id===data.route?.id)||choices[0];
 async function save(remove=false){setBusy(true);setError('');try{await api(`${base}/subdomain`,{method:remove?'DELETE':'PUT',...(!remove?{body:JSON.stringify({label,route_id:selected?.id})}:{})});setDraft(null);query.reload();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 async function retry(){setBusy(true);setError('');try{await api(`${base}/subdomain/retry`,{method:'POST'});query.reload();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <>
  <dt>Join domain</dt><dd>{data.hostname&&data.route?<CopyButton value={`${data.hostname}:${data.route.public_port}`} onCopyError={onCopyError}>{data.hostname}:{data.route.public_port}</CopyButton>:<span>{query.loading?'Loading...':data.hostname?'Route changed':'Not set'}</span>}
  {data.hostname&&<span>{data.dns_status==='error'?'DNS error':data.dns_matches?'DNS matches':'DNS pending'}</span>}
  <MiraAction type="button" onClick={()=>setOpen(!open)}>{can(permissions,'allocation.update')?'Edit join name':'View details'}</MiraAction></dd>
  {open&&<div className="server-subdomain-form">
   <p>{data.detail}</p>{data.route&&<p>Public port {data.route.public_port} / {String(data.route.protocol).toUpperCase()} / FRP status: {data.route.status}. DNS verification does not test the game connection.</p>}
   {data.cleanup_pending&&<p role="status">An old DNS record is awaiting removal. Cleanup retries automatically; its name stays reserved until removal is confirmed.</p>}
   {query.error&&<p role="alert">{query.error}</p>}
   {!query.loading&&!query.error&&!choices.length&&<p>An administrator needs to configure managed DNS under Proxy gateways. This server also needs a primary FRP route.</p>}
   {can(permissions,'allocation.update')&&<form onSubmit={e=>{e.preventDefault();void save();}}>
    {choices.length>1&&<Field label="Gateway"><Select value={String(selected?.id||'')} disabled={busy} onChange={e=>setRoute(e.target.value)}>{choices.map((c:any)=><option key={c.id} value={c.id}>{c.domain} / {c.protocol.toUpperCase()} :{c.public_port}</option>)}</Select></Field>}
    <Field label="Join name" hint={label&&selected?`play.${label}.${selected.domain}:${selected.public_port}`:'Optional. Leave empty to keep domains disabled.'}><Input value={label} disabled={busy||query.loading} maxLength={63} placeholder="Choose a join name" onChange={e=>setDraft(e.target.value)}/></Field>
    <Button type="submit" disabled={busy||query.loading||!!query.error||(!selected&&!!label)}>{busy?'Saving...':'Save join name'}</Button>
   </form>}
   <div className="actions"><Button variant="secondary" disabled={busy||query.loading} onClick={query.reload}>Check DNS</Button>{can(permissions,'allocation.update')&&<Button variant="secondary" disabled={busy||query.loading} onClick={()=>void retry()}>Retry DNS changes</Button>}{data.hostname&&can(permissions,'allocation.update')&&<Button variant="secondary" disabled={busy} onClick={()=>void save(true)}>Clear join name</Button>}</div>
   {error&&<p role="alert">{error}</p>}
   <p>Join name is separate from your server's display name. Keep the public port when joining.</p>
  </div>}
 </>;
}
