type Row=Record<string,any>;
export function portConnectionActions(port:Row, setup:Row|undefined, domain:Row|undefined, admin:boolean, writable:boolean) {
 const ids=new Set((setup?.allocations||[]).find((p:Row)=>String(p.id)===String(port.id))?.forward_client_ids||[]);
 const clients=admin?(setup?.clients||[]).filter((c:Row)=>ids.has(c.id)):[];
 const domainChoices=port.is_default?(domain?.choices||[]):[];
 return {clients,domainChoices,forward:clients.length>0,subdomain:writable&&domainChoices.length>0};
}

export function groupPortRoutes(routes:Row[]):(Row&{members:Row[]})[]{
 const groups=new Map<string,Row[]>();
 for(const route of routes){const key=JSON.stringify([route.public_host,route.public_port,route.local_ip,route.local_port,route.gateway_id,route.client_id]);const members=groups.get(key)||[];members.push(route);groups.set(key,members)}
 return [...groups.values()].map(members=>{
  const protocols=[...new Set(members.map(r=>String(r.protocol).toUpperCase()))].sort((a,b)=>{const order=['TCP','UDP','HTTP','HTTPS'];return (order.indexOf(a)<0?99:order.indexOf(a))-(order.indexOf(b)<0?99:order.indexOf(b))||a.localeCompare(b)});
  const status=members.every(r=>r.status===members[0].status)?members[0].status:members.some(r=>r.status==='error')?'error':'pending';
  return {...members[0],members,protocol:protocols.join(' & '),status,desired_present:members.some(r=>r.desired_present!==false),last_error:[...new Set(members.map(r=>r.last_error).filter(Boolean))].join(' ')};
 });
}
