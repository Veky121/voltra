import {CopyButton} from '../ui/CopyButton';
import {ActionButton as MiraAction} from '../ui/ActionButton';
import {ServerSubdomain} from './ServerSubdomain';
import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTransientMessage} from '../hooks/useTransientMessage';
import {Button, Modal, useAPI} from '../lib';
import {can, items, useServer, value} from './common';
import {connectionAddress as address, connectionDNS} from './connectionAddress';
import './serverConnection.css';
import {useServerTelemetry} from './ServerDashboard';

export function ServerConnection(){
  const {server,base,permissions}=useServer();
  const telemetry=useServerTelemetry();
  const readable=can(permissions,'allocation.read');
  const query=useAPI(readable?`${base}/proxy-routes`:null);
  const subdomain=useAPI(readable?`${base}/subdomain`:null);
  useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail===base){query.reload();subdomain.reload()}};window.addEventListener('server-proxy-changed',changed);return()=>window.removeEventListener('server-proxy-changed',changed)},[base,query.reload,subdomain.reload]);
  const [details,setDetails]=useState(false),[dns,setDNS]=useState(false);
  const [copyError,setCopyError]=useTransientMessage(5000);
  const allocations=items(server.relationships?.allocations);
  const primary=allocations.find(a=>a.is_default)||allocations[0];
  const routes=items(query.data).filter(r=>Number(r.local_port)===Number(primary?.port));
  const domain=primary?.ip_alias||primary?.alias;
  const connection=routes[0]?address(routes[0].public_host,routes[0].public_port):primary?address(primary.ip,primary.port):null;
  const joinDomain=value(subdomain.data);
  const dnsAddress=connectionDNS(primary?{port:primary.port,ip_alias:primary.ip_alias,alias:primary.alias}:undefined,routes.map(route=>({public_host:route.public_host,public_port:route.public_port})),joinDomain);
  return <div className="server-connection">
    <div className="server-connection-summary">
      <div className="server-connection-addresses">
        <div><span className="server-meta-label">{routes.length?'Proxy:':'IP:'}</span>{connection?<CopyButton value={connection} onCopyError={setCopyError} className="button secondary server-connection-address" title="Copy connection address; reachability is not verified">{connection}</CopyButton>:<span>Not assigned</span>}</div>
        <div><span className="server-meta-label">DNS:</span>{dnsAddress?<CopyButton value={dnsAddress} onCopyError={setCopyError} className="button secondary server-connection-address" title="Copy configured DNS name; DNS resolution is not verified">{dnsAddress}</CopyButton>:<span className="muted">Not configured</span>}</div>
      </div>
      <Button variant="secondary" className="server-connection-more" onClick={()=>setDetails(true)}>Connection details</Button>
    </div>
    <span className="server-connection-feedback" role="alert">{copyError}</span>
    {details&&<Modal title="Connection details" onClose={()=>setDetails(false)}><div className="server-connection-details">
    <p>A running process does not confirm that friends can join.</p>
    <dl aria-label="Connection checks">
      <dt>Game process</dt><dd>{!can(permissions,'control.console')?'Console permission required':telemetry.error?'Status unavailable':!telemetry.updated?'Waiting for status':telemetry.state==='running'?'Running':telemetry.state.replaceAll('_',' ')}{telemetry.updated>0&&!telemetry.error&&<small>Updated {new Date(telemetry.updated).toLocaleTimeString()}</small>}</dd>
      <dt>Local game port</dt><dd>Not checked. Process status does not verify a listening port.</dd>
      <dt>Forwarding</dt><dd>{!readable?'Allocation permission required':query.error?'Status unavailable':query.loading?'Reading configuration...':routes.some(route=>route.status==='applied')?'Route applied at its last recorded check':routes.length?'Configured, application not confirmed':'No proxy route for the primary port'}</dd>
      <dt>External reachability</dt><dd>Not checked. No external connection test has run.</dd>
    </dl>
    <Button variant="secondary" disabled={query.loading||subdomain.loading||!readable&&!can(permissions,'control.console')} onClick={()=>{if(readable){query.reload();subdomain.reload()}if(can(permissions,'control.console'))telemetry.refresh()}}>Refresh connection status</Button>
    <p className="muted">Refresh reads process status and saved forwarding configuration. It does not probe the game port or the public address.</p>
    <dl>
      {readable&&<><dt>Proxy</dt><dd>{query.loading?'Checking...':query.error?'Unable to check':routes.length?'Configured':'Primary port is not proxied'}{!query.loading&&!query.error&&<Link className="button secondary" to={`/server/${server.identifier||server.uuid}/settings/network`} onClick={()=>setDetails(false)}>Manage connections</Link>}{query.error&&<MiraAction type="button" onClick={query.reload}>Retry</MiraAction>}</dd></>}
      {routes.map(route=><div className="server-connection-row" key={route.id}><dt>Proxy address</dt><dd><CopyButton value={address(route.public_host,route.public_port)} onCopyError={setCopyError} title="Copy proxy address">{address(route.public_host,route.public_port)}</CopyButton><span>{String(route.protocol).toUpperCase()} � {route.status}</span></dd></div>)}
      <dt>Node address</dt><dd>{primary?<CopyButton value={address(primary.ip,primary.port)} onCopyError={setCopyError} title="Copy node allocation address; direct reachability is not verified">{address(primary.ip,primary.port)}</CopyButton>:'Not assigned'}</dd>
      {dnsAddress&&<><dt>DNS address</dt><dd><CopyButton value={dnsAddress} onCopyError={setCopyError} title="Copy configured DNS address">{dnsAddress}</CopyButton></dd></>}
      <dt>Address alias</dt><dd>{domain&&<CopyButton value={address(domain,primary.port)} onCopyError={setCopyError} title="Copy configured allocation alias; DNS is not verified">{address(domain,primary.port)}</CopyButton>}{readable&&<MiraAction type="button" onClick={()=>setDNS(true)}>Setup guide</MiraAction>}{!domain&&!readable&&'Not configured'}</dd>
      {readable&&<ServerSubdomain onCopyError={setCopyError}/>}
      <dt>Server ID</dt><dd><CopyButton value={server.uuid} onCopyError={setCopyError} title="Copy server UUID">{server.uuid}</CopyButton></dd>
      <dt>Node</dt><dd>{server.node}</dd>
    </dl>
    <span className="server-connection-feedback" role="alert">{copyError}</span>
    </div></Modal>}
    {dns&&<Modal title="Set up a subdomain" onClose={()=>setDNS(false)}>
      <p>Create a record at your domain's DNS provider, such as play.example.com.</p>
      {query.loading?<p>Checking proxy routes...</p>:query.error?<p>Proxy details are unavailable. Check Network before choosing a DNS target.</p>:<>
        <p>{routes.length?'Use a proxy target below to keep players connecting through the gateway.':'No proxy route is configured for the primary allocation. Use a publicly reachable node address; private or wildcard addresses need forwarding first.'}</p>
        {(routes.length?routes.map(r=>({host:r.public_host,port:r.public_port,protocol:r.protocol})):primary?[{host:primary.ip,port:primary.port,protocol:''}]:[]).map((target,index)=><p key={index}><strong>{target.protocol.toUpperCase()} target: </strong><code>{target.host}</code> � Port <code>{target.port}</code></p>)}
        <p>Use an A record for an IPv4 target, AAAA for IPv6, or CNAME for a hostname. Enter only the host in the record, without a port.</p>
        <p>Players normally join with play.example.com:port. Games that support SRV records can use a separate service record to choose the port.</p>
        <p>For ordinary game traffic on Cloudflare, choose DNS only. DNS does not open ports or configure forwarding.</p>
      </>}
      <p>This guide does not create DNS records. A displayed allocation alias is not proof that DNS resolves or the server is reachable.</p>
    </Modal>}
  </div>;
}
