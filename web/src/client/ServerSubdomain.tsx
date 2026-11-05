import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {RefreshCw} from 'lucide-react';
import {useErrorState} from '../notifications/useErrorState';
import {api,Button,Input,useAPI} from '../lib';
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {ButtonFeedback} from '../ui/ButtonFeedback';
import {usePendingSetting} from './PendingSettings';
import {can,useServer,value} from './common';

export function ServerSubdomain({query}:{query:ReturnType<typeof useAPI>}){
 const {base,permissions}=useServer();
 const account=useAPI('/api/client/account');
 const [acknowledged,setAcknowledged]=useState<{source:unknown;data:any}|null>(null);
 const data=acknowledged&&acknowledged.source===query.data?acknowledged.data:value(query.data)||{},choices:any[]=data.choices||[];
 const admin=value(account.data)?.root_admin===true,writable=can(permissions,'allocation.update');
 const [draft,setDraft]=useState<string|null>(null),[route,setRoute]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useErrorState('client/ServerSubdomain.tsx');
 const label=draft??data.label??'';
 const selected=choices.find(c=>String(c.id)===route)||choices.find(c=>c.id===data.route?.id)||choices[0];
 const dirty=draft!==null&&label!==(data.label||'')||!!route&&String(data.route?.id||'')!==route;
 const valid=!label||/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label);
 const changed=()=>{window.dispatchEvent(new CustomEvent('server-proxy-changed',{detail:base}))};
 useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent).detail===base)query.reload()};window.addEventListener('server-proxy-changed',refresh);return()=>window.removeEventListener('server-proxy-changed',refresh)},[base,query.reload]);
 async function save(){
  if(!writable||busy||!valid||query.error||label&&!selected)throw new Error('Check the domain settings.');
  setBusy(true);setError('');
  try{const result=await api(`${base}/subdomain`,{method:'PUT',body:JSON.stringify({label,route_id:selected?.id})});setAcknowledged({source:query.data,data:value(result)});setDraft(null);setRoute('');}
  catch(e){setError(e instanceof Error?e.message:String(e));throw e;}
  finally{setBusy(false)}
 }
 usePendingSetting(`subdomain:${base}`,dirty,{summary:'Join domain',applies:'DNS may take time to update',blocked:busy||query.loading||!!query.error||!writable||!valid||!!label&&!selected,save,afterSave:changed,discard:()=>{setDraft(null);setRoute('');setError('')}});
 async function retry(){setBusy(true);setError('');try{await api(`${base}/subdomain/retry`,{method:'POST'});changed()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 if(!query.loading&&!query.error&&!error&&!choices.length&&!data.hostname&&!data.cleanup_pending)return null;
 return <SettingsSection title="Domain" action={<Button variant="secondary" className="connection-check" aria-label="Check DNS" title="Check DNS records" disabled={busy||query.loading} onClick={query.reload}><ButtonFeedback state={query.loading?'pending':'idle'}><RefreshCw/></ButtonFeedback></Button>}>
  {(query.error||error)&&<p className="server-proxy-error" role="alert">{query.error||error}</p>}
  {!query.loading&&!query.error&&!choices.length&&!data.hostname ? <p className="server-proxy-note">{admin?<>Connect a gateway with <Link to="/admin/integrations/proxy-gateways">managed DNS</Link> first.</>:'Ask an administrator to enable a domain for this server.'}</p> : <>
   <SettingsRow label="Join name" description={!valid?'Use letters, numbers and hyphens.':label&&selected?`play.${label}.${selected.domain}:${selected.public_port}`:'Optional'} control={<Input aria-label="Join name" aria-invalid={!valid} value={label} disabled={!writable||busy||query.loading} maxLength={63} placeholder="friends" onChange={e=>setDraft(e.target.value)}/>}/>
   {choices.length>1&&<SettingsRow label="Gateway" control={<div className="network-choice"><div>{choices.map(c=><Button key={c.id} variant="secondary" aria-pressed={selected?.id===c.id} disabled={!writable||busy} onClick={()=>setRoute(String(c.id))}>{c.domain} / {c.protocol.toUpperCase()} :{c.public_port}</Button>)}</div></div>}/>}

   {data.hostname&&<div className="connection-domain-status"><span>{data.dns_status==='error'?'DNS needs attention':data.dns_matches?'DNS matches':'DNS pending'}</span>{data.dns_status==='error'&&writable&&<Button variant="secondary" disabled={busy||dirty} onClick={()=>void retry()}>Retry</Button>}{writable&&<Button variant="secondary" disabled={busy||query.loading} onClick={()=>setDraft('')}>Clear</Button>}</div>}
  </>}
  {data.cleanup_pending&&<p className="server-proxy-note" role="status">Previous DNS record removal is pending.</p>}
  {data.hostname&&<p className="network-status-note">{data.detail||'DNS points to the gateway. Keep the public port when joining.'}</p>}

 </SettingsSection>;
}
