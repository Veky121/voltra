import {Button, Card, useAPI} from '../lib';
import {items, PageError} from './common';

export function ProxyEndpoints({base}:{base:string}) {
  const query=useAPI(`${base}/proxy-routes`);
  if(!query.error&&!query.loading&&items(query.data).length===0)return null;
  return <Card>
    <div className="toolbar"><h3>Public proxy addresses</h3><Button variant="secondary" onClick={query.reload}>Refresh</Button></div>
    <p className="muted">Use these addresses to connect through your proxy gateway.</p>
    <PageError error={query.error}/>
    {query.loading?<p className="muted">Loading proxy addresses...</p>:items(query.data).map(route=><div key={route.id} className="toolbar">
      <code>{String(route.public_host).includes(':')?`[${route.public_host}]`:route.public_host}:{route.public_port}</code>
      <span className="badge">{String(route.protocol).toUpperCase()}</span>
      <span className="muted">{route.status}</span>
    </div>)}
  </Card>;
}
