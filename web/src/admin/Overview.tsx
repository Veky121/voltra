import {Capacity,FleetSummary} from './FleetSummary';
import FleetCPU,{FleetCPUProvider} from './FleetCPU';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ErrorMessage, rows, useAPI} from './shared';
import {ChevronDown, ChevronRight, Settings2, Server} from 'lucide-react';
import {Card, CardContent, CardHeader, CardTitle} from '../components/ui/card';
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from '../components/ui/collapsible';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Item, ItemGroup, ItemContent, ItemTitle, ItemDescription} from '../components/ui/item';
import {Skeleton} from '../components/ui/skeleton';
import {formatMiBGB} from '../resourceUnits';
import './overview.css';

type RecordData = Record<string, any>;
const nodeID = (s: RecordData) => String(s.node_id ?? s.node);
const limit = (s: RecordData, key: string) => Number(s.limits?.[key] ?? s[key] ?? 0);

export default function Overview() {
  const servers = useAPI('/api/application/servers?per_page=100');
  const nodes = useAPI('/api/application/nodes?per_page=100');
  const [search, setSearch] = useState('');
  const list: RecordData[] = servers.data ? rows(servers.data) : [];
  const hosts: RecordData[] = nodes.data ? rows(nodes.data) : [];
  const ready = !servers.loading && !nodes.loading && !servers.error && !nodes.error;
  const matches = (s:RecordData) => `${s.name} ${s.identifier ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());
  const capacity = (host:RecordData) => (['memory','disk'] as const).map(key => <Capacity key={key} label={key === 'memory' ? 'Memory' : 'Storage'} capacity={Number(host[key])} allocated={Number(host.allocated_resources?.[key] ?? 0)} unlimited={list.some(s => nodeID(s) === String(host.id) && limit(s,key) === 0)}/>);
  function serverRows(items:RecordData[]) {
    return <><div className="fleet-columns" aria-hidden="true"><span>Server</span><span>Memory limit</span><span>Storage limit</span><span>State</span><span/></div>
      <ItemGroup className="fleet-servers">{items.filter(matches).sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{numeric:true,sensitivity:'base'})).map(s => <Item size="xs" className="fleet-server" key={s.id} render={<Link to={`/server/${s.identifier || s.uuid}`}/>}>
      <ItemContent><ItemTitle>{s.name}</ItemTitle>{s.egg_name&&s.egg_name!==s.name&&<ItemDescription>{s.egg_name}</ItemDescription>}</ItemContent>
      <span className="fleet-server-limit"><span className="fleet-mobile-label">RAM </span>{limit(s,'memory') === 0 ? 'Unlimited' : formatMiBGB(limit(s,'memory'))}</span>
      <span className="fleet-server-limit"><span className="fleet-mobile-label">Disk </span>{limit(s,'disk') === 0 ? 'Unlimited' : formatMiBGB(limit(s,'disk'))}</span>
      <span className="fleet-state" data-attention={s.status?true:undefined}>{s.status?.replaceAll('_',' ') || (s.container?.installed === 1 ? 'Installed' : 'Not installed')}</span><ChevronRight className="fleet-server-arrow" size={14} aria-hidden="true"/>
    </Item>)}</ItemGroup></>;
  }
  return <FleetCPUProvider nodes={hosts as {id:number|string}[]} servers={list}><div className="admin-fleet">
    <ErrorMessage error={servers.error || nodes.error}/>
    {!ready ? (servers.error || nodes.error ? <p role="status">Unavailable</p> : <Skeleton className="scn:h-24 scn:w-full" aria-label="Loading infrastructure" role="status"/>) : <>
      <FleetSummary nodes={hosts} servers={list}/>
      <div className="fleet-toolbar"><h2>Nodes & servers</h2><Input type="search" aria-label="Search servers" placeholder="Find a server" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {!hosts.length && <p className="muted">No nodes. <Button variant="link" render={<Link to="/admin/nodes"/>}>Manage nodes</Button></p>}
      {hosts.map(n => {
        const children = list.filter(s=>nodeID(s) === String(n.id));
        if(search && !children.some(matches)) return null;
        return <Card size="sm" className="fleet-node" key={n.id}>
          <Collapsible defaultOpen>
            <CardHeader className="fleet-node-header">
              <CollapsibleTrigger render={<Button variant="ghost" className="fleet-node-toggle"/>}>
                <ChevronDown className="fleet-chevron" size={14} aria-hidden="true"/>
                <span className="fleet-node-icon"><Server size={16} aria-hidden="true"/></span>
                <span className="fleet-node-name"><strong>{n.name}<span className="fleet-node-count">{children.length}</span></strong><small>{n.fqdn}{n.maintenance_mode ? ' · Maintenance' : ''}</small></span>
              </CollapsibleTrigger>
              <div className="fleet-node-capacity"><FleetCPU nodes={[{id:n.id}]} servers={children} label={`Server CPU usage on ${n.name}`}/>{capacity(n)}</div>
              <Button variant="ghost" size="sm" className="fleet-node-manage" aria-label={`Manage ${n.name}`} title={`Manage ${n.name}`} render={<Link to={`/admin/nodes/${n.id}`}/>}><Settings2 size={15} aria-hidden="true"/></Button>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="fleet-node-content">
                {children.length ? serverRows(children) : <p className="fleet-empty">No servers.</p>}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>;

      })}
      {!!search && !list.some(matches) && <p className="muted">No matches.</p>}
      {list.some(s=>!hosts.some(n=>String(n.id) === nodeID(s))) && <Card size="sm"><CardHeader><CardTitle>Unassigned node</CardTitle></CardHeader><CardContent>{serverRows(list.filter(s=>!hosts.some(n=>String(n.id) === nodeID(s))))}</CardContent></Card>}
    </>}
  </div></FleetCPUProvider>;
}
