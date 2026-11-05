import {Feedback} from '../notifications';
import {useEffect,type ReactNode} from 'react';
import {RefreshCw} from 'lucide-react';
import {CopyButton} from '../ui/CopyButton';
import {ButtonFeedback} from '../ui/ButtonFeedback';
import {Disclosure,DisclosureTrigger} from '../ui/Disclosure';
import {SettingsSection} from '../ui/Settings';
import {useTransientMessage} from '../hooks/useTransientMessage';
import {Button,useAPI} from '../lib';
import {can,items,useServer,value} from './common';
import {connectionAddress as address,connectionDNS} from './connectionAddress';
import './serverConnection.css';

function useConnectionInfo(domainQuery?:ReturnType<typeof useAPI>){
 const {server,base,permissions}=useServer();
 const readable=can(permissions,'allocation.read');
 const query=useAPI(readable?`${base}/proxy-routes`:null),ownDomainQuery=useAPI(readable&&!domainQuery?`${base}/subdomain`:null);
 const subdomain=domainQuery||ownDomainQuery;
 useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail===base){query.reload();if(!domainQuery)subdomain.reload()}};window.addEventListener('server-proxy-changed',changed);return()=>window.removeEventListener('server-proxy-changed',changed)},[base,query.reload,subdomain.reload]);
 const allocations=items(server.relationships?.allocations),primary=allocations.find(a=>a.is_default)||allocations[0];
 const routes=items(query.data).filter(r=>r.desired_present!==false&&Number(r.local_port)===Number(primary?.port));
 const chosen=routes.find(r=>r.status==='applied')||routes[0];
 const connection=chosen?address(chosen.public_host,chosen.public_port):primary?address(primary.ip,primary.port):null;
 const dnsAddress=connectionDNS(primary?{port:primary.port,ip_alias:primary.ip_alias,alias:primary.alias}:undefined,routes.map(r=>({public_host:r.public_host,public_port:r.public_port})),value(subdomain.data));
 return {server,permissions,readable,query,subdomain,primary,routes,connection,dnsAddress};
}

export function ConnectionOverview({domainQuery}:{domainQuery:ReturnType<typeof useAPI>}){
 const info=useConnectionInfo(domainQuery);
 const [copyError,setCopyError]=useTransientMessage(5000);
 const loading=info.query.loading||info.subdomain.loading;
 const failed=info.query.error||info.subdomain.error;
 return <SettingsSection title="Join address" action={<Button variant="secondary" className="connection-check" aria-label="Refresh connection records" title="Refresh saved connection records" disabled={loading} onClick={()=>{info.query.reload();info.subdomain.reload()}}><ButtonFeedback state={loading?'pending':'idle'}><RefreshCw/></ButtonFeedback></Button>}>
  <div className="connection-join-row" aria-busy={loading}>
   {failed?<Feedback tone="error" message={<>Connection details unavailable. Retry above.</>}/>:loading&&!info.query.data?<span role="status">Loading address...</span>:info.connection?<CopyButton className="button secondary" value={info.dnsAddress||info.connection} onCopyError={setCopyError}/>:<span>No port assigned</span>}
   {!failed&&<span className="badge">{loading&&!info.query.data?'Checking':info.routes.length?info.routes.some(r=>r.status==='applied')?'Gateway applied':'Gateway pending':'Direct'}</span>}
  </div>
  {copyError&&<Feedback tone="error" message={<>{copyError}</>}/>}
  <Disclosure className="connection-details"><DisclosureTrigger>Details</DisclosureTrigger><p>A saved address does not confirm the game is reachable.</p><dl><dt>Node address</dt><dd>{info.primary?address(info.primary.ip,info.primary.port):'Not assigned'}</dd><dt>Public connection</dt><dd>{info.routes.length?info.connection:'Direct access needs a reachable node address and open game ports.'}</dd><dt>Game reachability</dt><dd>Not checked</dd></dl></Disclosure>
 </SettingsSection>;
}

export function ServerConnection({leading}:{leading?:ReactNode}){
 const {routes,connection,dnsAddress}=useConnectionInfo();
 const [copyError,setCopyError]=useTransientMessage(5000);
 return <div className="server-connection">
  <div className="server-connection-summary"><div className="server-connection-addresses">
   {leading&&<div>{leading}</div>}
   <div><span className="server-meta-label">{routes.length?'Proxy:':'IP:'}</span>{connection?<CopyButton value={connection} onCopyError={setCopyError} className="button secondary server-connection-address" title="Copy address; reachability is not verified"/>:<span>Not assigned</span>}</div>
   <div><span className="server-meta-label">DNS:</span>{dnsAddress?<CopyButton value={dnsAddress} onCopyError={setCopyError} className="button secondary server-connection-address" title="Copy DNS address"/>:<span className="muted">Not configured</span>}</div>
  </div></div>
  {copyError&&<Feedback tone="error" message={<>{copyError}</>}/>}

 </div>;
}
